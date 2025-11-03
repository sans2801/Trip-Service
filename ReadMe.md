# Trip Management REST API

A REST API service for managing ride trips with intelligent driver assignment, payment processing, and real-time driver acceptance handling.

## Features

- 🚗 Trip creation and management
- 👨‍✈️ Sequential driver pinging with 5-second acceptance timeout
- 💳 Payment processing integration
- 📊 Trip status tracking
- 🆔 UUID-based identification
- 💾 SQLite database storage
- 🔧 Modular helper functions and constants

## Prerequisites

- Node.js (v16.x or higher recommended)
- npm (v8.x or higher)

## Project Structure

```
.
├── app.js                          # Main application file
├── trip-service-constants.js       # Service URLs and constants
├── TripServiceHelper.js            # Helper functions (driver pinging)
├── package.json                    # Dependencies
├── trips.db                        # SQLite database (auto-created)
└── README.md                       # Documentation
```

## Installation

1. Clone the repository or download the files

2. Install dependencies:
```bash
npm install
```

3. Create the required helper files (see Configuration section)

4. The database will be created automatically on first run

## Required Files

### trip-service-constants.js

Create this file in your project root:

```javascript
function tripConstants() {
    return {
        driverServiceUrl: process.env.DRIVER_SERVICE_URL || 'http://localhost:5001/v1/drivers',
        paymentServiceUrl: process.env.PAYMENT_SERVICE_URL || 'http://localhost:5002/v1/payments'
    };
}

module.exports = { tripConstants };
```

### TripServiceHelper.js

Create this file in your project root:

```javascript
const axios = require('axios');
const { tripConstants } = require('./trip-service-constants');

async function pingDriverForAcceptance(driver_id, trip_id, timeoutMs = 5000) {
    try {
        const pingUrl = `${tripConstants().driverServiceUrl}/${driver_id}/ping`;
        const response = await axios.post(pingUrl, {
            trip_id,
            timeout: timeoutMs
        }, { 
            timeout: timeoutMs + 500 // Give slightly more time for network
        });

        // Check if driver accepted
        return response.status === 200 && response.data.accepted === true;
    } catch (error) {
        console.error(`Driver ${driver_id} did not respond or declined:`, error.message);
        return false;
    }
}

module.exports = { pingDriverForAcceptance };
```

## Running the Application

**Development mode (with auto-reload):**
```bash
npm run dev
```

**Production mode:**
```bash
npm start
```

**With environment variables:**
```bash
PORT=5000 DRIVER_SERVICE_URL=http://localhost:5001/v1/drivers npm start
```

The server will start on `http://localhost:5000` (or your specified PORT)

## API Endpoints

### 1. Get Trip Status

**Endpoint:** `GET /v1/trips/{trip_id}`

**Description:** Fetch trip details and current status

**Example Request:**
```bash
curl http://localhost:5000/v1/trips/123e4567-e89b-12d3-a456-426614174000
```

**Response:**
```json
{
  "trip_id": "123e4567-e89b-12d3-a456-426614174000",
  "rider_id": "rider-uuid",
  "driver_id": "driver-uuid",
  "pickup_location": "Downtown Plaza",
  "drop_location": "Airport Terminal 2",
  "status": "ACCEPTED",
  "fare": 17.50,
  "distance": 10.5,
  "created_at": "2025-11-03T10:30:00.000Z",
  "updated_at": "2025-11-03T10:31:00.000Z"
}
```

### 2. Create Trip

**Endpoint:** `POST /v1/trips`

**Description:** Create a new trip request with intelligent driver assignment

**Request Body:**
```json
{
  "rider_id": "rider-uuid",
  "pickup": "Downtown Plaza",
  "drop": "Airport Terminal 2"
}
```

**Example Request:**
```bash
curl -X POST http://localhost:5000/v1/trips \
  -H "Content-Type: application/json" \
  -d '{"rider_id":"rider-123","pickup":"Downtown","drop":"Airport"}'
```

**How it works:**
1. Creates trip with `REQUESTED` status
2. Fetches available drivers from driver service
3. Pings each driver sequentially with 5-second timeout
4. First driver to accept gets assigned
5. Updates trip status to `ACCEPTED`
6. TODO: Notifies customer about driver assignment

**Response (Success):**
```json
{
  "trip_id": "123e4567-e89b-12d3-a456-426614174000",
  "status": "REQUESTED",
  "driver_id": "driver-uuid",
  "message": "Trip created and driver assigned"
}
```

**Response (No drivers accepted):**
```json
{
  "trip_id": "123e4567-e89b-12d3-a456-426614174000",
  "status": "REQUESTED",
  "message": "Trip created but no drivers accepted"
}
```

### 3. Complete Trip

**Endpoint:** `PUT /v1/trips/{trip_id}/complete`

**Description:** Complete a trip with payment processing

**Request Body:**
```json
{
  "distance": 10.5
}
```

**Example Request:**
```bash
curl -X PUT http://localhost:5000/v1/trips/123e4567-e89b-12d3-a456-426614174000/complete \
  -H "Content-Type: application/json" \
  -d '{"distance":10.5}'
```

**How it works:**
1. Calculates fare: **$2 base + $1.5 per km**
2. Charges payment via payment service with idempotency key
3. Updates status to `COMPLETE` (if payment succeeds) or `UNPAID` (if payment fails)
4. Marks driver as active again (available for new trips)

**Response (Success):**
```json
{
  "trip_id": "123e4567-e89b-12d3-a456-426614174000",
  "status": "COMPLETE",
  "fare": 17.75,
  "distance": 10.5,
  "payment_status": "SUCCESS",
  "message": "Trip completed successfully"
}
```

**Response (Payment Failed):**
```json
{
  "trip_id": "123e4567-e89b-12d3-a456-426614174000",
  "status": "UNPAID",
  "fare": 17.75,
  "distance": 10.5,
  "payment_status": "FAILED",
  "message": "Trip completed but payment failed"
}
```

## External Service Integration

### Driver Service

The API expects the following endpoints from the driver service:

**Base URL:** Configured via `DRIVER_SERVICE_URL` (default: `http://localhost:5001/v1/drivers`)

#### Get Available Drivers
```
GET /v1/drivers/available

Response:
{
  "drivers": [
    {
      "driver_id": "uuid",
      "name": "John Doe",
      "rating": 4.8,
      "vehicle": "Toyota Camry",
      ...
    }
  ]
}
```

#### Ping Driver for Acceptance
```
POST /v1/drivers/{driver_id}/ping

Body:
{
  "trip_id": "uuid",
  "timeout": 5000
}

Response:
{
  "accepted": true
}
```

**Note:** Driver has 5 seconds to respond with acceptance

#### Update Driver Status
```
PUT /v1/drivers/{driver_id}/status

Body:
{
  "is_active": true
}
```

### Payment Service

**Base URL:** Configured via `PAYMENT_SERVICE_URL` (default: `http://localhost:5002/v1/payments`)

```
POST /v1/payments/charge

Body:
{
  "trip_id": "uuid",
  "amount": 17.50,
  "idempotency_key": "uuid"
}

Response:
{
  "status": "SUCCESS",
  "transaction_id": "txn-uuid"
}
```

## Database Schema

**Table:** `trips`

| Column | Type | Description |
|--------|------|-------------|
| trip_id | TEXT (PK) | Unique trip identifier (UUID) |
| rider_id | TEXT | Rider's unique identifier |
| driver_id | TEXT | Assigned driver's identifier |
| pickup_location | TEXT | Pickup address |
| drop_location | TEXT | Drop-off address |
| status | TEXT | Trip status (REQUESTED/ACCEPTED/COMPLETE/UNPAID) |
| fare | REAL | Trip fare amount |
| distance | REAL | Trip distance in kilometers |
| created_at | TEXT | ISO-8601 timestamp |
| updated_at | TEXT | ISO-8601 timestamp |

## Configuration

### Environment Variables

```bash
# Server Configuration
PORT=5000

# External Services
DRIVER_SERVICE_URL=http://localhost:5001/v1/drivers
PAYMENT_SERVICE_URL=http://localhost:5002/v1/payments
```

### Fare Calculation

Default fare structure (modify in code if needed):
- **Base Fare:** $2.00
- **Per Kilometer Rate:** $1.50

Example: 10 km trip = $2.00 + (10 × $1.50) = $17.00

## Trip Status Flow

```
REQUESTED → ACCEPTED → COMPLETE
                    ↘ UNPAID (if payment fails)
```

**Status Definitions:**
- `REQUESTED`: Trip created, waiting for driver assignment
- `ACCEPTED`: Driver has accepted the trip
- `COMPLETE`: Trip finished successfully with payment
- `UNPAID`: Trip finished but payment failed

## Driver Assignment Logic

1. Fetch all available drivers from driver service
2. Iterate through drivers sequentially
3. Ping each driver with 5-second timeout
4. Wait for acceptance response
5. If accepted, assign driver and stop
6. If timeout/declined, move to next driver
7. If no drivers accept, trip remains in `REQUESTED` status

## Error Handling

The API handles various error scenarios:

- **400 Bad Request:** Missing required fields
- **404 Not Found:** Trip doesn't exist
- **500 Internal Server Error:** Database or unexpected errors
- **Service Degradation:** Continues operation even if external services fail

## Logging

The application logs important events:
- Trip ID generation
- Driver service responses
- Driver ping attempts and results
- Payment service errors
- Driver status update errors

## TODO / Future Enhancements

- [ ] Implement notification service for customer updates
- [ ] Add Kafka event publishing for trip events
- [ ] Implement retry logic for failed external service calls
- [ ] Add authentication and authorization
- [ ] Implement rate limiting
- [ ] Add comprehensive logging system
- [ ] Create unit and integration tests
- [ ] Add API documentation (Swagger/OpenAPI)
- [ ] Implement circuit breaker pattern for external services

## Testing

### Manual Testing with cURL

```bash
# 1. Create a trip
curl -X POST http://localhost:5000/v1/trips \
  -H "Content-Type: application/json" \
  -d '{"rider_id":"rider-123","pickup":"Downtown Plaza","drop":"Airport Terminal 2"}'

# Save the trip_id from response

# 2. Check trip status
curl http://localhost:5000/v1/trips/{trip_id}

# 3. Complete the trip
curl -X PUT http://localhost:5000/v1/trips/{trip_id}/complete \
  -H "Content-Type: application/json" \
  -d '{"distance":15.5}'
```

### Testing with Postman

Import the following requests into Postman:

1. **Create Trip:** POST `http://localhost:5000/v1/trips`
2. **Get Trip:** GET `http://localhost:5000/v1/trips/:trip_id`
3. **Complete Trip:** PUT `http://localhost:5000/v1/trips/:trip_id/complete`

## Production Considerations

Before deploying to production:

- [ ] Replace SQLite with PostgreSQL/MySQL for scalability
- [ ] Use connection pooling for database
- [ ] Implement comprehensive error logging (Winston/Bunyan)
- [ ] Add monitoring and health check endpoints
- [ ] Set up proper environment variable management
- [ ] Implement request validation middleware (express-validator)
- [ ] Add security middleware (helmet, cors)
- [ ] Set up load balancing
- [ ] Implement graceful shutdown
- [ ] Add database migrations
- [ ] Set up CI/CD pipeline
- [ ] Configure proper timeout and retry strategies
- [ ] Add API versioning strategy

## Troubleshooting

**Database errors:**
- Check if `trips.db` file has write permissions
- Delete `trips.db` and restart to recreate

**Driver service connection issues:**
- Verify `DRIVER_SERVICE_URL` is correct
- Check if driver service is running
- Review network/firewall settings

**Payment service failures:**
- Check payment service logs
- Verify idempotency key generation
- Test with payment service directly

## License

ISC

## Support

For issues or questions, please create an issue in the repository.