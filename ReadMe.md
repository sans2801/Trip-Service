# Trip Management REST API

A REST API service for managing ride trips with driver assignment, payment processing, and event publishing capabilities.

## Features

- 🚗 Trip creation and management
- 👨‍✈️ Intelligent driver assignment with sequential pinging
- 💳 Payment processing integration
- 📊 Trip status tracking
- 🔔 Kafka event publishing
- 🆔 UUID-based identification
- 💾 SQLite database storage

## Prerequisites

- Node.js (v16.x or higher recommended)
- npm (v8.x or higher)

## Installation

1. Clone the repository or download the files

2. Install dependencies:
```bash
npm install
```

3. The database will be created automatically on first run

## Running the Application

**Development mode (with auto-reload):**
```bash
npm run dev
```

**Production mode:**
```bash
npm start
```

The server will start on `http://localhost:5000`

## API Endpoints

### 1. Get Trip Status

**Endpoint:** `GET /v1/trips/{trip_id}`

**Description:** Fetch trip details and current status

**Response:**
```json
{
  "trip_id": "uuid",
  "rider_id": "uuid",
  "driver_id": "uuid",
  "pickup_location": "string",
  "drop_location": "string",
  "status": "REQUESTED|ACCEPTED|COMPLETE|UNPAID",
  "fare": 15.50,
  "distance": 10.5,
  "created_at": "ISO-8601",
  "updated_at": "ISO-8601"
}
```

### 2. Create Trip

**Endpoint:** `POST /v1/trips`

**Description:** Create a new trip request and assign a driver

**Request Body:**
```json
{
  "rider_id": "uuid",
  "pickup": "123 Main St",
  "drop": "456 Oak Ave"
}
```

**How it works:**
1. Creates trip with `REQUESTED` status
2. Fetches available drivers from driver service
3. Sorts drivers by rating (best first)
4. Pings each driver sequentially with 5-second timeout
5. Assigns first driver who accepts
6. Publishes assignment to Kafka

**Response:**
```json
{
  "trip_id": "uuid",
  "status": "REQUESTED",
  "driver_id": "uuid",
  "message": "Trip created and driver assigned"
}
```

### 3. Accept Trip

**Endpoint:** `PUT /v1/trips/{trip_id}/accept`

**Description:** Driver accepts the trip assignment

**Actions:**
1. Updates trip status to `ACCEPTED`
2. Marks driver as inactive (busy)
3. Publishes `TRIP_ACCEPTED` event to Kafka

**Response:**
```json
{
  "trip_id": "uuid",
  "status": "ACCEPTED",
  "message": "Trip accepted successfully"
}
```

### 4. Complete Trip

**Endpoint:** `PUT /v1/trips/{trip_id}/complete`

**Description:** Complete a trip with payment processing

**Request Body:**
```json
{
  "distance": 10.5
}
```

**How it works:**
1. Calculates fare: $2 base + $1.5 per km
2. Charges payment via payment service
3. Updates status to `COMPLETE` (if payment succeeds) or `UNPAID` (if payment fails)
4. Marks driver as active again

**Response:**
```json
{
  "trip_id": "uuid",
  "status": "COMPLETE",
  "fare": 17.75,
  "distance": 10.5,
  "payment_status": "SUCCESS",
  "message": "Trip completed successfully"
}
```

## External Service Integration

### Driver Service

The API expects the following endpoints from the driver service (default: `http://localhost:5001`):

**Get Available Drivers:**
```
GET /v1/drivers/available
Response: { drivers: [{ driver_id, rating, ... }] }
```

**Ping Driver (for trip assignment):**
```
POST /v1/drivers/{driver_id}/ping
Body: { trip_id, timeout }
Response: { accepted: true/false }
```

**Update Driver Status:**
```
PUT /v1/drivers/{driver_id}/status
Body: { is_active: true/false }
```

### Payment Service

Expected endpoint (default: `http://localhost:5002`):

```
POST /v1/payments/charge
Body: { trip_id, amount, idempotency_key }
Response: { status: "SUCCESS"|"FAILED" }
```

## Kafka Integration

The application publishes events to Kafka topics (currently mocked):

- **Topic:** `trip-assignments`
  - Event: `{ trip_id, driver_id }`
  
- **Topic:** `trip-events`
  - Event: `{ trip_id, event: "TRIP_ACCEPTED" }`

### To enable real Kafka:

1. Install kafkajs:
```bash
npm install kafkajs
```

2. Replace the mock `publishToKafka()` function with:
```javascript
const { Kafka } = require('kafkajs');

const kafka = new Kafka({
  clientId: 'trip-service',
  brokers: ['localhost:9092']
});

const producer = kafka.producer();

async function publishToKafka(topic, message) {
  await producer.connect();
  await producer.send({
    topic,
    messages: [{ value: JSON.stringify(message) }]
  });
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

Update service URLs in the code:

```javascript
// Driver Service
const driverServiceUrl = 'http://localhost:5001/v1/drivers/available';

// Payment Service  
const paymentServiceUrl = 'http://localhost:5002/v1/payments/charge';

// Server Port
const PORT = process.env.PORT || 5000;
```

## Error Handling

The API includes comprehensive error handling for:
- Missing required fields (400)
- Resource not found (404)
- External service failures (graceful degradation)
- Database errors (500)

## Trip Status Flow

```
REQUESTED → ACCEPTED → COMPLETE
                    ↘ UNPAID (if payment fails)
```

## Development Tips

1. **Testing with mock services:** Use tools like Postman or create simple mock services for driver/payment endpoints

2. **Database inspection:** Use SQLite browser to inspect `trips.db`

3. **Logging:** Check console logs for Kafka events and external service calls

4. **Environment variables:** Consider using `dotenv` for configuration:
```bash
npm install dotenv
```

## Production Considerations

Before deploying to production:

- [ ] Replace SQLite with PostgreSQL/MySQL
- [ ] Add authentication/authorization
- [ ] Implement rate limiting
- [ ] Add request validation middleware
- [ ] Set up proper logging (Winston, Bunyan)
- [ ] Add monitoring and health checks
- [ ] Configure real Kafka connection
- [ ] Use environment variables for all config
- [ ] Add comprehensive error handling
- [ ] Implement retry logic for external services
- [ ] Add API documentation (Swagger/OpenAPI)

## Testing

Example test with cURL:

```bash
# Create a trip
curl -X POST http://localhost:5000/v1/trips \
  -H "Content-Type: application/json" \
  -d '{"rider_id":"123","pickup":"Downtown","drop":"Airport"}'

# Get trip status
curl http://localhost:5000/v1/trips/{trip_id}

# Accept trip
curl -X PUT http://localhost:5000/v1/trips/{trip_id}/accept

# Complete trip
curl -X PUT http://localhost:5000/v1/trips/{trip_id}/complete \
  -H "Content-Type: application/json" \
  -d '{"distance":15.5}'
```

## License

ISC

## Support

For issues or questions, please create an issue in the repository.