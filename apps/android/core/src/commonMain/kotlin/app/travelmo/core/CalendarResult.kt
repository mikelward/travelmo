package app.travelmo.core

// What an import of calendar events did, as packages/core's
// calendarResult.ts words it: the parser's /import/ics and /feeds/add answer.

/** The parser routes that subscribe to a calendar feed and drop one. */
const val FEED_ADD_PATH = "/feeds/add"
const val FEED_REMOVE_PATH = "/feeds/remove"

data class CalendarResult(
    val skipped: Int = 0,
    val filtered: Int = 0,
    val notBooking: Int = 0,
    val imported: Int = 0,
    val failed: Int = 0,
    val recurring: Int = 0,
    val cancelled: Int = 0,
    val remaining: Int = 0,
    val removed: Int = 0,
    val updated: Int = 0,
    val exported: Int = 0,
)

private fun count(n: Int, one: String, many: String) = "$n ${if (n == 1) one else many}"

/** "2 events imported, 1 not bookings, 3 skipped as not travel." */
fun describeCalendarResult(r: CalendarResult): String {
    val parts = mutableListOf("${count(r.imported, "event", "events")} imported")
    if (r.notBooking > 0) parts += "${r.notBooking} not bookings"
    if (r.filtered > 0) parts += "${r.filtered} skipped as not travel"
    if (r.skipped > 0) parts += "${r.skipped} read before"
    if (r.failed > 0) parts += "${r.failed} failed"
    if (r.removed > 0) parts += "${r.removed} removed as cancelled"
    if (r.updated > 0) parts += "${r.updated} read again after changing"
    if (r.exported > 0) parts += "${r.exported} of Travelmo's own events skipped"
    var text = "${parts.joinToString(", ")}."
    if (r.remaining > 0) text += " ${count(r.remaining, "event is", "events are")} left: import the file again to continue."
    return text
}
