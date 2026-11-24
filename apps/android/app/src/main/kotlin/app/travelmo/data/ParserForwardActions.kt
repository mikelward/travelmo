package app.travelmo.data

import app.travelmo.core.FORWARD_ISSUE_PATH
import app.travelmo.core.FORWARD_STOP_PATH

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
