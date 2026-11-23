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

/** Settings' "Regroup trips" and "Delete all trips"; the parser in the app, a fake in tests. */
interface TripActions {
    /** False on a build with no parser address, where Settings sends the user to the web. */
    val available: Boolean

    /** Files every booking again; what it did, in a line. Throws [TripActionFailed]. */
    suspend fun regroup(): String

    /** Deletes every trip the user owns, with its bookings; what it did, in a line. Throws [TripActionFailed]. */
    suspend fun deleteAll(): String
}

/** A trip action that did not go through, with the words Settings shows. */
class TripActionFailed(message: String, cause: Throwable? = null) : Exception(message, cause)

/** A build with no parser behind it. */
object NoTripActions : TripActions {
    override val available = false
    override suspend fun regroup(): String = throw TripActionFailed(ON_WEB)
    override suspend fun deleteAll(): String = throw TripActionFailed(ON_WEB)
}

private const val ON_WEB = "Use Settings on the web for this."

/** `POST /trips/regroup` and `POST /trips/delete-all` on the parser, as the web's api.ts sends them. */
class ParserTripActions(private val client: ParserClient) : TripActions {
    override val available: Boolean
        get() = client.available

    override suspend fun regroup(): String {
        val body = call(REGROUP_PATH, "Regrouping trips")
        return describeRegroup(body.optInt("changed"), body.optInt("deleted"))
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
