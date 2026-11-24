package app.travelmo.core

import kotlinx.datetime.DatePeriod
import kotlinx.datetime.LocalDate
import kotlinx.datetime.minus
import kotlinx.datetime.plus

/*
 * Searching the trips list (SPEC "Searching trips"), as
 * packages/core/src/tripSearch.ts: a query is words and, optionally, a
 * date. Every word must begin a word of the trip's title or one of its
 * bookings (title, provider, reference, and each place's name, code, city
 * and country); a date picks the trips under way during it.
 */

/** [year], [month] and [day] are a date in the query: a year, a month (of any year without one), or a day of one. */
data class TripQuery(val words: List<String>, val year: Int? = null, val month: Int? = null, val day: Int? = null) {
    val isEmpty: Boolean get() = words.isEmpty() && year == null && month == null
}

private val MONTHS = listOf("january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december")

private fun queriedMonth(word: String): Int? {
    if (word.length < 3) return null
    val at = MONTHS.indexOfFirst { it.startsWith(word) }
    return if (at < 0) null else at + 1
}

private val searchMarks = Regex("\\p{M}+")
private val notLetters = Regex("[^\\p{L}\\p{N}]+")

/** Letters and numbers only, accents dropped, case ignored. */
fun foldText(text: String): String = decomposed(text).replace(searchMarks, "").lowercase().replace(notLetters, " ").trim()

private val ISO = Regex("^(\\d{4})-(\\d{2})(?:-(\\d{2}))?$")
private val YEAR = Regex("^(19|20)\\d{2}$")
private val NUMBER = Regex("^\\d{1,2}(st|nd|rd|th)?$")

fun parseTripQuery(text: String): TripQuery {
    var year: Int? = null
    var month: Int? = null
    var day: Int? = null
    val words = ArrayList<String>()
    val numbers = ArrayList<String>()
    for (token in text.trim().lowercase().split(Regex("[\\s,]+")).filter { it.isNotEmpty() }) {
        // A month or day that cannot be is a word, not a date.
        val iso = ISO.find(token)?.takeIf { m ->
            m.groupValues[2].toInt() in 1..12 && (m.groupValues[3].isEmpty() || m.groupValues[3].toInt() in 1..31)
        }
        val named = queriedMonth(token.removeSuffix("."))
        when {
            iso != null -> {
                year = iso.groupValues[1].toInt()
                month = iso.groupValues[2].toInt()
                iso.groupValues[3].takeIf { it.isNotEmpty() }?.let { day = it.toInt() }
            }
            YEAR.matches(token) -> year = token.toInt()
            named != null -> month = named
            NUMBER.matches(token) -> numbers += token
            else -> words += foldText(token).split(" ").filter { it.isNotEmpty() }
        }
    }
    // A number beside a month is its day; otherwise it is a word ("VS 11").
    for (n in numbers) {
        val value = n.takeWhile { it.isDigit() }.toInt()
        if (month != null && day == null && value in 1..31) day = value else words += foldText(n)
    }
    return TripQuery(words, year, month, day)
}

private fun pad(n: Int) = n.toString().padStart(2, '0')

private fun lastDay(year: Int, month: Int): Int = LocalDate(year, month, 1).plus(DatePeriod(months = 1)).minus(DatePeriod(days = 1)).day

private fun onDate(query: TripQuery, start: String, end: String): Boolean {
    val month = query.month
    if (query.year == null && month == null) return true
    val years = query.year?.let { listOf(it) } ?: (start.take(4).toInt()..end.take(4).toInt()).toList()
    return years.any { year ->
        val from = if (month == null) "$year-01-01" else "$year-${pad(month)}-${pad(query.day ?: 1)}"
        val to = if (month == null) "$year-12-31" else "$year-${pad(month)}-${pad(query.day ?: lastDay(year, month))}"
        from <= end && to >= start
    }
}

private fun placeText(place: Place?): List<String> =
    if (place == null) emptyList() else listOfNotNull(place.name, place.code, place.city, place.country, place.country?.let(::countryName))

/** Whether [trip], shown as [title], with its [segments], is one [query] finds. */
fun tripMatches(query: TripQuery, trip: Trip, title: String, segments: List<Segment>): Boolean {
    if (!onDate(query, trip.shownStart, trip.shownEnd)) return false
    if (query.words.isEmpty()) return true
    val parts = listOf(title) + segments.flatMap { s -> listOfNotNull(s.title, s.provider, s.confirmation) + placeText(s.origin) + placeText(s.destination) }
    val text = " " + foldText(parts.joinToString(" "))
    // Each word as the start of a word in the text, so "par" finds Paris and "ba" finds BA but not Cuba.
    return query.words.all { text.contains(" $it") }
}
