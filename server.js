import express from 'express'
import bodyParser from 'body-parser'
import cors from 'cors'
import mongoose from 'mongoose'
import data from './data/squares.json'
import crypto from 'crypto'
import bcrypt from 'bcrypt-nodejs'




const mongoUrl = process.env.MONGO_URL || "mongodb://localhost/final-project"
mongoose.connect(mongoUrl, { useNewUrlParser: true, useUnifiedTopology: true })
mongoose.Promise = Promise
mongoose.set('useCreateIndex', true)
mongoose.set('useFindAndModify', false)

const port = process.env.PORT || 8080
const app = express()
const http = require('http').createServer(app)
const socketIo = require('socket.io')(http)

app.use(cors())
app.use(bodyParser.json())
app.use((req, res, next) => {
  if (mongoose.connection.readyState === 1) {
    next()
  } else {
    res.status(503).json({ error: 'Service unavailable' })
  }
})




const Square = mongoose.model('Square', {
  row: Number,
  column: Number,
  piece: Object,
  valid: Boolean
})

const User = mongoose.model('User', {
  username: {
    type: String,
    minlength: 3,
    maxlength: 20,
    required: true,
    unique: true
  },
  password: {
    type: String,
    minlength: 8,
    required: true
  },
  profilePicture: {
    type: String,
    default: ''
  },
  gameBoard: {
    type: Array,
    required: true
  },
  accessToken: {
    type: String,
    default: () => crypto.randomBytes(128).toString('hex')
  },
  lostPieces: {
    type: Array,
    default: []
  }
})


if (process.env.RESET_DB) {
  const seedDatabase = async () => {
    await Square.deleteMany()

    data.forEach((square) => {
      new Square(square).save()
    })
  }
  seedDatabase()
}

if (process.env.RESET_USERBASE) {
  const resetUserbase = async () => {
    await User.deleteMany()
  }
  resetUserbase()
}

const authenticateUser = async (req, res, next) => {
  const user = await User.findOne({ accessToken: req.header('Authorization') })
  if (user) {
    req.user = user
    next()
  } else {
    res.status(403).json({ message: 'You must be logged in to access this room' })
  }
}


app.get('/users', async (req, res) => {
  const users = await User.find()
  res.json(users)
})


app.get('/', async (req, res) => {
  res.send("hello")

})


app.get('/game/:roomid', authenticateUser)
app.get('/game/:roomid', async (req, res) => {
  //host could be a findOneandUpdate which sets roomActive to true, which becomes a condition for the guest to enter
  //but then I don't know how to revert this to false if the host closes the browser without having clicked a 'logout' button
  try {

    const host = await User.findOne({ _id: req.params.roomid })
    const user = await User.findOne({ accessToken: req.header('Authorization') })

    res.json({
      gameBoard: host.gameBoard, initialBoardState: host.initialBoardState,
      username: user.username, host: host.username, color: host.username === user.username ? "white" : "black"
    })

  } catch (err) {
    res.json({ message: "Room does not exist", error: err })
  }

})


app.post('/game/:roomid/movepiece', authenticateUser)
app.post('/game/:roomid/movepiece', async (req, res) => {
  console.log('moving piece')
  try {
    const user = await User.findOne({ _id: req.params.roomid })
    const updatedBoard = user.gameBoard
    let movedTo = await updatedBoard.find((square) => square.row === +req.body.targetSquare.row && square.column === +req.body.targetSquare.column)
    let movedFrom = updatedBoard.find((square) => square.row === +req.body.baseSquare.row && square.column === +req.body.baseSquare.column)
    movedTo.piece = movedFrom.piece
    movedFrom.piece = {}
    const userBoard = await User.findOneAndUpdate({ _id: req.params.roomid }, { gameBoard: updatedBoard }, { new: true })
    //userBoard
    // res.status(200).json({ board: userBoard.gameBoard, currentTurn: req.body.color === "white" ? "black" : "white" })
    // socketIo.of(`${req.params.roomid}`).emit('update', { board: userBoard.gameBoard, currentTurn: req.body.color === "white" ? "black" : "white" })
    socketIo.emit('update', { board: userBoard.gameBoard, currentTurn: req.body.color === "white" ? "black" : "white" })
    //socketIo.emit('move', { board: userBoard.gameBoard, currentTurn: req.body.color === "white" ? "black" : "white", room: req.params.roomid })

  } catch (err) {
    res.status(404).json({ message: "Invalid move", error: err })
  }
})



app.get('/game/:roomid/reset', async (req, res) => {
  console.log('resetting')
  try {

    const squares = await Square.find()
    const updatedUser = await User.findOneAndUpdate({ _id: req.params.roomid }, { gameBoard: squares }, { new: true })
    res.status(200).json(updatedUser.gameBoard)
  } catch (err) {
    res.status(404).json({ message: "Only the host can reset the game", error: err })
  }


})

app.post('/signup', async (req, res) => {
  console.log('new user is being created')
  try {
    const chessBoard = await Square.find()
    const username = req.body.username.charAt(0).toUpperCase() + req.body.username.slice(1).toLowerCase()
    const { email, password } = req.body
    const user = await new User({ username, email, password: bcrypt.hashSync(password), gameBoard: chessBoard, initialBoardState: chessBoard }).save()
    res.status(201).json({ id: user._id, accessToken: user.accessToken, lostPieces: user.lostPieces })
  } catch (err) {
    res.status(400).json({ message: "Could not create user", error: err })
  }
})


app.get('/books/:id', async (req, res) => {
  const foundBook = await Book.findOne({ bookID: req.params.id })
  if (foundBook) {
    res.json(foundBook)
  } else {
    res.status(404).json({ error: `No book with id "${req.params.id}" exists.` })
  }
})

app.put('/books/:id', async (req, res) => {

  const foundBook = await Book.findOne({ bookID: req.params.id })

  const setRating = (user_rating) => {
    const totalRating = (foundBook.average_rating * foundBook.ratings_count) + user_rating
    const totalNumber = foundBook.ratings_count + 1
    const average = totalRating / totalNumber
    return Math.round((average + Number.EPSILON) * 100) / 100
  }

  const updatedBook = await Book.findOneAndUpdate({ bookID: +req.params.id }, {
    img_url: req.body.img_url ?? foundBook.img_url,
    average_rating: req.body.user_rating ? setRating(+req.body.user_rating) : foundBook.average_rating,
    ratings_count: req.body.user_rating ? foundBook.ratings_count + 1 : foundBook.ratings_count
  }, { new: true })
  res.json(updatedBook)
})

app.post('/addbook', async (req, res) => {

  const allBooks = await Book.find()
  const getLastId = allBooks.sort((a, b) => (a.bookID > b.bookID) ? 1 : -1)

  new Book(
    {
      bookID: getLastId[getLastId.length - 1].bookID + 1,
      title: req.body.title,
      authors: req.body.author,
      img_url: req.body.image ?? '',
      num_pages: req.body.pages ?? 0

    }
  ).save()
  res.send('book saved')
})

const testCheck = (baseSquare, squares, i) => {
  const validSquares = []

  if (baseSquare.piece.type.includes('pawn') && baseSquare.piece.moved) {
    if (baseSquare.piece.color === 'white') {
      squares.forEach((square) => {
        if ((baseSquare._id === square._id)) {
          validSquares.push(square)
        } else if (square.column === baseSquare.column && square.row === baseSquare.row + 1 && square.piece && !square.piece.type) {
          validSquares.push(square)
        } else if ((square.column === baseSquare.column + 1 || square.column === baseSquare.column - 1) &&
          square.row === baseSquare.row + 1 && square.piece &&
          square.piece.color && square.piece.color !== baseSquare.piece.color) {
          validSquares.push(square)
        } else {
          square.valid = false;
        }
      })
    } else {
      squares.forEach((square) => {
        if (baseSquare._id === square._id) {
          validSquares.push(square)
        } else if ((square.column === baseSquare.column && square.row === baseSquare.row - 1 && !square.piece) ||
          (square.column === baseSquare.column && square.row === baseSquare.row - 1 && square.piece && !square.piece.type)) {
          validSquares.push(square)
        } else if ((square.column === baseSquare.column + 1 || square.column === baseSquare.column - 1) &&
          square.row === baseSquare.row - 1 && square.piece && square.piece.color && square.piece.color !== baseSquare.piece.color) {
          validSquares.push(square)
        } else {
          square.valid = false;
        }

      })
    }


  } else if (baseSquare.piece.type.includes('pawn') && !baseSquare.piece.moved) {
    if (baseSquare.piece.color === 'white') {
      let i = 1;
      for (i = 1; i <= 2; i++) {
        squares.forEach((square) => {
          if (baseSquare._id === square._id) {
            validSquares.push(square)
          } else if ((square.column === baseSquare.column && square.row === baseSquare.row + i && !square.piece) ||
            (square.column === baseSquare.column && square.row === baseSquare.row + i && square.piece && !square.piece.color)) {
            validSquares.push(square)
          } else if (square.column === baseSquare.column && square.row === baseSquare.row + i && square.piece) {
            i = 5;
          }
        })
      }
      squares.forEach((square) => {
        if ((square.column === baseSquare.column + 1 || square.column === baseSquare.column - 1) &&
          square.row === baseSquare.row + 1 &&
          square.piece && square.piece.type && square.piece.color !== baseSquare.piece.color) {
          validSquares.push(square)
        }

      })

    } else if (baseSquare.piece.color === 'black') {
      let i = -1;
      for (i = -1; i >= -2; i--) {
        squares.forEach((square) => {
          if (baseSquare._id === square._id) {
            validSquares.push(square)
          } else if ((square.column === baseSquare.column && square.row === baseSquare.row + i && !square.piece) ||
            (square.column === baseSquare.column && square.row === baseSquare.row + i && !square.piece)) {
            validSquares.push(square)
          } else if (square.column === baseSquare.column && square.row === baseSquare.row + i && square.piece) {
            i = -5;
          }
        })
      }
      squares.forEach((square) => {
        if ((square.column === baseSquare.column + 1 || square.column === baseSquare.column - 1) &&
          square.row === baseSquare.row - 1 &&
          square.piece && square.piece.type && square.piece.color !== baseSquare.piece.color) {
          validSquares.push(square)
        }

      })
    }

  } else if (baseSquare.piece.type.includes('bishop')) {

    const bishopMoves = [
      { x: 1, y: 1 },
      { x: 1, y: -1 },
      { x: -1, y: 1 },
      { x: -1, y: -1 }
    ]
    bishopMoves.forEach((dir) => {
      let scale = 1;
      for (scale = 1; scale <= 8; scale++) {
        let offset = { x: dir.x * scale, y: dir.y * scale }
        squares.forEach((square) => {
          if ((baseSquare._id === square._id) ||
            (square.row === baseSquare.row + offset.x && square.column === baseSquare.column + offset.y)) {
            if (square.row === baseSquare.row + offset.x && square.column === baseSquare.column + offset.y && square.piece && square.piece.color && square.piece.color !== baseSquare.piece.color) {
              validSquares.push(square)
              scale = 9;
            } else if ((square.row === baseSquare.row + offset.x && square.column === baseSquare.column + offset.y && !square.piece) ||
              (square.row === baseSquare.row + offset.x && square.column === baseSquare.column + offset.y && !square.piece.type) ||
              baseSquare._id === square._id) {
              validSquares.push(square)
            } else {
              square.valid = false;
              scale = 9;
            }
          }
        })
      }
    })

  } else if (baseSquare.piece.type.includes('rook')) {
    const rookMoves = [
      { x: 0, y: 1 },
      { x: 0, y: -1 },
      { x: 1, y: 0 },
      { x: -1, y: 0 }
    ]
    rookMoves.forEach((dir) => {
      let scale = 1;
      for (scale = 1; scale <= 8; scale++) {
        const offset = { x: dir.x * scale, y: dir.y * scale }
        squares.forEach((square) => {
          if ((square.column === baseSquare.column && square.row === baseSquare.row + offset.x) ||
            (square.row === baseSquare.row && square.column === baseSquare.column + offset.y)) {
            if (square.piece && square.piece.color && square.piece.color !== baseSquare.piece.color) {
              validSquares.push(square)
              scale = 9;
            } else if ((square.column === baseSquare.column && square.row === baseSquare.row + offset.x && !square.piece) ||
              (square.column === baseSquare.column && square.row === baseSquare.row + offset.x && square.piece && !square.piece.type) ||
              (square.row === baseSquare.row && square.column === baseSquare.column + offset.y && !square.piece) ||
              (square.row === baseSquare.row && square.column === baseSquare.column + offset.y && square.piece && !square.piece.type) ||
              (baseSquare._id === square._id)) {
              validSquares.push(square)
            } else {
              square.valid = false;
              scale = 9;
            }

          }
        })
      }
    })

  } else if (baseSquare.piece.type.includes('knight')) {
    const knightMoves = [
      { x: 2, y: 1 },
      { x: -2, y: 1 },
      { x: 2, y: -1 },
      { x: -2, y: -1 },
      { x: 1, y: 2 },
      { x: 1, y: -2 },
      { x: -1, y: 2 },
      { x: -1, y: -2 }
    ]

    knightMoves.forEach((dir) => {
      let scale = 1;
      for (scale = 1; scale <= 1; scale++) {
        const offset = { x: dir.x * scale, y: dir.y * scale }
        squares.forEach((square) => {
          if (baseSquare._id === square._id) {
            validSquares.push(square)
          } else if ((square.row === baseSquare.row + offset.x && square.column === baseSquare.column + offset.y) &&
            (!square.piece || square.piece.color !== baseSquare.piece.color)) {
            validSquares.push(square)
            scale = 9;
          }
        })
      }
    })
  } else if (baseSquare.piece.type.includes('queen')) {

    const queenMoves = [
      { x: 0, y: 1, type: "straight" },
      { x: 0, y: -1, type: "straight" },
      { x: 1, y: 0, type: "straight" },
      { x: -1, y: 0, type: "straight" },
      { x: 1, y: 1, type: "diagonal" },
      { x: 1, y: -1, type: "diagonal" },
      { x: -1, y: 1, type: "diagonal" },
      { x: -1, y: -1, type: "diagonal" }
    ]
    queenMoves.forEach((dir) => {
      let scale = 1;
      for (scale = 1; scale <= 8; scale++) {
        const offset = { x: dir.x * scale, y: dir.y * scale }
        if (dir.type === "straight") {
          squares.forEach((square) => {
            if ((square.column === baseSquare.column && square.row === baseSquare.row + offset.x) ||
              (square.row === baseSquare.row && square.column === baseSquare.column + offset.y)) {
              if (square.piece && square.piece.color && square.piece.color !== baseSquare.piece.color) {
                validSquares.push(square)
                scale = 9;
              } else if ((square.column === baseSquare.column && square.row === baseSquare.row + offset.x && !square.piece) ||
                (square.column === baseSquare.column && square.row === baseSquare.row + offset.x && square.piece && !square.piece.color) ||
                (square.row === baseSquare.row && square.column === baseSquare.column + offset.y && !square.piece) ||
                (square.row === baseSquare.row && square.column === baseSquare.column + offset.y && square.piece && !square.piece.color) ||
                (baseSquare._id === square._id)) {
                validSquares.push(square)
              } else {
                square.valid = false;
                scale = 9;
              }
            }
          })
        } else {
          squares.forEach((square) => {
            if ((baseSquare._id === square._id) ||
              (square.row === baseSquare.row + offset.x && square.column === baseSquare.column + offset.y)) {
              if (square.row === baseSquare.row + offset.x && square.column === baseSquare.column + offset.y && square.piece && square.piece.color && square.piece.color !== baseSquare.piece.color) {
                validSquares.push(square)
                scale = 9;
              } else if ((square.row === baseSquare.row + offset.x && square.column === baseSquare.column + offset.y && !square.piece) ||
                (square.row === baseSquare.row + offset.x && square.column === baseSquare.column + offset.y && square.piece && !square.piece.color) ||
                baseSquare._id === square._id) {
                validSquares.push(square)
              } else {
                square.valid = false;
                scale = 9;
              }
            }
          })
        }
      }

    })
  } else if (baseSquare.piece.type.includes('king')) {
    const kingMoves = [
      { x: 0, y: 1, type: "straight" },
      { x: 0, y: -1, type: "straight" },
      { x: 1, y: 0, type: "straight" },
      { x: -1, y: 0, type: "straight" },
      { x: 1, y: 1, type: "diagonal" },
      { x: 1, y: -1, type: "diagonal" },
      { x: -1, y: 1, type: "diagonal" },
      { x: -1, y: -1, type: "diagonal" }
    ]
    kingMoves.forEach((dir) => {
      let scale = 1;
      for (scale = 1; scale <= 1; scale++) {
        const offset = { x: dir.x * scale, y: dir.y * scale }
        if (dir.type === "straight") {
          squares.forEach((square) => {
            if ((square.column === baseSquare.column && square.row === baseSquare.row + offset.x) ||
              (square.row === baseSquare.row && square.column === baseSquare.column + offset.y)) {
              if (square.piece && square.piece.color !== baseSquare.piece.color && square.piece.type !== 'king') {
                validSquares.push(square)
                scale = 9;
              } else if ((square.column === baseSquare.column && square.row === baseSquare.row + offset.x && !square.piece) ||
                (square.row === baseSquare.row && square.column === baseSquare.column + offset.y && !square.piece)) {
                validSquares.push(square)
              } else {
                square.valid = false;
                scale = 9;
              }
            }
          })
        } else {
          squares.forEach((square) => {
            if ((baseSquare._id === square._id) ||
              (square.row === baseSquare.row + offset.x && square.column === baseSquare.column + offset.y)) {
              if (square.row === baseSquare.row + offset.x && square.column === baseSquare.column + offset.y && square.piece && square.piece.color !== baseSquare.piece.color && square.piece.type !== 'king') {
                validSquares.push(square)
                scale = 9;
              } else if ((square.row === baseSquare.row + offset.x && square.column === baseSquare.column + offset.y && !square.piece)) {
                validSquares.push(square)
              } else {
                square.valid = false;
                scale = 9;
              }
            }
          })
        }
      }

    })
  }
  const check = validSquares.filter((square) => square.piece && square.piece.type === 'king')

  if (check.length > 0) {
    console.log(`${check[0].piece.color} is in check from ${baseSquare.piece.type}`)
    socketIo.emit('check', `${check[0].piece.color}`)
    return check[0].piece.color
  } else {
    socketIo.emit('check', false)
    return false
  }
}



socketIo.on('connection', socket => {
  socketIo.emit('greeting', 'hello')
  socket.on('disconnect', () => {
    console.log('user left')
  })

  // socket.conn.on('packet', function (packet) {
  //   if (packet.type === 'ping') console.log('received ping');
  // });
  socket.on('movePiece', async data => {

    const user = await User.findOne({ _id: data.roomid })
    const updatedBoard = user.gameBoard
    let movedTo = await updatedBoard.find((square) => square.row === +data.targetSquare.row && square.column === +data.targetSquare.column)
    let movedFrom = updatedBoard.find((square) => square.row === +data.baseSquare.row && square.column === +data.baseSquare.column)
    movedTo.piece = movedFrom.piece
    movedFrom.piece = {}
    const lastMove = {
      movedFrom: movedFrom,
      movedTo: movedTo,
      pieceMoved: movedTo.piece
    }
    let occupiedSquares = updatedBoard.filter((square) => square.piece && square.piece.color)
    let i = 0;
    while (i <= occupiedSquares.length) {
      if (i === occupiedSquares.length) {
        movedTo.piece.moved = true;
        const userBoard = await User.findOneAndUpdate({ _id: data.roomid }, { gameBoard: updatedBoard }, { new: true })
        if (data.promote) {
          if (data.targetSquare.piece && data.targetSquare.piece.type) {
            socketIo.emit('update', { board: { board: userBoard.gameBoard, writable: true }, promote: data.color, takenPiece: data.targetSquare.piece, lastMove: lastMove })
          } else {
            socketIo.emit('update', { board: { board: userBoard.gameBoard, writable: true }, promote: data.color, lastMove: lastMove })
          }
        } else if (data.targetSquare.piece && data.targetSquare.piece.type) {
          console.log('piece taken')
          socketIo.emit('update', { board: { board: userBoard.gameBoard, writable: true }, currentTurn: data.color === "white" ? "black" : "white", takenPiece: data.targetSquare.piece, lastMove: lastMove })
        } else {
          console.log('piece not taken')
          socketIo.emit('update', { board: { board: userBoard.gameBoard, writable: true }, currentTurn: data.color === "white" ? "black" : "white", lastMove: lastMove })
        }
        break;
      } else if (testCheck(occupiedSquares[i], updatedBoard) === false) {
        i++
      } else if (testCheck(occupiedSquares[i], updatedBoard) === data.color) {
        // const userBoard = await User.findOneAndUpdate({ _id: data.roomid }, { gameBoard: updatedBoard }, { new: true })
        // socketIo.emit('update', { board: { board: userBoard.gameBoard, writable: true } })
        movedFrom.piece = movedTo.piece
        if (data.targetSquare.piece && data.targetSquare.piece.type) {
          movedTo.piece = data.targetSquare.piece
        } else {
          movedTo.piece = {}
        }
        const revertedBoard = await User.findOneAndUpdate({ _id: data.roomid }, { gameBoard: updatedBoard }, { new: true })
        setTimeout(() => { socketIo.emit('update', { board: { board: revertedBoard.gameBoard, writable: true }, currentTurn: data.color }) }, 500)
        //the next two lines of code are so that if player puts himself into check but was not in check before
        //after the game reverts his move it doesn't still say player is in check. It seems to work but causes
        //lag
        // occupiedSquares = updatedBoard.filter((square) => square.piece && square.piece.type)
        //i = 0
      } else {
        const userBoard = await User.findOneAndUpdate({ _id: data.roomid }, { gameBoard: updatedBoard }, { new: true })
        if (data.targetSquare.piece && data.targetSquare.piece.type) {
          socketIo.emit('update', { board: { board: userBoard.gameBoard, writable: true }, currentTurn: data.color === "white" ? "black" : "white", takenPiece: data.targetSquare.piece, lastMove: lastMove })
        } else {
          socketIo.emit('update', { board: { board: userBoard.gameBoard, writable: true }, currentTurn: data.color === "white" ? "black" : "white", lastMove: lastMove })
        }
        break;
      }

    }

  })
  socket.on('castle', async data => {
    const user = await User.findOne({ _id: data.roomid })
    const updatedBoard = user.gameBoard
    const newSquare = updatedBoard.find((square) => square.row === data.targetSquare.row && square.column === (data.targetSquare.column === 1 ? data.targetSquare.column + 2 : data.targetSquare.column - 1))
    const rookSquare = updatedBoard.find((square) => square.row === data.baseSquare.row && square.column === (data.targetSquare.column === 1 ? newSquare.column + 1 : newSquare.column - 1))
    newSquare.piece = data.baseSquare.piece
    rookSquare.piece = data.targetSquare.piece

    const formerRookSquare = updatedBoard.find((square) => square.row === data.targetSquare.row && square.column === data.targetSquare.column)
    formerRookSquare.piece = {}
    const formerKingSquare = updatedBoard.find((square) => square.row === data.baseSquare.row && square.column === data.baseSquare.column)
    formerKingSquare.piece = {}
    const lastMove = {
      movedFrom: formerKingSquare,
      movedTo: newSquare,
      pieceMoved: newSquare.piece
    }
    let occupiedSquares = updatedBoard.filter((square) => square.piece && square.piece.color)
    let i = 0;
    while (i <= occupiedSquares.length) {

      if (i === occupiedSquares.length) {
        rookSquare.piece.moved = true
        newSquare.piece.moved = true
        const userBoard = await User.findOneAndUpdate({ _id: data.roomid }, { gameBoard: updatedBoard }, { new: true })
        socketIo.emit('update', { board: { board: userBoard.gameBoard, writable: true }, currentTurn: data.color === "white" ? "black" : "white", lastMove: lastMove })
        break;
      } else if (testCheck(occupiedSquares[i], updatedBoard) === false) {
        i++
      } else if (testCheck(occupiedSquares[i], updatedBoard) === data.color) {
        console.log('revert move')
        const userBoard = await User.findOneAndUpdate({ _id: data.roomid }, { gameBoard: updatedBoard }, { new: true })
        socketIo.emit('update', { board: { board: userBoard.gameBoard, writable: true } })
        formerRookSquare.piece = data.targetSquare.piece
        formerKingSquare.piece = data.baseSquare.piece
        newSquare.piece = {}
        rookSquare.piece = {}
        const revertedBoard = await User.findOneAndUpdate({ _id: data.roomid }, { gameBoard: updatedBoard }, { new: true })
        setTimeout(() => { socketIo.emit('update', { board: { board: revertedBoard.gameBoard, writable: true }, currentTurn: data.color }) }, 500)
        break;
      } else {
        const userBoard = await User.findOneAndUpdate({ _id: data.roomid }, { gameBoard: updatedBoard }, { new: true })
        socketIo.emit('update', { board: { board: userBoard.gameBoard, writable: true }, currentTurn: data.color === "white" ? "black" : "white", lastMove: lastMove })
        break;
      }

    }
  })

  socket.on('enPassant', async data => {
    const user = await User.findOne({ _id: data.roomid })
    const updatedBoard = user.gameBoard
    const newSquare = updatedBoard.find((square) => square.row === data.targetSquare.row && square.column === data.targetSquare.column)
    newSquare.piece = data.oldSquare.piece
    const formerSquare = updatedBoard.find((square) => square.row === data.oldSquare.row && square.column === data.oldSquare.column)
    formerSquare.piece = {}
    const takenPawnSquare = newSquare.piece.color === 'white' ? updatedBoard.find((square) => square.column === newSquare.column && square.row === newSquare.row - 1)
      : updatedBoard.find((square) => square.column === newSquare.column && square.row === newSquare.row + 1)
    const takenPawnPiece = takenPawnSquare.piece
    takenPawnSquare.piece = {}
    const lastMove = {
      movedFrom: formerSquare,
      movedTo: newSquare,
      pieceMoved: newSquare.piece
    }
    let occupiedSquares = updatedBoard.filter((square) => square.piece && square.piece.color)
    let i = 0;
    while (i <= occupiedSquares.length) {

      if (i === occupiedSquares.length) {
        const userBoard = await User.findOneAndUpdate({ _id: data.roomid }, { gameBoard: updatedBoard }, { new: true })
        socketIo.emit('update', { board: { board: userBoard.gameBoard, writable: true }, currentTurn: data.color === "white" ? "black" : "white", lastMove: lastMove, takenPiece: takenPawnPiece })
        break;
      } else if (testCheck(occupiedSquares[i], updatedBoard) === false) {
        i++
      } else if (testCheck(occupiedSquares[i], updatedBoard) === data.color) {
        console.log('revert move')
        const userBoard = await User.findOneAndUpdate({ _id: data.roomid }, { gameBoard: updatedBoard }, { new: true })
        socketIo.emit('update', { board: { board: userBoard.gameBoard, writable: true } })
        newSquare.piece = {}
        formerSquare.piece = data.oldSquare.piece
        takenPawnSquare.piece = takenPawnPiece
        const revertedBoard = await User.findOneAndUpdate({ _id: data.roomid }, { gameBoard: updatedBoard }, { new: true })
        setTimeout(() => { socketIo.emit('update', { board: { board: revertedBoard.gameBoard, writable: true }, currentTurn: data.color }) }, 500)
        break;
      } else {
        const userBoard = await User.findOneAndUpdate({ _id: data.roomid }, { gameBoard: updatedBoard }, { new: true })
        socketIo.emit('update', { board: { board: userBoard.gameBoard, writable: true }, currentTurn: data.color === "white" ? "black" : "white", lastMove: lastMove, takenPiece: takenPawnPiece })
        break;
      }

    }
  })

  socket.on('pawnPromotion', async data => {
    const user = await User.findOne({ _id: data.roomid })
    const updatedBoard = user.gameBoard
    let movedTo = await updatedBoard.find((square) => square.row === +data.targetSquare.row && square.column === +data.targetSquare.column)
    movedTo.piece = data.piece
    const userBoard = await User.findOneAndUpdate({ _id: data.roomid }, { gameBoard: updatedBoard }, { new: true })
    socketIo.emit('update', { board: { board: userBoard.gameBoard, writable: true }, currentTurn: data.piece.color === "white" ? "black" : "white", promotedPiece: data.piece })

  })

})




// Start the server
http.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`)
})




