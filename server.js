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
  email: {
    type: String,
    required: true,
    minLength: 3,
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

///INITIAL GAME STATE////

app.get('/game/:roomid', authenticateUser)
app.get('/game/:roomid', async (req, res) => {

  try {
    const squares = await Square.find()
    const host = await User.findOneAndUpdate({ _id: req.params.roomid }, { gameBoard: squares }, { new: true })
    const user = await User.findOne({ accessToken: req.header('Authorization') })
    Square.find()
    res.json({
      gameBoard: host.gameBoard,
      username: user.username, host: host.username, color: host.username === user.username ? "white" : "black"
    })

  } catch (err) {
    res.json({ message: "Room does not exist", error: err })
  }

})

///SIGNUP ENDPOINT///

app.post('/signup', async (req, res) => {
  try {
    const chessBoard = await Square.find()
    const email = req.body.email
    const existingUser = await User.findOne({ email: email })

    if (existingUser) {
      res.status(404).json({ error: "Email already in use." })
    } else {
      const username = req.body.username.charAt(0).toUpperCase() + req.body.username.slice(1).toLowerCase()

      const { password } = req.body
      const user = await new User({ username, email, password: bcrypt.hashSync(password), gameBoard: chessBoard }).save()
      res.status(201).json({ id: user._id, accessToken: user.accessToken })
    }
  } catch (err) {
    res.status(404).json({ error: "Username exists" })
  }
})

///LOGIN ENDPOINT///
app.post('/sessions', async (req, res) => {
  const user = await User.findOne({ email: req.body.email });
  if (user && bcrypt.compareSync(req.body.password, user.password)) {
    res.json({ userId: user._id, accessToken: user.accessToken, username: user.username })
  } else {
    res.status(404).json({ error: "Invalid username or password" })
  }
})

///TESTING CHECK////

const testCheck = (baseSquare, squares, gameRoom, alreadyInCheck, color) => {
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
    if (alreadyInCheck && check[0].piece.color !== color) {
      gameRoom.emit('check', color)
      return color
    } else {
      gameRoom.emit('check', `${check[0].piece.color}`)
      return check[0].piece.color
    }

  } else {
    gameRoom.emit('check', false)
    return false
  }
}

//////WEBSOCKET STUFF/////

socketIo.on('connection', socketOne => {

  const gameRoom = socketIo.of(`/${socketOne.request._query.id}`)


  gameRoom.on('connection', socket => {

    socket.on('disconnect', () => {
      gameRoom.emit('userLeft', 'User Left!')
      gameRoom.removeAllListeners()
    })

    ///NORMAL PIECE MOVEMENT/////

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
      ///CHECK IF PIECE MOVEMENT PLACES EITHER PLAYER IN CHECK///

      let occupiedSquares = updatedBoard.filter((square) => square.piece && square.piece.color)
      let i = 0;
      while (i <= occupiedSquares.length) {
        if (i === occupiedSquares.length) {
          movedTo.piece.moved = true;
          const userBoard = await User.findOneAndUpdate({ _id: data.roomid }, { gameBoard: updatedBoard }, { new: true })
          if (data.promote) {
            if (data.targetSquare.piece && data.targetSquare.piece.type) {
              gameRoom.emit('update', { board: { board: userBoard.gameBoard, writable: true }, promote: data.color, takenPiece: data.targetSquare.piece, lastMove: lastMove })
            } else {
              gameRoom.emit('update', { board: { board: userBoard.gameBoard, writable: true }, promote: data.color, lastMove: lastMove })
            }
          } else if (data.targetSquare.piece && data.targetSquare.piece.type) {
            console.log('piece taken')
            gameRoom.emit('update', { board: { board: userBoard.gameBoard, writable: true }, currentTurn: data.color === "white" ? "black" : "white", takenPiece: data.targetSquare.piece, lastMove: lastMove })
          } else {
            console.log('piece not taken')
            gameRoom.emit('update', { board: { board: userBoard.gameBoard, writable: true }, currentTurn: data.color === "white" ? "black" : "white", lastMove: lastMove })
          }
          break;
        } else if (testCheck(occupiedSquares[i], updatedBoard, gameRoom, data.check, data.color) === false) {
          i++
        } else if (testCheck(occupiedSquares[i], updatedBoard, gameRoom, data.check, data.color) === data.color) {
          movedFrom.piece = data.baseSquare.piece
          if (data.targetSquare.piece && data.targetSquare.piece.type) {
            movedTo.piece = data.targetSquare.piece
          } else {
            movedTo.piece = {}
          }
          if (!data.check) {
            gameRoom.emit('check', false)
          }
          const revertedBoard = await User.findOneAndUpdate({ _id: data.roomid }, { gameBoard: updatedBoard }, { new: true })
          gameRoom.emit('update', { board: { board: revertedBoard.gameBoard, writable: true }, currentTurn: data.color })
          break;
        } else {
          const userBoard = await User.findOneAndUpdate({ _id: data.roomid }, { gameBoard: updatedBoard }, { new: true })
          if (data.targetSquare.piece && data.targetSquare.piece.type) {
            gameRoom.emit('update', { board: { board: userBoard.gameBoard, writable: true }, currentTurn: data.color === "white" ? "black" : "white", takenPiece: data.targetSquare.piece, lastMove: lastMove })
          } else {
            gameRoom.emit('update', { board: { board: userBoard.gameBoard, writable: true }, currentTurn: data.color === "white" ? "black" : "white", lastMove: lastMove })
          }
          break;
        }

      }

    })

    ////CASTLING////

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

      ///CHECK IF CASTLING PLACES EITHER PLAYER IN CHECK///

      let occupiedSquares = updatedBoard.filter((square) => square.piece && square.piece.color)
      let i = 0;
      while (i <= occupiedSquares.length) {

        if (i === occupiedSquares.length) {
          rookSquare.piece.moved = true
          newSquare.piece.moved = true
          const userBoard = await User.findOneAndUpdate({ _id: data.roomid }, { gameBoard: updatedBoard }, { new: true })
          gameRoom.emit('update', { board: { board: userBoard.gameBoard, writable: true }, currentTurn: data.color === "white" ? "black" : "white", lastMove: lastMove })
          break;
        } else if (testCheck(occupiedSquares[i], updatedBoard, gameRoom, data.check, data.color) === false) {
          i++
        } else if (testCheck(occupiedSquares[i], updatedBoard, gameRoom, data.check, data.color) === data.color) {
          console.log('revert move')
          const userBoard = await User.findOneAndUpdate({ _id: data.roomid }, { gameBoard: updatedBoard }, { new: true })
          gameRoom.emit('update', { board: { board: userBoard.gameBoard, writable: true } })
          formerRookSquare.piece = data.targetSquare.piece
          formerKingSquare.piece = data.baseSquare.piece
          newSquare.piece = {}
          rookSquare.piece = {}
          const revertedBoard = await User.findOneAndUpdate({ _id: data.roomid }, { gameBoard: updatedBoard }, { new: true })
          setTimeout(() => { gameRoom.emit('update', { board: { board: revertedBoard.gameBoard, writable: true }, currentTurn: data.color }) }, 500)
          break;
        } else {
          const userBoard = await User.findOneAndUpdate({ _id: data.roomid }, { gameBoard: updatedBoard }, { new: true })
          gameRoom.emit('update', { board: { board: userBoard.gameBoard, writable: true }, currentTurn: data.color === "white" ? "black" : "white", lastMove: lastMove })
          break;
        }

      }
    })

    /////EN PASSANT/////

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

      ///CHECK IF EN PASSANT PLACES EITHER PLAYER IN CHECK////

      let occupiedSquares = updatedBoard.filter((square) => square.piece && square.piece.color)
      let i = 0;
      while (i <= occupiedSquares.length) {

        if (i === occupiedSquares.length) {
          const userBoard = await User.findOneAndUpdate({ _id: data.roomid }, { gameBoard: updatedBoard }, { new: true })
          gameRoom.emit('update', { board: { board: userBoard.gameBoard, writable: true }, currentTurn: data.color === "white" ? "black" : "white", lastMove: lastMove, takenPiece: takenPawnPiece })
          break;
        } else if (testCheck(occupiedSquares[i], updatedBoard, gameRoom, data.check, data.color) === false) {
          i++
        } else if (testCheck(occupiedSquares[i], updatedBoard, gameRoom, data.check, data.color) === data.color) {
          console.log('revert move')
          const userBoard = await User.findOneAndUpdate({ _id: data.roomid }, { gameBoard: updatedBoard }, { new: true })
          gameRoom.emit('update', { board: { board: userBoard.gameBoard, writable: true } })
          newSquare.piece = {}
          formerSquare.piece = data.oldSquare.piece
          takenPawnSquare.piece = takenPawnPiece
          const revertedBoard = await User.findOneAndUpdate({ _id: data.roomid }, { gameBoard: updatedBoard }, { new: true })
          setTimeout(() => { gameRoom.emit('update', { board: { board: revertedBoard.gameBoard, writable: true }, currentTurn: data.color }) }, 500)
          break;
        } else {
          const userBoard = await User.findOneAndUpdate({ _id: data.roomid }, { gameBoard: updatedBoard }, { new: true })
          gameRoom.emit('update', { board: { board: userBoard.gameBoard, writable: true }, currentTurn: data.color === "white" ? "black" : "white", lastMove: lastMove, takenPiece: takenPawnPiece })
          break;
        }

      }
    })

    ///PAWN PROMOTION////

    socket.on('pawnPromotion', async data => {
      const user = await User.findOne({ _id: data.roomid })
      const updatedBoard = user.gameBoard
      let movedTo = await updatedBoard.find((square) => square.row === +data.targetSquare.row && square.column === +data.targetSquare.column)
      movedTo.piece = data.piece
      const userBoard = await User.findOneAndUpdate({ _id: data.roomid }, { gameBoard: updatedBoard }, { new: true })
      gameRoom.emit('update', { board: { board: userBoard.gameBoard, writable: true }, currentTurn: data.piece.color === "white" ? "black" : "white", promotedPiece: data.piece })

    })

    ///GUEST ENTERS HOST ROOM///
    socket.on('arrival', data => {
      socket.broadcast.emit('storeGuest', { username: data.username, color: data.color })
    })

    ///PLAYER RESIGNS////
    socket.on('resign', data => {
      gameRoom.emit('winner', 'Player wins')
    })

    ///RESET GAME/////
    socket.on('reset', async data => {
      try {
        const squares = await Square.find()
        const updatedUser = await User.findOneAndUpdate({ _id: data }, { gameBoard: squares }, { new: true })
        gameRoom.emit('newGame', updatedUser.gameBoard)
      } catch (err) {
        console.log(err)
      }
    })


  })
})


http.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`)
})




