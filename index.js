const express = require('express')
const cors = require('cors')
const jwt = require('jsonwebtoken')

const port = process.env.PORT || 5000;
const app = express()

require('dotenv').config()

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');


//middleware
app.use(cors())
app.use(express.json())


const verifyJWT = (req, res, next) => {
    const authToken = req.headers.authorization;
    if (!authToken) {
        return res.status(401).send('unauthorized accessed');
    }
    const token = authToken.split(' ')[1];
    jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
        if (err) {
            return res.sendStatus(403).send({
                message: 'forbidden access'
            })
        }
        req.decoded = decoded;
        next();
    })
}



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.dkxq1qc.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

async function run() {

    try {
        const appointmentOptionCollection = client.db('DoctorsPortal').collection('AppointmentOption');

        const bookingsCollection = client.db('DoctorsPortal').collection('bookings');
        const usersCollection = client.db('DoctorsPortal').collection('users');
        const doctorsCollection = client.db('DoctorsPortal').collection('doctors');

        const verifyAdmin = async (req, res, next) => {
            const email = req.decoded.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            if (user?.role !== 'admin') {
                return res.status(403).send({ message: 'forbidden access' })
            }
            next();
        }

        app.get('/appointmentOptions', async (req, res) => {
            const query = {};
            const options = await appointmentOptionCollection.find(query).toArray();

            const date = req.query.date;
            console.log(date);
            const bookingQuery = { appointDate: date };
            const bookedAppointments = await bookingsCollection.find(bookingQuery).toArray();
            options.forEach(option => {
                const bookedSection = bookedAppointments.filter(booked => booked.treatment === option.name);
                const bookedSlots = bookedSection.map(book => book.slot);
                const remainingSlot = option.slots.filter(sl => !bookedSlots.includes(sl));
                option.slots = remainingSlot;
            })

            res.send(options);
        })


        app.get('/v2/appointmentOptions', async (req, res) => {
            const date = req.query.date;
            const options = await appointmentOptionCollection.aggregate([
                {
                    $lookup: {
                        from: 'bookings',
                        localField: 'name',
                        foreignField: 'treatment',
                        pipeline: [
                            {
                                $match: {
                                    $expr: {
                                        $eq: ['$appointDate', date]
                                    }
                                }
                            }
                        ],
                        as: 'booked'
                    }
                },
                {
                    $project: {
                        name: 1,
                        slots: 1,
                        booked: {
                            $map: {
                                input: '$booked',
                                as: 'book',
                                in: '$$book.slot'
                            }
                        }
                    }
                },
                {
                    $project: {
                        name: 1,
                        slots: {
                            $setDifference: ['$slots', '$booked']
                        }
                    }
                }
            ]).toArray();
            res.send(options);
        })

        app.get('/appointmentSpecialty', async (req, res) => {
            const query = {};
            const result = await appointmentOptionCollection.find(query).project({ name: 1 }).toArray();
            res.send(result);
        })

        app.get('/bookings', verifyJWT, async (req, res) => {

            const email = req.query.email;
            if (req.decoded.email !== email) {
                return res.sendStatus(403).send({ message: 'forbidden access' });
            }
            const query = {
                email: email,
            }
            const result = await bookingsCollection.find(query).toArray();
            res.send(result);
        })

        app.post('/bookings', async (req, res) => {
            const booking = req.body;
            const query = {
                email: booking.email,
                treatment: booking.treatment,
                appointDate: booking.appointDate,
            }
            const alreadyBooked = await bookingsCollection.find(query).toArray();

            if (alreadyBooked.length) {
                const message = `You already have a booking on ${booking.appointDate}`;
                return res.send({ acknowledged: false, message });
            }

            const result = await bookingsCollection.insertOne(booking);
            res.send(result);
        });


        app.get('/jwt', async (req, res) => {
            const email = req.query.email;
            const query = {
                email: email
            }
            const user = await usersCollection.findOne(query);

            if (user) {
                const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '1h' });
                console.log(token);
                return res.send({ Access_token: token })
            }

            res.status(403).send({ Access_token: '' });


        })

        app.get('/users', async (req, res) => {
            const query = {};
            const users = await usersCollection.find(query).toArray();
            res.send(users);
        })

        app.post('/users', async (req, res) => {
            const user = req.body;
            console.log(user);
            const result = await usersCollection.insertOne(user);


            //1st admin
            const query = {};
            const users = await usersCollection.find(query).toArray();
            if (users.length === 1) {
                const filter = {
                    email: user.email
                };
                console.log(filter);

                const options = { upsert: true };
                const updateDoc = {
                    $set: {
                        role: 'admin'
                    }
                }
                const result = await usersCollection.updateOne(filter, updateDoc, options);
                return res.send(result);
            }
            res.send(result);

        });

        app.get('/users/admin/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email }
            const user = await usersCollection.findOne(query);
            res.send({ isAdmin: user?.role === 'admin' });
        })


        app.put('/users/admin/:id', verifyJWT,verifyAdmin, async (req, res) => {
            const id = req.params.id;
            // const decodedEmail = req.decoded.email;
            // const query = { email: decodedEmail };

            // const user = await usersCollection.findOne(query);
            // if (user?.role !== 'admin') {
            //     return res.status(403).send({ message: 'forbidden access' })
            // }

            const filter = {
                _id: ObjectId(id)
            };

            const options = { upsert: true };
            const updateDoc = {
                $set: {
                    role: 'admin'
                }
            }
            const result = await usersCollection.updateOne(filter, updateDoc, options);
            res.send(result);
        });

        app.get("/doctors", verifyJWT,verifyAdmin, async (req, res) => {
            // console.log("inside doctors");
            const query = {};
            const result = await doctorsCollection.find(query).toArray();
            // console.log(result);
            res.send(result);
        })

        app.post("/dashboard/adddoctor", verifyJWT,verifyAdmin, async (req, res) => {

            const data = req.body;
            const result = await doctorsCollection.insertOne(data);
            return res.send(result);
        })

        app.delete("/doctors/:id", verifyJWT,verifyAdmin, async (req, res) => {
            const id = req.params.id;
            // console.log(id);
            const query = { _id: ObjectId(id) };
            const result = await doctorsCollection.deleteOne(query);
            return res.send(result);
        })

    }
    finally {

    }
}
run().catch(err => console.error(err))




app.get('/', async (req, res) => {
    res.send("doctors-portal server is running");
})

app.listen(port, () => { console.log(`server is running on :${port}`) })
