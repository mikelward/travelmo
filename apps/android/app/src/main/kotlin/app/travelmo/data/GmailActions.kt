package app.travelmo.data

import app.travelmo.core.BACKFILL_START_PATH
import app.travelmo.core.BACKFILL_STOP_PATH
import app.travelmo.core.GMAIL_CONNECT_PATH
import app.travelmo.core.GMAIL_DISCONNECT_PATH
import app.travelmo.core.tripActionFailure
import app.travelmo.log.TravelmoLog
import com.mikelward.androidlog.safe
import java.io.IOException
import kotlinx.coroutines.CancellationException
import org.json.JSONException
import org.json.JSONObject

/** Settings' Gmail section: connecting, and reading the mailbox; the parser in the app, a fake in tests. */
interface GmailActions {
    /** False on a build with no parser address, where Settings sends the user to the web. */
    val available: Boolean

    /** Google's consent page for read-only Gmail access, to open in the browser. Throws [TripActionFailed]. */
    suspend fun connectUrl(): String

    /** Starts or continues reading past emails; from the start with [restart]. Throws [TripActionFailed]. */
    suspend fun start(restart: Boolean)

    /** Stops the reading where it got to. Throws [TripActionFailed]. */
    suspend fun stop()

    /** Disconnects Gmail. Throws [TripActionFailed]. */
    suspend fun disconnect()
}

object NoGmailActions : GmailActions {
    override val available = false
    private fun onWeb(): Nothing = throw TripActionFailed("Use Settings on the web for this.")
    override suspend fun connectUrl(): String = onWeb()
    override suspend fun start(restart: Boolean) = onWeb()
    override suspend fun stop() = onWeb()
    override suspend fun disconnect() = onWeb()
}

/** The parser's Gmail routes, as the web's api.ts calls them. */
class ParserGmailActions(private val client: ParserClient) : GmailActions {
    override val available: Boolean
        get() = client.available

    override suspend fun connectUrl(): String {
        val body = call(GMAIL_CONNECT_PATH, "{}", "Connecting Gmail")
        return try {
            JSONObject(body).getString("url")
        } catch (e: JSONException) {
            TravelmoLog.failure(e, "Connecting Gmail: the parser's reply did not parse")
            throw TripActionFailed(tripActionFailure(500), e)
        }
    }

    override suspend fun start(restart: Boolean) {
        call(BACKFILL_START_PATH, if (restart) """{"restart":true}""" else "{}", "Starting to read past emails")
    }

    override suspend fun stop() {
        call(BACKFILL_STOP_PATH, "{}", "Stopping the reading of past emails")
    }

    override suspend fun disconnect() {
        call(GMAIL_DISCONNECT_PATH, "{}", "Disconnecting Gmail")
    }

    private suspend fun call(path: String, json: String, what: String): String {
        TravelmoLog.info("%s", safe(what))
        val reply = try {
            client.post(path, json) ?: throw TripActionFailed(tripActionFailure(401))
        } catch (e: CancellationException) {
            throw e
        } catch (e: IOException) {
            TravelmoLog.failure(e, "$what failed: the parser could not be reached")
            throw TripActionFailed(tripActionFailure(null), e)
        }
        if (reply.status !in 200..299) {
            TravelmoLog.warning("%s failed: HTTP %s", safe(what), safe(reply.status.toString()))
            // A refusal the parser explains in plain words ("A batch is still being read…").
            val reason = reply.body.trim().takeIf { reply.status == 409 && it.isNotEmpty() && it.length < 200 }
            throw TripActionFailed(reason?.let { if (it.endsWith(".")) it else "$it." } ?: tripActionFailure(reply.status))
        }
        return reply.body
    }
}
