import express from 'express'
import bodyParser from 'body-parser'
import cors from 'cors'
import mongoose from 'mongoose'
import data from './data/squares.json'


const mongoUrl = process.env.MONGO_URL || "mongodb://localhost/final-project"
mongoose.connect(mongoUrl, { useNewUrlParser: true, useUnifiedTopology: true })
mongoose.Promise = Promise


const port = process.env.PORT || 8080
const app = express()

// Add middlewares to enable cors and json body parsing
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
    maxlength: 20
  },
  password: {
    type: String,
    minlength: 8
  },
  ratings: {
    type: Array,
    default: []
  },
  profilePicture: {
    type: String,
    default: ''
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


app.get('/', (req, res) => {
  res.json({
    squares: '/squares'
  })
})


app.get('/squares', async (req, res) => {

  const squares = await Square.find()

  res.json(squares)

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
