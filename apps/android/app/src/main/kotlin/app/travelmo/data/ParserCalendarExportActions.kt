package app.travelmo.data

import app.travelmo.core.CALENDAR_EXPORT_ISSUE_PATH
import app.travelmo.core.CALENDAR_EXPORT_STOP_PATH

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
