package app.travelmo.core

import kotlinx.datetime.LocalDate

// Dates as the web app shows them, in en-GB: "Sat 12 Dec", "12–14 Dec 2026".
// The names are written out rather than asked of the platform, so every
// platform says them alike: en-GB's, as Intl and java.time give them ("Sept").

private val weekdayNames = listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
private val shortMonthNames = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sept", "Oct", "Nov", "Dec")
private val monthNames = listOf("January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December")

/** "Sat". */
fun formatWeekday(date: String): String = weekdayNames[LocalDate.parse(date).dayOfWeek.ordinal]

/** "12 Dec". */
internal fun dayMonth(date: String): String = LocalDate.parse(date).let { "${it.day} ${shortMonthNames[it.month.ordinal]}" }

/** "12 Dec 2026". */
internal fun formatDayMonthYear(date: String): String = "${dayMonth(date)} ${date.substring(0, 4)}"

/** "November 2026", from "2026-11". */
internal fun formatMonthYear(month: String): String = "${monthNames[month.substring(5, 7).toInt() - 1]} ${month.substring(0, 4)}"

/** "Sat 12 Dec". */
fun formatDate(date: String): String = "${formatWeekday(date)} ${dayMonth(date)}"

/** "Sat 12 Dec 2026". */
fun formatDateWithYear(date: String): String = "${formatWeekday(date)} ${formatDayMonthYear(date)}"

/**
 * "12–14 Dec 2026", "28 Nov – 2 Dec 2026", "14 Sep 2026 – 3 Jan 2027", or
 * one date with its year when both are the same day.
 */
fun formatDateRange(start: String, end: String): String {
    val sameYear = start.substring(0, 4) == end.substring(0, 4)
    val sameMonth = sameYear && start.substring(5, 7) == end.substring(5, 7)
    return when {
        start == end -> formatDayMonthYear(start)
        sameMonth -> "${LocalDate.parse(start).day}–${formatDayMonthYear(end)}"
        sameYear -> "${dayMonth(start)} – ${formatDayMonthYear(end)}"
        else -> "${formatDayMonthYear(start)} – ${formatDayMonthYear(end)}"
    }
}

/**
 * How each trip's title reads where trips are listed together: a title two
 * or more of them share, compared ignoring case and spacing (the same camp
 * every summer), gets each one's dates, "Debutots Camp (11–15 Aug 2025)";
 * any other title reads as it is. Keyed by trip id.
 */
fun displayTitles(trips: List<Trip>): Map<String, String> {
    fun key(title: String) = title.trim().replace(Regex("\\s+"), " ").lowercase()
    val count = trips.groupingBy { key(it.title) }.eachCount()
    return trips.associate { trip ->
        trip.id to if ((count[key(trip.title)] ?: 0) > 1) "${trip.title.trim()} (${formatDateRange(trip.shownStart, trip.shownEnd)})" else trip.title
    }
}
