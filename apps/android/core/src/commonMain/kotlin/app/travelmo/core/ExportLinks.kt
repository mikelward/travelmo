package app.travelmo.core

// The calendar export link three ways, as packages/core's calendarExport.ts.

/** The parser routes that issue the export link and turn it off. */
const val CALENDAR_EXPORT_ISSUE_PATH = "/export/calendar"
const val CALENDAR_EXPORT_STOP_PATH = "/export/calendar/stop"

/** To copy, for a calendar app (webcal opens its subscribe dialog), and for Google Calendar's add-by-link page. */
data class ExportLinks(val https: String, val webcal: String, val google: String)

private val httpScheme = Regex("^https?:")

fun exportLinks(token: String, base: String): ExportLinks {
    val https = "${base.removeSuffix("/")}/cal/$token.ics"
    val webcal = https.replaceFirst(httpScheme, "webcal:")
    return ExportLinks(https, webcal, "https://calendar.google.com/calendar/r?cid=${encodeUriComponent(webcal)}")
}
