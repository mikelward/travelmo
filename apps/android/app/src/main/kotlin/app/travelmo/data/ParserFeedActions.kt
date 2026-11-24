package app.travelmo.data

import app.travelmo.core.CalendarResult
import app.travelmo.core.FEED_ADD_PATH
import app.travelmo.core.FEED_REMOVE_PATH
import app.travelmo.core.describeCalendarResult
import app.travelmo.log.TravelmoLog
import org.json.JSONException
import org.json.JSONObject

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
        // A link the parser cannot read, or one too many feeds, said in plain words.
        val body = client.postAction(FEED_ADD_PATH, "Adding a calendar feed", JSONObject().put("url", url.trim()).toString(), explained = setOf(400, 409))
        return try {
            describeCalendarResult(calendarResultOf(JSONObject(body)))
        } catch (e: JSONException) {
            // Subscribed and read; only the counts could not be read back.
            TravelmoLog.failure(e, "Adding a calendar feed: the parser's reply did not parse")
            "Added."
        }
    }

    override suspend fun remove(id: String) {
        client.postAction(FEED_REMOVE_PATH, "Removing a calendar feed", JSONObject().put("id", id).toString(), explained = setOf(400))
    }
}
