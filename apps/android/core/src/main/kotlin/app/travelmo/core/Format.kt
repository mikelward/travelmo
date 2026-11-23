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
        trip.id to if ((count[key(trip.title)] ?: 0) > 1) "${trip.title.trim()} (${formatDateRange(trip.start, trip.end)})" else trip.title
    }
}
