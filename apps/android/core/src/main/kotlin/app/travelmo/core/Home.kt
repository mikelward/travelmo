package app.travelmo.core

import java.time.LocalDate

// Mirrors packages/core/src/home.ts.

/**
 * Where someone lived for a while, worked out from their journeys: a round
 * trip leaves from home and comes back to it. People move, so home is a
 * timeline of periods. Bounds are calendar dates, inclusive; the first period
 * has no [from] and the last no [until].
 */
data class HomePeriod(
    val city: String,
    val country: String? = null,
    val from: String? = null,
    val until: String? = null,
)

private data class Town(val city: String, val country: String?)

private val journeyTypes = setOf(SegmentType.FLIGHT, SegmentType.TRAIN, SegmentType.BUS, SegmentType.FERRY)

// A place's town: the city where the source gave one, otherwise its name.
private fun town(place: Place?): Town? {
    if (place == null) return null
    return Town(place.city ?: place.name, place.country)
}

// Same city, ignoring case, and the same country when both give one.
private fun sameTown(a: Town, b: Town): Boolean =
    a.city.trim().equals(b.city.trim(), ignoreCase = true) &&
        (a.country == null || b.country == null || a.country.equals(b.country, ignoreCase = true))

private fun sameTown(a: Town, b: HomePeriod): Boolean = sameTown(a, Town(b.city, b.country))

private data class RoundTrip(val base: Town, val start: String)

// Each round trip leaves from a town and ends with the first journey back
// into it, however many legs lie between; a chain that never returns gives
// none, and the next journey starts afresh. Legs go in the order they leave,
// by instant, since local times misorder them across the date line; a
// journey within one town goes nowhere and says nothing.
private fun roundTrips(segments: List<Segment>): List<RoundTrip> {
    val journeys = segments
        .filter {
            val from = town(it.origin)
            val to = town(it.destination)
            it.type in journeyTypes && from != null && to != null && !sameTown(from, to)
        }
        .sortedBy { instantMillis(it.start) }
    val trips = mutableListOf<RoundTrip>()
    var i = 0
    while (i < journeys.size) {
        val base = town(journeys[i].origin)!!
        val back = (i until journeys.size).firstOrNull { sameTown(town(journeys[it].destination)!!, base) }
        if (back == null) {
            i++
            continue
        }
        trips += RoundTrip(base, localDate(journeys[i].start))
        i = back + 1
    }
    return trips
}

/**
 * Home over time. The base of the first round trip is home until another
 * base holds for two round trips in a row: a move, dated from the first of
 * them. A single trip from somewhere else is not a move.
 */
fun homeTimeline(segments: List<Segment>): List<HomePeriod> {
    val trips = roundTrips(segments)
    val periods = mutableListOf<HomePeriod>()
    var current: Town? = null
    for ((i, trip) in trips.withIndex()) {
        if (current == null) {
            current = trip.base
            periods += HomePeriod(trip.base.city, trip.base.country)
            continue
        }
        if (sameTown(trip.base, current)) continue
        val next = trips.getOrNull(i + 1)
        if (next == null || !sameTown(next.base, trip.base)) continue
        periods[periods.lastIndex] = periods.last().copy(until = LocalDate.parse(trip.start).minusDays(1).toString())
        periods += HomePeriod(trip.base.city, trip.base.country, from = trip.start)
        current = trip.base
    }
    return periods
}

private fun HomePeriod.covers(date: String) = (from == null || from <= date) && (until == null || date <= until)

/** Home on [date]; a correction in [overrides] wins for the dates it covers. */
fun homeAt(periods: List<HomePeriod>, date: String, overrides: List<HomePeriod> = emptyList()): HomePeriod? =
    overrides.firstOrNull { it.covers(date) } ?: periods.firstOrNull { it.covers(date) }

/** Whether a booking that is not a journey happens in the home of its day. */
fun isAtHome(segment: Segment, periods: List<HomePeriod>, overrides: List<HomePeriod> = emptyList()): Boolean {
    if (segment.type in journeyTypes) return false
    val place = town(segment.destination) ?: return false
    val home = homeAt(periods, localDate(segment.start), overrides) ?: return false
    return sameTown(place, home)
}
