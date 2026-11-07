package app.travelmo.core

import java.time.DayOfWeek
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.util.Locale

// A month of trips, laid out for a calendar, as packages/core/src/calendar.ts
// does it: the weeks of a month (Monday first, padded with the neighboring
// months' days so every row is seven wide) and, per week, the bars the trips
// make across it, stacked into lanes so two overlapping trips never share a
// row. A month is "YYYY-MM".

fun monthOf(date: String): String = date.substring(0, 7)

fun addMonths(month: String, n: Long): String = YearMonth.parse(month).plusMonths(n).toString()

/** "November 2026". */
fun monthLabel(month: String): String = YearMonth.parse(month).format(DateTimeFormatter.ofPattern("MMMM yyyy", Locale.UK))

/**
 * The month's weeks, each seven dates from Monday to Sunday; the first and
 * last may begin or end in the months around it.
 */
fun monthWeeks(month: String): List<List<String>> {
    val first = YearMonth.parse(month).atDay(1)
    val start = first.minusDays(((first.dayOfWeek.value - DayOfWeek.MONDAY.value) + 7L) % 7)
    val weeks = mutableListOf<List<String>>()
    var day = start
    while (weeks.size < 6 && (weeks.isEmpty() || monthOf(day.toString()) == month)) {
        weeks += (0L until 7L).map { day.plusDays(it).toString() }
        day = day.plusDays(7)
    }
    return weeks
}

data class TripBar(
    val trip: Trip,
    /** Columns within the week, 0 to 6 inclusive. */
    val from: Int,
    val to: Int,
    /** Whether the trip goes on before this week's Monday or after its Sunday. */
    val continuesBefore: Boolean,
    val continuesAfter: Boolean,
    val lane: Int,
)

/**
 * The bars of the trips touching a week, earliest start first, each in the
 * lowest lane free for its span.
 */
fun weekBars(week: List<String>, trips: List<Trip>): List<TripBar> {
    val monday = week.first()
    val sunday = week.last()
    val touching = trips
        .filter { it.start <= sunday && it.end >= monday }
        .sortedWith(compareBy<Trip> { it.start }.thenByDescending { it.end }.thenBy { it.title })
    val laneEnds = mutableListOf<Int>()
    return touching.map { trip ->
        val from = if (trip.start < monday) 0 else week.indexOf(trip.start)
        val to = if (trip.end > sunday) week.size - 1 else week.indexOf(trip.end)
        var lane = laneEnds.indexOfFirst { it < from }
        if (lane == -1) {
            lane = laneEnds.size
            laneEnds += to
        } else {
            laneEnds[lane] = to
        }
        TripBar(trip, from, to, continuesBefore = trip.start < monday, continuesAfter = trip.end > sunday, lane = lane)
    }
}

/** The months a set of trips spans, earliest first. */
fun tripMonths(trips: List<Trip>): List<String> {
    val months = sortedSetOf<String>()
    for (trip in trips) {
        var m = monthOf(trip.start)
        while (m <= monthOf(trip.end)) {
            months += m
            m = addMonths(m, 1)
        }
    }
    return months.toList()
}
