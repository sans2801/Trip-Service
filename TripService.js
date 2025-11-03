const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const { tripConstants }  = require('./trip-service-constants');
const { pingDriverForAcceptance } = require('./TripServiceHelper');

const app = express();
app.use(express.json());

// Database setup
const db = new sqlite3.Database('./trips.db', (err) => {
    if (err) {
        console.error('Error opening database:', err);
    } else {
        console.log('Connected to SQLite database');
        initDb();
    }
});

function initDb() {
    db.run(`
        CREATE TABLE IF NOT EXISTS trips (
            trip_id TEXT PRIMARY KEY,
            rider_id TEXT NOT NULL,
            driver_id TEXT,
            pickup_location TEXT NOT NULL,
            drop_location TEXT NOT NULL,
            status TEXT NOT NULL,
            fare REAL,
            distance REAL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    `, (err) => {
        if (err) {
            console.error('Error creating table:', err);
        } else {
            console.log('Trips table ready');
        }
    });
}

// GET /v1/trips/{trip_id}
app.get('/v1/trips/:trip_id', (req, res) => {
    const { trip_id } = req.params;

    db.get('SELECT * FROM trips WHERE trip_id = ?', [trip_id], (err, trip) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        if (!trip) {
            return res.status(404).json({ error: 'Trip not found' });
        }

        res.json({
            trip_id: trip.trip_id,
            rider_id: trip.rider_id,
            driver_id: trip.driver_id,
            pickup_location: trip.pickup_location,
            drop_location: trip.drop_location,
            status: trip.status,
            fare: trip.fare,
            distance: trip.distance,
            created_at: trip.created_at,
            updated_at: trip.updated_at
        });
    });
});

// POST /v1/trips
app.post('/v1/trips', async (req, res) => {
    try {
        const { rider_id, pickup, drop } = req.body;

        // Validate input
        if (!rider_id || !pickup || !drop) {
            return res.status(400).json({ 
                error: 'Missing required fields: rider_id, pickup, drop' 
            });
        }

        // Generate trip ID
        const trip_id = uuidv4();
        console.log(`Generating trip id : ${trip_id}`)

        const now = new Date().toISOString();

        // Insert trip with REQUESTED status
        db.run(`
            INSERT INTO trips (trip_id, rider_id, pickup_location, drop_location, status, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [trip_id, rider_id, pickup, drop, 'REQUESTED', now, now], async (err) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }

            // Get available drivers from driver service
            try {
                const driverServiceUrl = `${tripConstants().driverServiceUrl}/available`;
                const response = await axios.get(driverServiceUrl, { timeout: 5000 });

                if (response.status === 200 && response.data.drivers) {
                    const drivers = response.data.drivers;
                    console.log('Received response from driver service')

                    if (drivers.length > 0) {

                        // Ping each driver sequentially with 5-second timeout
                        let assignedDriverId = null;

                        for (const driver of drivers) {
                            console.log(`Pinging driver ${driver.driver_id}...`);
                            
                            const accepted = await pingDriverForAcceptance(
                                driver.driver_id, 
                                trip_id, 
                                5000
                            );

                            if (accepted) {
                                assignedDriverId = driver.driver_id;
                                console.log(`Driver ${driver.driver_id} accepted the trip!`);
                                break;
                            } else {
                                console.log(`Driver ${driver.driver_id} did not accept. Moving to next...`);
                            }
                        }

                        if (assignedDriverId) {
                            // Update trip with driver_id
                            db.run(`
                                UPDATE trips SET driver_id = ?, status='ACCEPTED', updated_at = ? WHERE trip_id = ?
                            `, [assignedDriverId, new Date().toISOString(), trip_id]);

                            // TODO: make call to notification service so the customer gets to know

                            return res.status(201).json({
                                trip_id,
                                status: 'REQUESTED',
                                driver_id: assignedDriverId,
                                message: 'Trip created and driver assigned'
                            });
                        } else {
                            return res.status(201).json({
                                trip_id,
                                status: 'REQUESTED',
                                message: 'Trip created but no drivers accepted'
                            });
                        }
                    }
                }

                return res.status(201).json({
                    trip_id,
                    status: 'REQUESTED',
                    message: 'Trip created but no drivers available'
                });

            } catch (driverError) {
                console.error('Error calling driver service:', driverError.message);
                return res.status(201).json({
                    trip_id,
                    status: 'REQUESTED',
                    message: 'Trip created but could not reach driver service'
                });
            }
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// PUT /v1/trips/{trip_id}/complete
app.put('/v1/trips/:trip_id/complete', (req, res) => {
    const { trip_id } = req.params;
    const { distance } = req.body;

    if (!distance) {
        return res.status(400).json({ error: 'Missing required field: distance' });
    }

    const distanceNum = parseFloat(distance);

    // Get trip details
    db.get('SELECT * FROM trips WHERE trip_id = ?', [trip_id], async (err, trip) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        if (!trip) {
            return res.status(404).json({ error: 'Trip not found' });
        }

        const driver_id = trip.driver_id;

        // Calculate fare (example: $2 base + $1.5 per km)
        const baseFare = 2.0;
        const perKmRate = 1.5;
        const fare = parseFloat((baseFare + (distanceNum * perKmRate)).toFixed(2));

        // Generate idempotency key
        const idempotencyKey = uuidv4();

        // Call payment service
        let paymentSuccess = false;
        try {
            const paymentServiceUrl = `${tripConstants().paymentServiceUrl}/charge`;
            const response = await axios.post(paymentServiceUrl, {
                trip_id,
                amount: fare,
                idempotency_key: idempotencyKey
            }, { timeout: 10000 });

            if (response.status === 200 && response.data.status === 'SUCCESS') {
                paymentSuccess = true;
            }
        } catch (paymentError) {
            console.error('Error calling payment service:', paymentError.message);
        }

        // Update trip based on payment result
        const status = paymentSuccess ? 'COMPLETE' : 'UNPAID';

        db.run(`
            UPDATE trips 
            SET status = ?, fare = ?, distance = ?, updated_at = ? 
            WHERE trip_id = ?
        `, [status, fare, distanceNum, new Date().toISOString(), trip_id], async (err) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }

            // Mark driver as active again
            if (driver_id) {
                try {
                    const driverServiceUrl = `${tripConstants().driverServiceUrl}/${driver_id}/status`;
                    await axios.put(driverServiceUrl, { is_active: true }, { timeout: 5000 });
                } catch (driverError) {
                    console.error('Error updating driver status:', driverError.message);
                }
            }

            res.json({
                trip_id,
                status,
                fare,
                distance: distanceNum,
                payment_status: paymentSuccess ? 'SUCCESS' : 'FAILED',
                message: paymentSuccess ? 'Trip completed successfully' : 'Trip completed but payment failed'
            });
        });
    });
});


// GET /v1/trips/{trip_id}/cancel
app.get('/v1/trips/:trip_id/cancel', (req, res) => {
    const { trip_id } = req.params;

    // Get trip details
    db.get('SELECT * FROM trips WHERE trip_id = ?', [trip_id], async (err, trip) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        if (!trip) {
            return res.status(404).json({ error: 'Trip not found' });
        }

        const driver_id = trip.driver_id;

        // Update trip status to CANCELLED
        db.run(`
            UPDATE trips SET status = ?, updated_at = ? WHERE trip_id = ?
        `, ['CANCELLED', new Date().toISOString(), trip_id], async (err) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }

            // Mark driver as available again if driver was assigned
            // if (driver_id) {
            //     try {
            //         const driverServiceUrl = `${tripConstants().driverServiceUrl}/${driver_id}/status`;
            //         await axios.put(driverServiceUrl, { is_available: true }, { timeout: 5000 });
            //         console.log(`Driver ${driver_id} marked as available`);
            //     } catch (driverError) {
            //         console.error('Error updating driver availability:', driverError.message);
            //     }
            // }

            res.json({
                trip_id,
                status: 'CANCELLED',
                message: 'Trip cancelled successfully'
            });
        });
    });
});


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});