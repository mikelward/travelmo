package app.travelmo.data

import app.travelmo.core.FORWARD_ISSUE_PATH
import app.travelmo.core.FORWARD_STOP_PATH

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

    override suspend fun issue() {
        // A server with no forwarding domain says so in plain words.
        client.postAction(FORWARD_ISSUE_PATH, "Creating a forwarding address", explained = setOf(503))
    }

    override suspend fun stop() {
        client.postAction(FORWARD_STOP_PATH, "Turning off the forwarding address", explained = setOf(503))
    }
}
