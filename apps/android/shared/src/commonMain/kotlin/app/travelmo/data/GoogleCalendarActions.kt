package app.travelmo.data



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
