require('dotenv').config()
const express = require('express')
const cors = require('cors')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY)
const admin = require('firebase-admin')
const port = process.env.PORT || 3000
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString(
  'utf-8'
)
const serviceAccount = JSON.parse(decoded)
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
})

const app = express()
// middleware
app.use(
  cors({
    origin: [process.env.CLIENT_DOMAIN],
    credentials: true,
    optionsSuccessStatus: 200,
  })
)
app.use(express.json())

// jwt middlewares
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(' ')[1]
  console.log(token)
  if (!token) return res.status(401).send({ message: 'Unauthorized Access!' })
  try {
    const decoded = await admin.auth().verifyIdToken(token)
    req.tokenEmail = decoded.email
    console.log(decoded)
    next()
  } catch (err) {
    console.log(err)
    return res.status(401).send({ message: 'Unauthorized Access!', err })
  }
}

 // role middlewares
    const verifyADMIN = async (req, res, next) => {
      const email = req.tokenEmail
      const user = await usersCollection.findOne({ email })
      if (user?.role !== 'admin')
        return res
          .status(403)
          .send({ message: 'Admin only Actions!', role: user?.role })

      next()
    }

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})
async function run() {
  try {
    const db = client.db('ticketbariDB')
    const plantsCollection = db.collection('plants')
    const ticketsCollection = db.collection('tickets')
    const usersCollection = db.collection('users')
    const sellerRequestsCollection = db.collection('sellerRequests')

    app.post('/user', async (req, res) => {
        try {
            const userData = req.body
            if (!userData?.email) return res.status(400).send({ message: 'Email required' })
            userData.created_at = userData.created_at || new Date().toISOString()
      userData.last_loggedIn = new Date().toISOString()
      userData.role = userData.role || 'customer'

      const query = { email: userData.email }
      const update = { $set: userData }
      const opts = { upsert: true }
      const result = await usersCollection.updateOne(query, update, opts)
       return res.send(result)
        } catch (error) {
            console.error('/user error', error)
            res.status(500).send({ message: 'Server error' })
        }
    })

    // get all ticket for admin
    app.get('/admin/tickets', async (req, res) => {
      const result = await ticketsCollection.find().toArray()
      res.send(result)
    })
    // Admin: toggle advertise, enforce max 6 advertised
    app.patch('/admin/tickets/advertise/:id', async (req, res) => {
        const id = req.params.id
        if (!ObjectId.isValid(id)) return res.status(400).send({ message: 'Invalid id' })
            const ticket = await ticketsCollection.findOne({ _id: new ObjectId(id) })
        if (!ticket) return res.status(404).send({ message: 'Ticket not found' })
        if (ticket.verificationStatus !== 'approved') return res.status(400).send({ message: 'Only approved tickets can be advertised' })
        if (!ticket.isAdvertised) {
            const count = await ticketsCollection.countDocuments({ isAdvertised: true, verificationStatus: 'approved' })
            if ( count >= 6 ) return res.status(400).send({ message: 'Max 6 advertised' })
        }
    await ticketsCollection.updateOne({ _id: new ObjectId(id) }, { $set: { isAdvertised: !ticket.isAdvertised }})
    res.send({ message: 'Toggled advertise', isAdvertised: !ticket.isAdvertised })
    })



    // get advertised tickets(max 6)
    app.get('/tickets/advertised-home', async (req, res) => {
      const docs = await usersCollection.find({ isAdvertised: true, verificationStatus: 'approved' }).limit(6).toArray()
      res.send(docs)
    })

    // ticket booking
    app.post("/booking", async (req, res) => {
      const { ticketId, quantity, status } = req.body;

      const ticket = await Ticket.findById(ticketId);

      if (!ticket) {
        return res.status(404).json({ message: "Ticket not found" })
      }
      const booking = await Booking.create({
        ticketId,
        quantity,
        status,
      })
      ticket.quantity -= quantity;
    await ticket.save();

    res.json({ message: "Booking successful", booking })
    })
    


    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 })
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    )
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Hello from Server..')
})

app.listen(port, () => {
  console.log(`Server is running on port ${port}`)
})
