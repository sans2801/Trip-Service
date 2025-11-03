import { tripConstants } from "./trip-service-constants.js";
import axios from 'axios'

export async function pingDriverForAcceptance(driver_id, trip_id, timeoutMs = 5000) {
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