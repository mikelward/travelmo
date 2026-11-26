package app.travelmo.data

import app.travelmo.core.JourneyGap
import app.travelmo.core.LOOK_PATH
import app.travelmo.core.LookResult
import app.travelmo.core.LookedEmail
import app.travelmo.core.REFRESH_PATH
import app.travelmo.core.REFRESH_STOP_PATH
import app.travelmo.core.REGROUP_PATH
import app.travelmo.core.START_OVER_PATH
import app.travelmo.core.describeStartOver
import app.travelmo.core.describeRegroup
import app.travelmo.core.tripActionFailure
import app.travelmo.log.TravelmoLog
import com.mikelward.androidlog.safe
import java.io.IOException
import kotlinx.coroutines.CancellationException
import org.json.JSONException
import org.json.JSONObject

/** `POST /trips/regroup`, `/trips/refresh`, `/trips/delete-all` and `/trips/look` on the parser, as the web's api.ts sends them. */
class ParserTripActions(private val client: ParserClient) : TripActions {
    override val available: Boolean
        get() = client.available

    override suspend fun regroup(): String {
        val body = call(REGROUP_PATH, "Regrouping trips")
        return describeRegroup(body.optInt("changed"), body.optInt("deleted"), body.optInt("placed"))
    }

    override suspend fun startOver(): String {
        val body = call(START_OVER_PATH, "Starting over")
        return describeStartOver(body.optInt("trips"), body.optInt("mailboxes"))
    }

    override suspend fun refresh(restart: Boolean, retryFailed: Boolean) {
        val body = when {
            restart -> JSONObject().put("restart", true)
            retryFailed -> JSONObject().put("retryFailed", true)
            else -> JSONObject()
        }
        call(REFRESH_PATH, if (retryFailed) "Trying the failed emails again" else "Refreshing from email", body.toString())
    }

    override suspend fun stopRefresh() {
        call(REFRESH_STOP_PATH, "Stopping the refresh")
    }

    override suspend fun lookForJourney(gap: JourneyGap, next: Int?): LookResult {
        val body = JSONObject().put("from", gap.from).put("to", gap.to).put("date", gap.date)
        gap.until?.let { body.put("until", it) }
        gap.fromCode?.let { body.put("fromCode", it) }
        gap.toCode?.let { body.put("toCode", it) }
        next?.let { body.put("next", it) }
        val reply = call(LOOK_PATH, "Looking for a missing journey", body.toString())
        val emails = reply.optJSONArray("emails")
        return LookResult(
            emails = (0 until (emails?.length() ?: 0)).mapNotNull { i ->
                val email = emails?.optJSONObject(i) ?: return@mapNotNull null
                LookedEmail(
                    messageId = email.optString("messageId"),
                    subject = email.optString("subject"),
                    outcome = email.optString("outcome"),
                    report = email.optString("report").takeIf { it.isNotEmpty() },
                )
            },
            next = if (reply.has("next")) reply.optInt("next") else null,
        )
    }

    private suspend fun call(path: String, what: String, json: String = "{}"): JSONObject {
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
            // A refusal the parser words for the user (no mailbox connected, a batch still reading).
            if (reply.status == 409 && reply.body.isNotBlank()) throw TripActionFailed(reply.body.trim())
            throw TripActionFailed(tripActionFailure(reply.status))
        }
        TravelmoLog.info("%s done", safe(what))
        if (reply.body.isBlank()) return JSONObject()
        return try {
            JSONObject(reply.body)
        } catch (e: JSONException) {
            // It went through; only the counts are unknown.
            TravelmoLog.failure(e, "$what: the parser's reply did not parse")
            JSONObject()
        }
    }
}
