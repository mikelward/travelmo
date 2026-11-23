package app.travelmo.data

import app.travelmo.core.BACKFILL_START_PATH
import app.travelmo.core.BACKFILL_STOP_PATH
import app.travelmo.core.FASTMAIL_BACKFILL_START_PATH
import app.travelmo.core.FASTMAIL_BACKFILL_STOP_PATH
import app.travelmo.core.FASTMAIL_CONNECT_PATH
import app.travelmo.core.FASTMAIL_DISCONNECT_PATH
import app.travelmo.core.GMAIL_CONNECT_PATH
import app.travelmo.core.GMAIL_DISCONNECT_PATH
import app.travelmo.core.tripActionFailure
import app.travelmo.log.TravelmoLog
import com.mikelward.androidlog.safe
import java.io.IOException
import kotlinx.coroutines.CancellationException
import org.json.JSONException
import org.json.JSONObject

/** Settings' Gmail section: connecting, and reading each connected mailbox; the parser in the app, a fake in tests. */
interface GmailActions {
    /** False on a build with no parser address, where Settings sends the user to the web. */
    val available: Boolean

    /** Google's consent page for read-only Gmail access, to open in the browser. Throws [TripActionFailed]. */
    suspend fun connectUrl(): String

    /** Starts or continues reading the past emails of the mailbox at [emailAddress]; from the start with [restart]. Throws [TripActionFailed]. */
    suspend fun start(emailAddress: String, restart: Boolean)

    /** Stops that mailbox's reading where it got to. Throws [TripActionFailed]. */
    suspend fun stop(emailAddress: String)

    /** Disconnects that mailbox. Throws [TripActionFailed]. */
    suspend fun disconnect(emailAddress: String)
}

/** Settings' Fastmail section: connecting with an API token, and reading the mailbox; the parser in the app, a fake in tests. */
interface FastmailActions {
    /** False on a build with no parser address, where Settings sends the user to the web. */
    val available: Boolean

    /** Connects the mailbox a read-only Fastmail API token reads. Throws [TripActionFailed] with the parser's words when it refuses the token. */
    suspend fun connect(token: String)

    /** Starts or continues reading past emails; from the start with [restart]. Throws [TripActionFailed]. */
    suspend fun start(restart: Boolean)

    /** Stops the reading where it got to. Throws [TripActionFailed]. */
    suspend fun stop()

    /** Disconnects Fastmail. Throws [TripActionFailed]. */
    suspend fun disconnect()
}

/** A build with no parser address: every action is for Settings on the web. */
private fun onWeb(): Nothing = throw TripActionFailed("Use Settings on the web for this.")

object NoGmailActions : GmailActions {
    override val available = false
    override suspend fun connectUrl(): String = onWeb()
    override suspend fun start(emailAddress: String, restart: Boolean) = onWeb()
    override suspend fun stop(emailAddress: String) = onWeb()
    override suspend fun disconnect(emailAddress: String) = onWeb()
}

object NoFastmailActions : FastmailActions {
    override val available = false
    override suspend fun connect(token: String) = onWeb()
    override suspend fun start(restart: Boolean) = onWeb()
    override suspend fun stop() = onWeb()
    override suspend fun disconnect() = onWeb()
}

/**
 * One mail service's parser routes, as the web's api.ts calls them; [body]
 * is what names the mailbox, if anything. A refusal with a status in
 * [explained] is shown in the parser's own words.
 */
private class ParserMailbox(
    private val client: ParserClient,
    private val name: String,
    private val startPath: String,
    private val stopPath: String,
    private val disconnectPath: String,
    private val explained: Set<Int>,
) {
    val available: Boolean
        get() = client.available

    suspend fun start(restart: Boolean, body: JSONObject = JSONObject()) {
        if (restart) body.put("restart", true)
        call(startPath, body.toString(), "Starting to read past emails from $name")
    }

    suspend fun stop(body: JSONObject = JSONObject()) {
        call(stopPath, body.toString(), "Stopping the reading of past emails from $name")
    }

    suspend fun disconnect(body: JSONObject = JSONObject()) {
        call(disconnectPath, body.toString(), "Disconnecting $name")
    }

    /** Posts [json] to [path]; [what] is fixed wording for the log, never the body (which may hold a token or an address). */
    suspend fun call(path: String, json: String, what: String): String {
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
            val reason = reply.body.trim().takeIf { reply.status in explained && it.isNotEmpty() && it.length < 200 }
            throw TripActionFailed(reason?.let { if (it.endsWith(".")) it else "$it." } ?: tripActionFailure(reply.status))
        }
        return reply.body
    }
}

/** The parser's Gmail routes, as the web's api.ts calls them; each names its mailbox by address. */
class ParserGmailActions(client: ParserClient) : GmailActions {
    private val mailbox = ParserMailbox(client, "Gmail", BACKFILL_START_PATH, BACKFILL_STOP_PATH, GMAIL_DISCONNECT_PATH, explained = setOf(409))

    override val available: Boolean
        get() = mailbox.available

    override suspend fun connectUrl(): String {
        val body = mailbox.call(GMAIL_CONNECT_PATH, "{}", "Connecting Gmail")
        return try {
            JSONObject(body).getString("url")
        } catch (e: JSONException) {
            TravelmoLog.failure(e, "Connecting Gmail: the parser's reply did not parse")
            throw TripActionFailed(tripActionFailure(500), e)
        }
    }

    private fun named(emailAddress: String) = JSONObject().put("emailAddress", emailAddress)

    override suspend fun start(emailAddress: String, restart: Boolean) = mailbox.start(restart, named(emailAddress))
    override suspend fun stop(emailAddress: String) = mailbox.stop(named(emailAddress))
    override suspend fun disconnect(emailAddress: String) = mailbox.disconnect(named(emailAddress))
}

/**
 * The parser's Fastmail routes. Its refusals of a token (400: not accepted,
 * can change mail, can't read email; 409: another account has that mailbox)
 * are worded for the user, so they are shown as sent.
 */
class ParserFastmailActions(client: ParserClient) : FastmailActions {
    private val mailbox = ParserMailbox(
        client, "Fastmail", FASTMAIL_BACKFILL_START_PATH, FASTMAIL_BACKFILL_STOP_PATH, FASTMAIL_DISCONNECT_PATH, explained = setOf(400, 409),
    )

    override val available: Boolean
        get() = mailbox.available

    override suspend fun connect(token: String) {
        mailbox.call(FASTMAIL_CONNECT_PATH, JSONObject().put("token", token.trim()).toString(), "Connecting Fastmail")
    }

    override suspend fun start(restart: Boolean) = mailbox.start(restart)
    override suspend fun stop() = mailbox.stop()
    override suspend fun disconnect() = mailbox.disconnect()
}
