package app.travelmo.data

import app.travelmo.core.DELETE_ALL_TRIPS_PATH
import app.travelmo.core.REGROUP_PATH
import app.travelmo.core.describeDeletedTrips
import app.travelmo.core.describeRegroup
import app.travelmo.core.tripActionFailure
import app.travelmo.log.TravelmoLog
import com.mikelward.androidlog.safe
import java.io.IOException
import kotlinx.coroutines.CancellationException
import org.json.JSONException
import org.json.JSONObject

/** `POST /trips/regroup` and `POST /trips/delete-all` on the parser, as the web's api.ts sends them. */
class ParserTripActions(private val client: ParserClient) : TripActions {
    override val available: Boolean
        get() = client.available

    override suspend fun regroup(): String {
        val body = call(REGROUP_PATH, "Regrouping trips")
        return describeRegroup(body.optInt("changed"), body.optInt("deleted"), body.optInt("placed"))
    }

    override suspend fun deleteAll(): String {
        val body = call(DELETE_ALL_TRIPS_PATH, "Deleting all trips")
        return describeDeletedTrips(body.optInt("trips"))
    }

    private suspend fun call(path: String, what: String): JSONObject {
        TravelmoLog.info("%s", safe(what))
        val reply = try {
            client.post(path) ?: throw TripActionFailed(tripActionFailure(401))
        } catch (e: CancellationException) {
            throw e
        } catch (e: IOException) {
            TravelmoLog.failure(e, "$what failed: the parser could not be reached")
            throw TripActionFailed(tripActionFailure(null), e)
        }
        if (reply.status !in 200..299) {
            TravelmoLog.warning("%s failed: HTTP %s", safe(what), safe(reply.status.toString()))
            throw TripActionFailed(tripActionFailure(reply.status))
        }
        TravelmoLog.info("%s done", safe(what))
        return try {
            JSONObject(reply.body)
        } catch (e: JSONException) {
            // It went through; only the counts are unknown.
            TravelmoLog.failure(e, "$what: the parser's reply did not parse")
            JSONObject()
        }
    }
}
