const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const express = require('express');
const app = express()
const port = process.env.PORT || 5000
const cors = require('cors');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const stripe = require("stripe")('sk_test_51PMkAURq3LucX1YUccSNvi0f6mYvygda5g290SZImBfLKezdCXuLJsZzVRWDbmlxdvo8P3RkPWlExHTfGAmheC9D00Ml288FrT');
require('dotenv').config()
const admin = require("firebase-admin");
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});



//middleware
app.use(cookieParser())
app.use(cors({
    origin: ['http://localhost:5173', 'https://a12-employee-management-6ca56.web.app', 'https://a12-employee-management-6ca56.firebaseapp.com'],
    credentials: true
}))
app.use(express.json())
const cookieOption = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' ? true : false,
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'Strict'
}


const uri = `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@cluster0.xweyicz.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

async function run() {
    try {

        const usersCollection = client.db("logilinkLabsDB").collection("users")
        const workSheetsCollection = client.db("logilinkLabsDB").collection("workSheets")
        const paymentsCollection = client.db("logilinkLabsDB").collection("payments")
        const contactMessageCollection = client.db("logilinkLabsDB").collection("contactMessage")

        //middleware
        const verifyToken = async (req, res, next) => {
            const token = await req.cookies?.token
            if (!token) {
                return res.status(403).send({ message: "Forbidden" })
            }
            jwt.verify(token, process.env.TOKEN_SECRET, (err, decoded) => {
                if (err) {
                    return res.status(401).send({ message: "Unauthorized" })
                }
                req.decoded = decoded
                next()
            })

        }
        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email }
            const user = await usersCollection.findOne(query)
            const isAdmin = user?.role === 'admin'
            if (!isAdmin) {
                return res.status(401).send({ message: 'Forbidden' })
            }
            next()
        }

        //jwt
        app.post('/jwt', async (req, res) => {
            const user = req.body
            const token = jwt.sign(user, process.env.TOKEN_SECRET, {
                expiresIn: '1h'
            })
            res.cookie('token', token, cookieOption)
                .send({ success: true })
        })

        app.delete('/jwt', async (req, res) => {
            res.clearCookie('token', { ...cookieOption, maxAge: 0 })
                .send("logout")
        })
        //payment related apis
        app.post('/payments', verifyToken, async (req, res) => {
            const paymentInfo = req.body
            const result = await paymentsCollection.insertOne(paymentInfo)
            res.send(result)
        })
        app.get('/payments/:email',  async (req, res) => {
            const email = req.params.email
            const query = { email: email }
            const result = await paymentsCollection.find(query).sort({ date: -1 }).toArray()
            res.send(result)
        })

        //users related api
        app.post('/users', async (req, res) => {
            const user = req.body;
            const email = user.email
            const query = {email:email}
            console.log(query);
            const existingUser = await usersCollection.findOne(query)
            console.log(existingUser);
            if (existingUser) {
                return res.send({ message: 'User Already Exist' })
            }
            const result = await usersCollection.insertOne(user)
            res.send(result)
        })

        app.get('/users', verifyToken, async (req, res) => {
            const query = { role: "employee" }
            const result = await usersCollection.find(query).toArray()
            res.send(result)
        })
        app.get('/allUsers', verifyToken, async (req, res) => {
            const query = { role: { $in: ["employee", 'hr'] } }
            const result = await usersCollection.find(query).toArray()
            res.send(result)
        })

        app.patch('/users/:id', verifyToken, async (req, res) => {
            const id = req.params;
            const filter = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    isVerified: true
                }
            }
            const result = await usersCollection.updateOne(filter, updateDoc)
            res.send(result)
        })
        app.patch('/makeHr/:id', verifyToken, async (req, res) => {
            const id = req.params
            const filter = { _id: new ObjectId(id) }
            const updateDoc = {
                $set: {
                    role: 'hr'
                }
            }
            const result = await usersCollection.updateOne(filter, updateDoc)
            res.send(result)
        })

        app.get('/users/checkRole/:email', async (req, res) => {
            const email = req?.params?.email
            const query = { email: email }
            const user = await usersCollection.findOne(query)
            const userRole = user?.role
            res.send({ role: userRole })
        })

        app.delete('/deleteUser/:uid', verifyToken, verifyAdmin, async (req, res) => {
            const uid = req.params.uid;
            const result = await admin.auth().deleteUser(uid)
            res.status(200).send({ message: 'success' })
        })
        app.put('/firedUser/:uid', verifyToken, verifyAdmin, async (req, res) => {
            const uid = req.params.uid;
            const filter = { uid: uid }
            const options = { upsert: true }
            const updateDoc = {
                $set: {
                    isFired: true
                }
            }
            const result = await usersCollection.updateOne(filter, updateDoc, options)
            res.send(result)
        })


        //Work sheet related apis
        app.post('/workSheet', verifyToken, async (req, res) => {
            const workSheet = req.body;
            const result = await workSheetsCollection.insertOne(workSheet)
            res.send(result)
        })

        app.get('/workSheet', verifyToken, async (req, res) => {
            const email = req.query.email
            let query = {}
            if (email) {
                query = { email: email }
            }
            const result = await workSheetsCollection.find(query).sort({ date: 1 }).toArray()
            res.send(result)
        })

        //payment intent
        app.post('/create-payment-intent', async (req, res) => {
            const { salary } = req.body;
            const paymentIntent = await stripe.paymentIntents.create({
                amount: parseInt(salary * 100),
                currency: 'bdt',
                "payment_method_types": [
                    "card",
                ],
            })
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        })

        //contact related apis

        app.post('/contactMessage', async (req, res) => {
            const info = req.body
            const result = await contactMessageCollection.insertOne(info)
            res.send(result)

        })

        app.get("/contactMessage", verifyToken, verifyAdmin, async (req, res) => {
            const result = await contactMessageCollection.find().sort({ _id: -1 }).toArray()
            res.send(result)
        })

        app.patch('/adjustSalary/:id', verifyToken, verifyAdmin, async (req, res) => {
                const id = req.params.id;
                const {salary} = req.body
                const filter = {_id: new ObjectId(id)}
                const updateDoc = {
                    $set:{
                        salary:salary
                    }
                }
                const result = await usersCollection.updateOne(filter,updateDoc)
            res.send(result)
            })



        // Connect the client to the server	(optional starting in v4.7)
        // await client.connect();
        // Send a ping to confirm a successful connection
        // await client.db("admin").command({ ping: 1 });
        // console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('EMPLOYEE MANAGEMENT SERVER IS RUNNING')
})
app.listen(port, () => {
    console.log("Employee server running on", port);
})