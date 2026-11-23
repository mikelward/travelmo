package app.travelmo.data

import app.travelmo.core.FORWARD_ISSUE_PATH
import app.travelmo.core.FORWARD_STOP_PATH
import app.travelmo.core.tripActionFailure
import app.travelmo.log.TravelmoLog
import com.mikelward.androidlog.safe
import java.io.IOException
import kotlinx.coroutines.CancellationException

/**
 * Settings' "Forward by email": the user's own address to forward bookings
 * to, issued and turned off by the parser (SPEC "Forward to import"); the
 * parser in the app, a fake in tests.
 */
interface ForwardActions {
    /** False on a build with no parser address. */
    val available: Boolean

    /** Issues a new address, replacing any old one, which bounces from then on. Throws [TripActionFailed]. */
    suspend fun issue()

    /** Turns the address off; mail to it bounces from then on. Throws [TripActionFailed]. */
    suspend fun stop()
}

object NoForwardActions : ForwardActions {
    override val available = false
    override suspend fun issue(): Unit = throw TripActionFailed("Use Settings on the web for this.")
    override suspend fun stop(): Unit = throw TripActionFailed("Use Settings on the web for this.")
}

/** The parser's forwarding routes, as the web's api.ts calls them; the address itself arrives on the user document. */
class ParserForwardActions(private val client: ParserClient) : ForwardActions {
    override val available: Boolean
        get() = client.available

    override suspend fun issue() = call(FORWARD_ISSUE_PATH, "Creating a forwarding address")

    override suspend fun stop() = call(FORWARD_STOP_PATH, "Turning off the forwarding address")

    private suspend fun call(path: String, what: String) {
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
            // A server with no forwarding domain says so in plain words.
            val reason = reply.body.trim().takeIf { reply.status == 503 && it.isNotEmpty() && it.length < 200 }
            throw TripActionFailed(reason?.let { if (it.endsWith(".")) it else "$it." } ?: tripActionFailure(reply.status))
        }
        TravelmoLog.info("%s done", safe(what))
    }
}
