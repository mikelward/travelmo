package app.travelmo.core

import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

// Dates as the web app shows them, in en-GB: "Sat 12 Dec", "12–14 Dec 2026".

private val uk: Locale = Locale.UK

private fun fmt(date: String, pattern: String): String =
    LocalDate.parse(date).format(DateTimeFormatter.ofPattern(pattern, uk))

/** "Sat 12 Dec". */
fun formatDate(date: String): String = fmt(date, "EEE d MMM")

/** "Sat 12 Dec 2026". */
fun formatDateWithYear(date: String): String = fmt(date, "EEE d MMM yyyy")

/** "Sat". */
fun formatWeekday(date: String): String = fmt(date, "EEE")

/**
 * "12–14 Dec 2026", "28 Nov – 2 Dec 2026", "14 Sep 2026 – 3 Jan 2027", or
 * one date with its year when both are the same day.
 */
fun formatDateRange(start: String, end: String): String {
    val sameYear = start.substring(0, 4) == end.substring(0, 4)
    val sameMonth = sameYear && start.substring(5, 7) == end.substring(5, 7)
    return when {
        start == end -> fmt(start, "d MMM yyyy")
        sameMonth -> "${fmt(start, "d")}–${fmt(end, "d MMM yyyy")}"
        sameYear -> "${fmt(start, "d MMM")} – ${fmt(end, "d MMM yyyy")}"
        else -> "${fmt(start, "d MMM yyyy")} – ${fmt(end, "d MMM yyyy")}"
    }
}
