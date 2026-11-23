package app.travelmo.data

import app.travelmo.core.CALENDAR_EXPORT_ISSUE_PATH
import app.travelmo.core.CALENDAR_EXPORT_STOP_PATH

/**
 * Settings' "Calendar export": the link calendar apps subscribe to, issued
 * and turned off by the parser (SPEC "Calendar export"); the parser in the
 * app, a fake in tests.
 */
interface CalendarExportActions {
    /** False on a build with no parser address. */
    val available: Boolean

    /** Issues a new link, replacing any old one, which stops updating. Throws [TripActionFailed]. */
    suspend fun issue()

    /** Turns the link off. Throws [TripActionFailed]. */
    suspend fun stop()
}

object NoCalendarExportActions : CalendarExportActions {
    override val available = false
    override suspend fun issue(): Unit = throw TripActionFailed("Use Settings on the web for this.")
    override suspend fun stop(): Unit = throw TripActionFailed("Use Settings on the web for this.")
}

/** The parser's export routes, as the web's api.ts calls them; the token itself arrives on users/{uid}/calendarExport/main. */
class ParserCalendarExportActions(private val client: ParserClient) : CalendarExportActions {
    override val available: Boolean
        get() = client.available

    override suspend fun issue() {
        client.postAction(CALENDAR_EXPORT_ISSUE_PATH, "Creating a calendar link")
    }

    override suspend fun stop() {
        client.postAction(CALENDAR_EXPORT_STOP_PATH, "Turning off the calendar link")
    }
}
