package app.travelmo.core

import kotlinx.datetime.DatePeriod
import kotlinx.datetime.LocalDate
import kotlinx.datetime.minus
import kotlinx.datetime.plus

// A month of trips, laid out for a calendar, as packages/core/src/calendar.ts
// does it: the weeks of a month (Monday first, padded with the neighboring
// months' days so every row is seven wide) and, per week, the bars the trips
// make across it, stacked into lanes so two overlapping trips never share a
// row. A month is "YYYY-MM".

fun monthOf(date: String): String = date.substring(0, 7)

fun addMonths(month: String, n: Long): String = monthOf(LocalDate.parse("$month-01").plus(DatePeriod(months = n.toInt())).toString())

/** "November 2026". */
fun monthLabel(month: String): String = formatMonthYear(month)

/**
 * The month's weeks, each seven dates from Monday to Sunday; the first and
 * last may begin or end in the months around it.
 */
fun monthWeeks(month: String): List<List<String>> {
    val first = LocalDate.parse("$month-01")
    // DayOfWeek's ordinal counts from Monday, 0.
    val start = first.minus(DatePeriod(days = first.dayOfWeek.ordinal))
    val weeks = mutableListOf<List<String>>()
    var day = start
    while (weeks.size < 6 && (weeks.isEmpty() || monthOf(day.toString()) == month)) {
        weeks += (0 until 7).map { day.plus(DatePeriod(days = it)).toString() }
        day = day.plus(DatePeriod(days = 7))
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
        .filter { it.shownStart <= sunday && it.shownEnd >= monday }
        .sortedWith(compareBy<Trip> { it.shownStart }.thenByDescending { it.shownEnd }.thenBy { it.title })
    val laneEnds = mutableListOf<Int>()
    return touching.map { trip ->
        val from = if (trip.shownStart < monday) 0 else week.indexOf(trip.shownStart)
        val to = if (trip.shownEnd > sunday) week.size - 1 else week.indexOf(trip.shownEnd)
        var lane = laneEnds.indexOfFirst { it < from }
        if (lane == -1) {
            lane = laneEnds.size
            laneEnds += to
        } else {
            laneEnds[lane] = to
        }
        TripBar(trip, from, to, continuesBefore = trip.shownStart < monday, continuesAfter = trip.shownEnd > sunday, lane = lane)
    }
}

/** The months a set of trips spans, earliest first. */
fun tripMonths(trips: List<Trip>): List<String> {
    val months = mutableSetOf<String>()
    for (trip in trips) {
        var m = monthOf(trip.shownStart)
        while (m <= monthOf(trip.shownEnd)) {
            months += m
            m = addMonths(m, 1)
        }
    }
    return months.sorted()
}
