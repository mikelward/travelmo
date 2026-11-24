package app.travelmo.data

import app.travelmo.core.REIMPORT_PATH
import app.travelmo.core.outcomeLabel
import app.travelmo.core.tripActionFailure
import app.travelmo.log.TravelmoLog
import com.mikelward.androidlog.safe
import java.io.IOException
import kotlinx.coroutines.CancellationException
import org.json.JSONException
import org.json.JSONObject

/** `POST /gmail/reimport` on the parser, as the web's api.ts sends it. */
class ParserImportReview(private val client: ParserClient) : ImportReview {
    override val available: Boolean
        get() = client.available

    override suspend fun reimport(messageId: String): Reimported {
        val reply = try {
            client.post(REIMPORT_PATH, JSONObject().put("messageId", messageId).toString()) ?: throw TripActionFailed(tripActionFailure(401))
        } catch (e: CancellationException) {
            throw e
        } catch (e: IOException) {
            TravelmoLog.failure(e, "Reading a message again failed: the parser could not be reached")
            throw TripActionFailed(tripActionFailure(null), e)
        }
        if (reply.status !in 200..299) {
            TravelmoLog.warning("Reading a message again failed: HTTP %s", safe(reply.status.toString()))
            // The parser says in plain text why it refused a request it could
            // not do (already imported, gone from the mailbox, a Fastmail token
            // it no longer takes); others get the usual words.
            val reason = reply.body.trim().takeIf { reply.status in setOf(400, 404, 409) && it.isNotEmpty() && it.length < 200 }
            throw TripActionFailed(reason?.let { if (it.endsWith(".")) it else "$it." } ?: tripActionFailure(reply.status))
        }
        val json = try {
            JSONObject(reply.body)
        } catch (e: JSONException) {
            // It went through; only what came of it is unknown, and the list
            // shows that once the record changes.
            TravelmoLog.failure(e, "Reading a message again: the parser's reply did not parse")
            null
        }
        val outcome = json?.optString("outcome").orEmpty()
        val report = json?.optString("report")?.takeIf { it.isNotBlank() }
        return Reimported(outcomeLabel(outcome.ifBlank { "processing" }), report)
    }
}
