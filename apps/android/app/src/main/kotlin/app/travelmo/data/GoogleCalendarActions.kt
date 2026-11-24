package app.travelmo.data

import app.travelmo.core.CALENDAR_CONNECT_PATH
import app.travelmo.core.CALENDAR_DISCONNECT_PATH
import app.travelmo.core.CALENDAR_SELECT_PATH
import app.travelmo.core.tripActionFailure
import app.travelmo.log.TravelmoLog
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * Settings' "Google Calendar": connecting through Google's consent page in
 * the browser, which hands back to Travelmo on the web; choosing which
 * calendars hold travel; and disconnecting (SPEC "Google Calendar"). The
 * parser in the app, a fake in tests.
 */
interface GoogleCalendarActions {
    /** False on a build with no parser address. */
    val available: Boolean

    /** Google's consent page for read-only calendar access, to open in the browser. Throws [TripActionFailed]. */
    suspend fun connectUrl(): String

    /** Saves which calendars are read; true when newly chosen ones were read now. Throws [TripActionFailed]. */
    suspend fun select(ids: List<String>): Boolean

    /** Disconnects Google Calendar. Throws [TripActionFailed]. */
    suspend fun disconnect()
}

object NoGoogleCalendarActions : GoogleCalendarActions {
    override val available = false
    private fun onWeb(): Nothing = throw TripActionFailed("Use Settings on the web for this.")
    override suspend fun connectUrl(): String = onWeb()
    override suspend fun select(ids: List<String>): Boolean = onWeb()
    override suspend fun disconnect() = onWeb()
}

/** The parser's Google Calendar routes, as the web's api.ts calls them; the connection itself arrives on the user document. */
class ParserGoogleCalendarActions(private val client: ParserClient) : GoogleCalendarActions {
    override val available: Boolean
        get() = client.available

    override suspend fun connectUrl(): String {
        val body = client.postAction(CALENDAR_CONNECT_PATH, "Connecting Google Calendar")
        return try {
            JSONObject(body).getString("url")
        } catch (e: JSONException) {
            TravelmoLog.failure(e, "Connecting Google Calendar: the parser's reply did not parse")
            throw TripActionFailed(tripActionFailure(500), e)
        }
    }

    override suspend fun select(ids: List<String>): Boolean {
        // "Google Calendar not connected" (409) is said in plain words.
        val body = client.postAction(CALENDAR_SELECT_PATH, "Choosing Google calendars", JSONObject().put("ids", JSONArray(ids)).toString(), explained = setOf(409))
        return try {
            JSONObject(body).optInt("read") > 0
        } catch (e: JSONException) {
            // Saved; only how many were read could not be read back.
            TravelmoLog.failure(e, "Choosing Google calendars: the parser's reply did not parse")
            false
        }
    }

    override suspend fun disconnect() {
        client.postAction(CALENDAR_DISCONNECT_PATH, "Disconnecting Google Calendar")
    }
}
