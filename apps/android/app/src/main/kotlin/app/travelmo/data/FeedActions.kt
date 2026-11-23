package app.travelmo.data

import app.travelmo.core.CalendarResult
import app.travelmo.core.FEED_ADD_PATH
import app.travelmo.core.FEED_REMOVE_PATH
import app.travelmo.core.describeCalendarResult
import app.travelmo.core.tripActionFailure
import app.travelmo.log.TravelmoLog
import com.mikelward.androidlog.safe
import java.io.IOException
import kotlinx.coroutines.CancellationException
import org.json.JSONException
import org.json.JSONObject

/**
 * Settings' "Calendar feeds": subscribing to a calendar link, which the
 * parser reads at once and every day after, and dropping one (SPEC
 * "Calendar feeds"); the parser in the app, a fake in tests.
 */
interface FeedActions {
    /** False on a build with no parser address. */
    val available: Boolean

    /** Subscribes to [url] and reads it; says what the first read did. Throws [TripActionFailed]. */
    suspend fun add(url: String): String

    /** Drops the feed [id]; its bookings stay. Throws [TripActionFailed]. */
    suspend fun remove(id: String)
}

object NoFeedActions : FeedActions {
    override val available = false
    override suspend fun add(url: String): String = throw TripActionFailed("Use Settings on the web for this.")
    override suspend fun remove(id: String): Unit = throw TripActionFailed("Use Settings on the web for this.")
}

/** The parser's answer to /feeds/add, read as the web's api.ts reads it. */
internal fun calendarResultOf(json: JSONObject): CalendarResult = CalendarResult(
    skipped = json.optInt("skipped"),
    filtered = json.optInt("filtered"),
    notBooking = json.optInt("not_booking"),
    imported = json.optInt("imported"),
    failed = json.optInt("failed"),
    recurring = json.optInt("recurring"),
    cancelled = json.optInt("cancelled"),
    remaining = json.optInt("remaining"),
    removed = json.optInt("removed"),
    updated = json.optInt("updated"),
    exported = json.optInt("exported"),
)

/** The parser's feed routes, as the web's api.ts calls them; the list itself arrives from users/{uid}/feeds. */
class ParserFeedActions(private val client: ParserClient) : FeedActions {
    override val available: Boolean
        get() = client.available

    override suspend fun add(url: String): String {
        val body = call(FEED_ADD_PATH, JSONObject().put("url", url.trim()).toString(), "Adding a calendar feed")
        return try {
            describeCalendarResult(calendarResultOf(JSONObject(body)))
        } catch (e: JSONException) {
            // Subscribed and read; only the counts could not be read back.
            TravelmoLog.failure(e, "Adding a calendar feed: the parser's reply did not parse")
            "Added."
        }
    }

    override suspend fun remove(id: String) {
        call(FEED_REMOVE_PATH, JSONObject().put("id", id).toString(), "Removing a calendar feed")
    }

    // [what] is fixed wording for the log, never the body (the link may hold a private token).
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
            // A link the parser cannot read, or one too many feeds, said in plain words.
            val reason = reply.body.trim().takeIf { reply.status in setOf(400, 409) && it.isNotEmpty() && it.length < 200 }
            throw TripActionFailed(reason?.let { if (it.endsWith(".")) it else "$it." } ?: tripActionFailure(reply.status))
        }
        return reply.body
    }
}
