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
  const squares = await Square.find()
  res.json(squares)
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
  try {
    const user = await User.findOne({ _id: req.params.roomid })
    const updatedBoard = user.gameBoard
    let movedTo = await updatedBoard.find((square) => square.row === +req.body.targetSquare.row && square.column === +req.body.targetSquare.column)
    let movedFrom = updatedBoard.find((square) => square.row === +req.body.baseSquare.row && square.column === +req.body.baseSquare.column)
    movedTo.piece = movedFrom.piece
    movedFrom.piece = {}
    const userBoard = await User.findOneAndUpdate({ _id: req.params.roomid }, { gameBoard: updatedBoard }, { new: true })
    res.status(200).json({ board: userBoard.gameBoard, currentTurn: req.body.color === "white" ? "black" : "white" })
  } catch (err) {
    res.status(404).json({ message: "Invalid move", error: err })
  }
})

app.get('/game/:roomid/reset', async (req, res) => {
  try {
    const squares = await Square.find()
    const updatedUser = await User.findOneAndUpdate({ _id: req.params.roomid }, { gameBoard: squares }, { new: true })
    res.status(200).json(updatedUser.gameBoard)
  } catch (err) {
    res.status(404).json({ message: "Only the host can reset the game", error: err })
  }


})

app.post('/signup', async (req, res) => {
  try {
    const chessBoard = await Square.find()
    const username = req.body.username.charAt(0).toUpperCase() + req.body.username.slice(1).toLowerCase()
    const { email, password } = req.body
    const user = await new User({ username, email, password: bcrypt.hashSync(password), gameBoard: chessBoard, initialBoardState: chessBoard }).save()
    res.status(201).json({ id: user._id, accessToken: user.accessToken, profileImage: user.profileImage })
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

// Start the server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`)
})
