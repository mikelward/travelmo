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

// Whether two places are one: the same code where both have one, else the
// same name or the same address.
private fun samePlace(a: Place, b: Place): Boolean {
    if (a.code != null && b.code != null) return a.code.trim().equals(b.code.trim(), ignoreCase = true)
    return a.name.trim().equals(b.name.trim(), ignoreCase = true) ||
        (a.address != null && b.address != null && a.address.trim().equals(b.address.trim(), ignoreCase = true))
}

/**
 * A ground transfer: a car or taxi booked from one place to another (an
 * airport to home), not a car hired and returned in one place. It travels,
 * so it is never at home, but it is no round trip either.
 */
fun isTransfer(segment: Segment): Boolean {
    if (segment.type != SegmentType.CAR_RENTAL && segment.type != SegmentType.OTHER) return false
    val origin = segment.origin ?: return false
    val destination = segment.destination ?: return false
    return !samePlace(origin, destination)
}

/** Whether a booking that is not a journey or a transfer happens in the home of its day. */
fun isAtHome(segment: Segment, periods: List<HomePeriod>, overrides: List<HomePeriod> = emptyList()): Boolean {
    if (segment.type in journeyTypes || isTransfer(segment)) return false
    val place = town(segment.destination) ?: return false
    val home = homeAt(periods, localDate(segment.start), overrides) ?: return false
    return sameTown(place, home)
}

/**
 * A correction the user made to where home was: home is this town from
 * [from], until the next correction's date. Kept on the user document as
 * `homes`, at most [MAX_HOME_CORRECTIONS].
 */
data class HomeCorrection(val city: String, val country: String? = null, val from: String)

const val MAX_HOME_CORRECTIONS = 50

/** The corrections as periods, each until the day before the next; two on one date keep the later. */
fun homeCorrections(corrections: List<HomeCorrection>): List<HomePeriod> {
    val sorted = corrections.associateBy { it.from }.values.sortedBy { it.from }
    return sorted.mapIndexed { i, c ->
        val next = sorted.getOrNull(i + 1)
        HomePeriod(c.city, c.country, from = c.from, until = next?.let { LocalDate.parse(it.from).minusDays(1).toString() })
    }
}

/** Home over time as the app uses it: the journeys' answer, overridden from the first correction's date on. */
fun effectiveHomes(inferred: List<HomePeriod>, corrections: List<HomeCorrection>): List<HomePeriod> {
    val corrected = homeCorrections(corrections)
    val cut = corrected.firstOrNull()?.from
    val before = inferred.mapNotNull { p ->
        when {
            cut == null -> p
            p.from != null && p.from >= cut -> null
            p.until != null && p.until < cut -> p
            else -> p.copy(until = LocalDate.parse(cut).minusDays(1).toString())
        }
    }
    val merged = mutableListOf<HomePeriod>()
    for (p in before + corrected) {
        val last = merged.lastOrNull()
        if (last != null && sameTown(Town(last.city, last.country), p)) merged[merged.lastIndex] = last.copy(until = p.until)
        else merged += p
    }
    return merged
}

private val months = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
private fun monthYear(date: String) = "${months[date.substring(5, 7).toInt() - 1]} ${date.take(4)}"

/** Home over time in a line, newest first: "London since Mar 2021 · Boston 2018–2021"; empty when unknown. */
fun describeHomes(periods: List<HomePeriod>): String = periods.reversed().joinToString(" · ") { p ->
    val from = p.from
    val until = p.until
    when {
        from == null && until == null -> p.city
        until == null -> "${p.city} since ${monthYear(from!!)}"
        from == null -> "${p.city} until ${until.take(4)}"
        from.take(4) == until.take(4) -> "${p.city} ${from.take(4)}"
        else -> "${p.city} ${from.take(4)}–${until.take(4)}"
    }
}
