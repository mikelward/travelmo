package app.travelmo.core

import kotlin.math.abs
import kotlinx.datetime.DatePeriod
import kotlinx.datetime.LocalDate
import kotlinx.datetime.minus
import kotlinx.datetime.plus

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
    /** The airports and stations travelled from while living here ([withHomeAirports]): a journey back into one is a journey home. */
    val airports: List<Place> = emptyList(),
    /** A long stay ([longStays]) rather than a home worked out from journeys or set on Profile. */
    val stay: Boolean = false,
    /** That stay's own first day, kept when another long stay cuts into it, as a [NotHomeStay] knows it. */
    val stayFrom: String? = null,
)

private data class Town(val city: String, val country: String?, val lat: Double? = null, val lon: Double? = null)

private val journeyTypes = setOf(SegmentType.FLIGHT, SegmentType.TRAIN, SegmentType.BUS, SegmentType.FERRY)

// A place's town: the city where the source gave one, otherwise its name,
// and where it is when the source or the geocoder said.
private fun town(place: Place?): Town? {
    if (place == null) return null
    val located = place.lat != null && place.lon != null
    return Town(place.city ?: place.name, place.country, if (located) place.lat else null, if (located) place.lon else null)
}

/** How far apart two places can be and still be one town, in kilometers, as home.ts. */
const val NEAR_KM = 20.0

/** The great-circle distance between two points, in kilometers. */
fun distanceKm(aLat: Double, aLon: Double, bLat: Double, bLon: Double): Double {
    val rad = kotlin.math.PI / 180
    val dLat = (bLat - aLat) * rad
    val dLon = (bLon - aLon) * rad
    val h = kotlin.math.sin(dLat / 2).let { it * it } +
        kotlin.math.cos(aLat * rad) * kotlin.math.cos(bLat * rad) * kotlin.math.sin(dLon / 2).let { it * it }
    return 2 * 6371 * kotlin.math.asin(kotlin.math.min(1.0, kotlin.math.sqrt(h)))
}

// No country tells them apart, however it is written ("UK" is GB), and the
// same city, ignoring case, accents and the local or English name, or
// within NEAR_KM where both say where they are. Home has no point, so it
// matches by name alone.
private fun sameTown(a: Town, b: Town): Boolean {
    if (a.country != null && b.country != null && countryCode(a.country) != countryCode(b.country)) return false
    if (sameCity(a.city, b.city)) return true
    return a.lat != null && a.lon != null && b.lat != null && b.lon != null && distanceKm(a.lat, a.lon, b.lat, b.lon) <= NEAR_KM
}

/** A country as its ISO code, whether written as one or by name ("UK", "United Kingdom" and "GB" are all GB). */
fun countryCode(country: String): String = countryCodeOf(country) ?: country.trim().uppercase()

// Every name a city goes by, in English or a language of its country, to
// its own, from the web's generated cityNames.json, as home.ts reads it: a
// station in Göteborg is in the Gothenburg its airport names.
private val otherNames: Map<String, String> by lazy {
    val text = cityNamesJson
    val names = HashMap<String, String>(32_000)
    var pos = 0
    val len = text.length
    while (pos < len) {
        val nl = text.indexOf('\n', pos).let { if (it < 0) len else it }
        val q1 = text.indexOf('"', pos)
        if (q1 in pos until nl) {
            val q2 = text.indexOf('"', q1 + 1)
            val lb = if (q2 in (q1 + 1) until nl) text.indexOf('[', q2 + 1) else -1
            val rb = if (lb in (q2 + 1) until nl) text.lastIndexOf(']', nl - 1) else -1
            if (rb > lb && lb >= 0) {
                val own = text.substring(q1 + 1, q2)
                var cur = lb + 1
                while (cur < rb) {
                    val s1 = text.indexOf('"', cur)
                    if (s1 !in cur until rb) break
                    val s2 = text.indexOf('"', s1 + 1)
                    if (s2 !in (s1 + 1) until rb) break
                    names[text.substring(s1 + 1, s2)] = own
                    cur = s2 + 1
                }
            }
        }
        pos = nl + 1
    }
    names
}

private val marks = Regex("\\p{M}+")
private val spaces = Regex("\\s+")

// Letters that are not an accented letter, so no accent comes off them.
private val plainLetters = mapOf('ø' to "o", 'æ' to "ae", 'œ' to "oe", 'ß' to "ss", 'ł' to "l", 'đ' to "d", 'ð' to "d", 'þ' to "th", 'ı' to "i")

// A city's name with case, accents and spacing set aside, as cityFold.ts folds it.
private fun foldCity(city: String): String =
    decomposed(city).replace(marks, "").trim().lowercase()
        .map { plainLetters[it] ?: it.toString() }.joinToString("").replace(spaces, " ")

// The name a city goes by in the table, whichever of its names was given.
private fun ownName(city: String): String = foldCity(city).let { otherNames[it] ?: it }

/** Whether two city names are one city: ignoring case, accents and the local or English name. */
fun sameCity(a: String, b: String): Boolean = ownName(a) == ownName(b)

private fun sameTown(a: Town, b: HomePeriod): Boolean = sameTown(a, Town(b.city, b.country))

private data class ResolvedTown(val town: Town, val ownCity: String, val code: String?)

private fun resolveTown(t: Town): ResolvedTown = ResolvedTown(t, ownName(t.city), t.country?.let(::countryCode))

private fun sameResolvedTown(a: ResolvedTown, b: ResolvedTown): Boolean {
    if (a.code != null && b.code != null && a.code != b.code) return false
    if (a.ownCity == b.ownCity) return true
    val ta = a.town
    val tb = b.town
    return ta.lat != null && ta.lon != null && tb.lat != null && tb.lon != null && distanceKm(ta.lat, ta.lon, tb.lat, tb.lon) <= NEAR_KM
}

private data class RoundTrip(val base: ResolvedTown, val start: String, val from: Place, val back: Place)

// How long someone can be away from a town and still live there, in days: a
// longer round trip says nothing about where home is (they lived away, or its
// way out was never imported and it is the way back from one visit and the
// way out on the next).
private const val STAY_DAYS = 60L

// Each round trip leaves from a town and ends with the first journey back
// into it, however many legs lie between; a chain that never returns, or is
// away longer than STAY_DAYS, gives none, and the next journey starts afresh,
// so round trips within a long one count instead. Legs go in the order they
// leave, by instant, since local times misorder them across the date line; a
// journey within one town goes nowhere and says nothing.
private fun roundTrips(segments: List<Segment>): List<RoundTrip> {
    class TimedJourney(val seg: Segment, val startMs: Long, val from: ResolvedTown, val to: ResolvedTown)
    // A cancelled journey was never travelled, so it says nothing about home.
    val journeys = ArrayList<TimedJourney>()
    for (s in liveSegments(segments)) {
        if (s.type !in journeyTypes) continue
        val fromTown = town(s.origin) ?: continue
        val toTown = town(s.destination) ?: continue
        val from = resolveTown(fromTown)
        val to = resolveTown(toTown)
        if (sameResolvedTown(from, to)) continue
        journeys += TimedJourney(s, instantMillis(s.start), from, to)
    }
    journeys.sortBy { it.startMs }
    val maxMs = STAY_DAYS * 86_400_000L
    val trips = mutableListOf<RoundTrip>()
    var i = 0
    while (i < journeys.size) {
        val start = journeys[i]
        val base = start.from
        var back = -1
        for (k in i until journeys.size) {
            if (journeys[k].startMs - start.startMs > maxMs) break
            if (sameResolvedTown(journeys[k].to, base)) {
                back = k
                break
            }
        }
        if (back < 0) {
            i++
            continue
        }
        trips += RoundTrip(base, localDate(start.seg.start), start.seg.origin!!, journeys[back].seg.destination!!)
        i = back + 1
    }
    return trips
}

/**
 * Home over time. The base of the first round trip is home until another
 * base holds for two round trips in a row: a move, dated from the first of
 * them. A single trip from somewhere else is not a move, and nor are trips
 * from somewhere when the next round trip after them is from home again.
 */
fun homeTimeline(segments: List<Segment>): List<HomePeriod> = homeBasesFrom(roundTrips(segments)).map { it.first }

// homeTimeline's periods with the town each was worked out from, its point included, as home.ts's homeBases.
private fun homeBasesFrom(trips: List<RoundTrip>): List<Pair<HomePeriod, ResolvedTown>> {
    val periods = mutableListOf<Pair<HomePeriod, ResolvedTown>>()
    var current: ResolvedTown? = null
    var i = 0
    while (i < trips.size) {
        val trip = trips[i]
        val home = current
        if (home == null) {
            current = trip.base
            periods += HomePeriod(trip.base.town.city, trip.base.town.country) to trip.base
            i++
            continue
        }
        if (sameResolvedTown(trip.base, home)) {
            i++
            continue
        }
        var end = i
        while (end + 1 < trips.size && sameResolvedTown(trips[end + 1].base, trip.base)) end++
        val after = trips.getOrNull(end + 1)
        if (end > i && (after == null || !sameResolvedTown(after.base, home))) {
            val (last, lastBase) = periods.last()
            periods[periods.lastIndex] = last.copy(until = LocalDate.parse(trip.start).minus(DatePeriod(days = 1)).toString()) to lastBase
            periods += HomePeriod(trip.base.town.city, trip.base.town.country, from = trip.start) to trip.base
            current = trip.base
        }
        i = end + 1
    }
    return periods
}

// How many round trips must leave from or come back into an airport or station while someone lives somewhere for it to
// be one of that home's: one could be a trip from a relative's on a visit.
private const val HOME_AIRPORT_TRIPS = 2

// One airport or station: by its code, else by its name in its city and country, as names repeat (Washington's Union
// Station and Chicago's).
private fun placeKey(place: Place) =
    (place.code ?: listOf(place.name, place.city.orEmpty(), place.country?.let(::countryCode).orEmpty()).joinToString("|")).trim().lowercase()

private fun attachHomeAirports(periods: List<HomePeriod>, allTrips: List<RoundTrip>, bases: List<Pair<HomePeriod, ResolvedTown>>): List<HomePeriod> {
    val trips = allTrips.filter { t -> bases.firstOrNull { it.first.covers(t.start) }?.let { sameResolvedTown(t.base, it.second) } == true }
    return periods.map { period ->
        val counts = LinkedHashMap<String, Pair<Place, Int>>()
        for (trip in trips) {
            if (!period.covers(trip.start)) continue
            for ((key, place) in listOf(trip.from, trip.back).associateBy(::placeKey)) {
                counts[key] = (counts[key]?.first ?: place) to ((counts[key]?.second ?: 0) + 1)
            }
        }
        period.copy(airports = counts.values.filter { it.second >= HOME_AIRPORT_TRIPS }.map { it.first })
    }
}

/**
 * Each period with the airports and stations its round trips in [segments] leave from or come back into, each at least
 * twice while it was home, as home.ts's withHomeAirports: a correction to Mountain View gets the SFO its trips start from.
 */
fun withHomeAirports(periods: List<HomePeriod>, segments: List<Segment>): List<HomePeriod> {
    // Only round trips from what the journeys say was home at the time: side trips on a visit whose way out was never
    // imported leave from where the visit was, not from home.
    // As homeTimeline tells them, by name or by being near (SFO and Oakland).
    val trips = roundTrips(segments)
    return attachHomeAirports(periods, trips, homeBasesFrom(trips))
}

/** Effective home periods (corrections when present, else inferred) with long stays and worked-out and chosen airports, computing round trips once. */
fun effectiveHomesWithAirports(
    segments: List<Segment>,
    corrections: List<HomeCorrection>,
    chosen: List<ChosenHomeAirports> = emptyList(),
    notHome: List<NotHomeStay> = emptyList(),
): List<HomePeriod> {
    val trips = roundTrips(segments)
    val bases = homeBasesFrom(trips)
    val basePeriods = if (corrections.isEmpty()) bases.map { it.first } else homeCorrections(corrections)
    return withChosenAirports(withLongStays(attachHomeAirports(basePeriods, trips, bases), segments, notHome), chosen)
}

/** How many nights back to back in one town count as living there. */
const val LONG_STAY_NIGHTS = 28

private fun dayAfter(date: String) = LocalDate.parse(date).plus(DatePeriod(days = 1)).toString()
private fun dayBefore(date: String) = LocalDate.parse(date).minus(DatePeriod(days = 1)).toString()

/**
 * The stays a person lived in rather than visited: stays in one town back to back (one checking in by the day after
 * the last checks out, whatever is booked elsewhere meanwhile) for [LONG_STAY_NIGHTS] or more, a run each, from the
 * first check-in to the last check-out. Cancelled stays don't count.
 */
fun longStays(segments: List<Segment>): List<HomePeriod> {
    val stays = segments
        .filter { it.type == SegmentType.LODGING && !it.isCancelled && it.end != null && it.destination?.city != null }
        .sortedWith { a, b -> compareInstants(a.start, b.start) }
    val runs = mutableListOf<HomePeriod>()
    for (stay in stays) {
        val city = stay.destination!!.city!!
        val from = localDate(stay.start)
        val until = localDate(stay.end!!)
        val country = stay.destination.country?.let(::countryCodeOf)
        // The latest run in this town: a stay elsewhere in between (a week away while the flat is still booked) doesn't end it.
        val i = runs.indexOfLast { sameCity(city, it.city) && (country == null || it.country == null || country == it.country) }
        val last = runs.getOrNull(i)
        if (last != null && from <= dayAfter(last.until!!)) {
            if (until > last.until) runs[i] = last.copy(until = until)
            continue
        }
        runs += HomePeriod(city, country, from = from, until = until, stay = true)
    }
    return runs.filter { daysBetween(it.from!!, it.until!!) >= LONG_STAY_NIGHTS }
}

/**
 * The airport or station in its country a long stay is lived in from, as a home's are those its round trips use: where
 * the person, landing in its days, stays longest before leaving again or the stay ends, and at least two days. A month in a Sunnyvale flat landing at SFO from Sydney and leaving from it for London is lived
 * in from SFO; a weekend at JFK from it, or changing planes in Detroit, is not.
 */
private fun stayAirports(stay: HomePeriod, segments: List<Segment>): List<Place> {
    val within = { instant: String -> localDate(instant) >= stay.from!! && localDate(instant) <= stay.until!! }
    val journeys = segments.filter { it.type in journeyTypes && !it.isCancelled }.sortedWith { a, b -> compareInstants(a.start, b.start) }
    // In the stay's own country: changing planes in Sydney on the way back doesn't make Sydney the flat's airport.
    val country = stay.country?.let(::countryCode)
    val local = { a: Place -> country != null && (a.country?.let(::countryCode) ?: a.code?.let { airportPlace(it)?.country }) == country }
    val longest = linkedMapOf<String, Pair<Place, Long>>()
    for (s in journeys) {
        val landed = s.destination ?: continue
        val arrival = s.end ?: s.start
        if (landed.code == null || !local(landed) || !within(arrival)) continue
        // The next journey in the stay's days: one after it says nothing of where it was left from.
        val next = journeys.firstOrNull { compareInstants(it.start, arrival) > 0 && localDate(it.start) <= stay.until!! }
        // Left from it, or from its city where an email gives only that.
        if (next?.origin != null && placeKey(next.origin) != placeKey(landed) && !bareCityOf(next.origin, landed)) continue
        val days = daysBetween(localDate(arrival), next?.let { localDate(it.start) } ?: stay.until!!)
        val key = placeKey(landed)
        if (days > (longest[key]?.second ?: -1L)) longest[key] = landed to days
    }
    val most = maxOf(2L, longest.values.maxOfOrNull { it.second } ?: 0L)
    return longest.values.filter { it.second >= most }.map { it.first }
}

/** A long stay said not to be home on Profile (Not home), by its town and first day, as schema.ts's NotHomeStay. */
data class NotHomeStay(val city: String, val country: String? = null, val from: String)

/**
 * Home with each long stay ([longStays]) as home for its days, but those said not to be ([notHome]): a month in a
 * rented flat is living there, so a trip from it starts there and one back to it ends.
 */
fun withLongStays(periods: List<HomePeriod>, segments: List<Segment>, notHome: List<NotHomeStay> = emptyList()): List<HomePeriod> {
    var out = periods
    for (found in longStays(segments)) {
        val from = found.from!!
        val until = found.until!!
        if (notHome.any { it.from == from && sameCity(it.city, found.city) && (it.country == null || found.country == null || it.country == found.country) }) continue
        // A long stay in the town already home there keeps that home's airports.
        // And has those it is left from and come back to by ([stayAirports]).
        val covering = out.find { (it.from == null || it.from <= from) && (it.until == null || from <= it.until) }
        val airports = (if (covering != null && sameCity(covering.city, found.city)) covering.airports else emptyList()).toMutableList()
        for (a in stayAirports(found, segments)) if (airports.none { placeKey(it) == placeKey(a) }) airports += a
        val stay = found.copy(airports = airports)
        out = out.flatMap { p ->
            if ((p.until != null && p.until < from) || (p.from != null && p.from > until)) return@flatMap listOf(p)
            val before = if (p.from == null || p.from < from) listOf(p.copy(until = dayBefore(from))) else emptyList()
            val after = if (p.until == null || p.until > until) listOf(p.copy(from = dayAfter(until))) else emptyList()
            before + after
        } + stay.copy(stayFrom = from)
    }
    return out.sortedBy { it.from ?: "" }
}

/** A long stay as Profile lists it: "London, 13 Feb – 20 Mar 2022". */
fun longStayText(period: HomePeriod): String =
    if (period.from != null && period.until != null) "${period.city}, ${formatDateRange(period.from, period.until)}" else period.city

// Home over time with the long stays taken out and what they split joined.
private fun withoutStays(periods: List<HomePeriod>): List<HomePeriod> {
    val out = mutableListOf<HomePeriod>()
    for (p in periods) {
        if (p.stay) continue
        val last = out.lastOrNull()
        if (last != null && sameCity(last.city, p.city) && last.country == p.country) out[out.lastIndex] = last.copy(until = p.until) else out += p
    }
    return out
}

/** The airports and stations chosen for a home on Profile, by its town, as schema.ts's ChosenHomeAirports. */
data class ChosenHomeAirports(val city: String, val country: String? = null, val airports: List<String>)

/** Codes a home's airports may have at most, as schema.ts's maxHomeAirports. */
const val MAX_HOME_AIRPORTS = 10

private val homeAirportCode = Regex("^[A-Za-z0-9]{3,5}$")

/** The airports chosen for each home, by its town, in place of those worked out, as home.ts's withChosenAirports. */
fun withChosenAirports(periods: List<HomePeriod>, chosen: List<ChosenHomeAirports>): List<HomePeriod> = periods.map { period ->
    // Its own town's choice (München and Munich are one), else one saved without a country for its city.
    val choice = chosen.firstOrNull { homeTownKey(it.city, it.country) == homeTownKey(period.city, period.country) }
        ?: chosen.firstOrNull { sameCity(it.city, period.city) && (it.country == null || period.country == null) }
        ?: return@map period
    period.copy(airports = choice.airports.map { Place(it, code = it) })
}

/** One home town, as Profile lists its airports and as its choice is stored: by city and country, as two Londons are two homes. */
fun homeTownKey(city: String, country: String?): String = "${ownName(city)}|${country?.let(::countryCode).orEmpty()}"

/** A home's airports as Profile lists them: their codes, else their names. */
fun airportCodes(period: HomePeriod): List<String> = period.airports.map { it.code ?: it.name }

sealed interface ParsedAirports {
    data class Codes(val codes: List<String>) : ParsedAirports
    data class Problem(val text: String) : ParsedAirports
}

private val airportCodeSeparators = Regex("[\\s,;]+")

/** Airport or station codes as typed ("SFO, sjc"), or why they can't be, as home.ts's parseAirportCodes. */
fun parseAirportCodes(text: String): ParsedAirports {
    val codes = mutableListOf<String>()
    for (word in text.split(airportCodeSeparators).filter { it.isNotEmpty() }) {
        if (!homeAirportCode.matches(word)) return ParsedAirports.Problem("\"$word\" isn't an airport or station code.")
        val code = word.uppercase()
        if (code !in codes) codes += code
    }
    if (codes.size > MAX_HOME_AIRPORTS) return ParsedAirports.Problem("Up to $MAX_HOME_AIRPORTS airports.")
    return ParsedAirports.Codes(codes)
}

/**
 * Whether a journey's end ([place], on [date]) is home: in the home of its day, or one of that home's airports or
 * stations, as home.ts's journeyHome. Only for journeys: a hotel by the airport is not at home.
 */
fun journeyHome(place: Place?, date: String, periods: List<HomePeriod>, overrides: List<HomePeriod> = emptyList()): Boolean {
    if (inHomeTown(place, date, periods, overrides)) return true
    val home = homeAt(periods, date, overrides) ?: return false
    return place != null && home.airports.any { placeKey(it) == placeKey(place) || bareCityOf(place, it) }
}

/** Whether [place] is only a city, as some airlines' emails give a flight's ends ("Boston → San Francisco"), and [airport] is in it. */
private fun bareCityOf(place: Place, airport: Place): Boolean {
    if (place.code != null || (place.city != null && !sameCity(place.name, place.city))) return false
    val code = airport.code ?: return false
    // A chosen airport is only its code: its city and country are the table's.
    val known = airportPlace(code)
    val city = airport.city ?: known?.city ?: return false
    val country = airport.country ?: known?.country
    val differ = place.country != null && country != null && countryCode(place.country) != countryCode(country)
    return sameCity(city, place.city ?: place.name) && !differ
}

private fun HomePeriod.covers(date: String) = (from == null || from <= date) && (until == null || date <= until)

/**
 * Home on [date]. Corrections in [overrides], once there are any, are the
 * whole timeline: there is no home before the earliest of them.
 */
fun homeAt(periods: List<HomePeriod>, date: String, overrides: List<HomePeriod> = emptyList()): HomePeriod? =
    overrides.ifEmpty { periods }.firstOrNull { it.covers(date) }

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

/** The longest city name a correction keeps, as schema.ts's maxHomeCityLength. */
const val MAX_HOME_CITY_LENGTH = 100

/** The corrections as periods, each until the day before the next; two on one date keep the later. */
fun homeCorrections(corrections: List<HomeCorrection>): List<HomePeriod> {
    val sorted = corrections.associateBy { it.from }.values.sortedBy { it.from }
    return sorted.mapIndexed { i, c ->
        val next = sorted.getOrNull(i + 1)
        // As a code, however it was saved ("UK" before the web's form required one).
        HomePeriod(c.city, c.country?.let(::countryCode), from = c.from, until = next?.let { LocalDate.parse(it.from).minus(DatePeriod(days = 1)).toString() })
    }
}

/**
 * Home over time as the app uses it: the journeys' answer until the user
 * corrects it, then their corrections alone, with no home before the
 * earliest of them.
 */
fun effectiveHomes(inferred: List<HomePeriod>, corrections: List<HomeCorrection>): List<HomePeriod> =
    if (corrections.isEmpty()) inferred else homeCorrections(corrections)

private val months = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
private fun monthYear(date: String) = "${months[date.substring(5, 7).toInt() - 1]} ${date.take(4)}"

/**
 * Home over time in a line, newest first: "London since Mar 2021 · Boston 2018–2021"; empty when unknown. Long stays
 * are left to their own rows ([longStayText]), the home they cut into joined up again.
 */
fun describeHomes(periods: List<HomePeriod>): String = withoutStays(periods).reversed().joinToString(" · ") { p ->
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

/** Whether [place] is in the town that was home on [date]; false when either is unknown. */
fun inHomeTown(place: Place?, date: String, periods: List<HomePeriod>, overrides: List<HomePeriod> = emptyList()): Boolean {
    val where = town(place) ?: return false
    val home = homeAt(periods, date, overrides) ?: return false
    return sameTown(where, home)
}

// Words that say nothing about which airport or station a place is.
private val hubWords = setOf("airport", "international", "terminal", "station", "central", "railway", "rail", "city")

private val nonAlnumUpper = Regex("[^A-Z0-9]")

private fun isAsciiWordChar(c: Char): Boolean =
    (c in '0'..'9') || (c in 'A'..'Z') || (c in 'a'..'z') || c == '_'

private fun containsWholeWord(text: String, upperCode: String): Boolean {
    val upperText = text.uppercase()
    val len = upperCode.length
    var at = upperText.indexOf(upperCode)
    while (at >= 0) {
        val beforeOk = at == 0 || !isAsciiWordChar(upperText[at - 1])
        val afterOk = at + len == upperText.length || !isAsciiWordChar(upperText[at + len])
        if (beforeOk && afterOk) return true
        at = upperText.indexOf(upperCode, at + 1)
    }
    return false
}

// Whether a place in a ride's booking is the airport or station [hub]: the
// same code, the code written in it, or a word of the hub's name that is not
// its town's ("Heathrow" of London Heathrow).
private fun atHub(place: Place, hub: Place): Boolean {
    if (place.code != null && hub.code != null) return place.code.equals(hub.code, ignoreCase = true)
    val text = "${place.name} ${place.address ?: ""}"
    val code = hub.code?.uppercase()?.replace(nonAlnumUpper, "")
    if (!code.isNullOrEmpty() && containsWholeWord(text, code)) return true
    val townWords = wordsOf("${hub.city ?: ""} ${hub.country ?: ""}").toSet()
    val words = wordsOf(text).toSet()
    return wordsOf(hub.name).any { it.length >= 4 && it !in hubWords && it !in townWords && it in words }
}

// How close a ride must be to a journey at the same airport or station to belong with it.
private const val CONNECTION_HOURS = 12L

private fun waitBetween(from: String, to: String): Long? {
    val ms = instantMillis(to) - instantMillis(from)
    return ms.takeIf { it >= 0 && it <= CONNECTION_HOURS * 3_600_000 }
}

/** How long after [journey] arrives [ride] leaves its airport or station; null when it doesn't take the traveler on. */
fun rideFromArrival(ride: Segment, journey: Segment): Long? {
    if (!isTransfer(ride) || journey.type !in journeyTypes) return null
    val hub = journey.destination ?: return null
    return if (atHub(ride.origin!!, hub)) waitBetween(journey.end ?: journey.start, ride.start) else null
}

/** How long before [journey] leaves [ride] reaches its airport or station; null when it doesn't bring the traveler there. */
fun rideToDeparture(ride: Segment, journey: Segment): Long? {
    if (!isTransfer(ride) || journey.type !in journeyTypes) return null
    val hub = journey.origin ?: return null
    return if (atHub(ride.destination!!, hub)) waitBetween(ride.end ?: ride.start, journey.start) else null
}

/** Whether [place] is the airport or station [hub], or in its town: where a car hired for a flight is collected. */
fun nearHub(place: Place?, hub: Place?): Boolean {
    if (place == null || hub == null) return false
    if (atHub(place, hub)) return true
    val a = town(place) ?: return false
    val b = town(hub) ?: return false
    return sameTown(a, b)
}

/** How far apart one city's airports or stations can be, in kilometers, as home.ts: JFK and Newark, Heathrow and Gatwick. */
const val AREA_KM = 80.0

// A place's town with its point, the airport table's when it was given only a code.
private fun locatedTown(place: Place?): Town? {
    val t = town(place) ?: return null
    if (t.lat != null || place?.code == null) return t
    val airport = airportPlace(place.code) ?: return t
    return t.copy(lat = airport.lat, lon = airport.lon)
}

/** How far a person might drive between journeys, in kilometers, as home.ts: past it, a journey is missing. */
const val DRIVE_KM = 300.0

/**
 * Whether getting from [a] to [b] takes a journey of its own (a flight or a
 * train, not a drive): over DRIVE_KM apart or, where either's point is
 * unknown, in different countries. As home.ts's farApart.
 */
fun farApart(a: Place?, b: Place?): Boolean {
    val x = locatedTown(a) ?: return false
    val y = locatedTown(b) ?: return false
    if (sameTown(x, y)) return false
    if (x.lat != null && x.lon != null && y.lat != null && y.lon != null) return distanceKm(x.lat, x.lon, y.lat, y.lon) > DRIVE_KM
    return x.country != null && y.country != null && countryCode(x.country) != countryCode(y.country)
}

// Whether two places are one city's, as far as its airports and stations go: the same town, or within AREA_KM in one country.
fun sameArea(a: Place?, b: Place?): Boolean {
    val x = locatedTown(a) ?: return false
    val y = locatedTown(b) ?: return false
    if (sameTown(x, y)) return true
    if (x.country != null && y.country != null && countryCode(x.country) != countryCode(y.country)) return false
    return x.lat != null && x.lon != null && y.lat != null && y.lon != null && distanceKm(x.lat, x.lon, y.lat, y.lon) <= AREA_KM
}

// When a journey arrives: its end, unless that is more than eight days after it leaves, as home.ts's arrives.
private fun arrives(s: Segment): String {
    val end = s.end ?: return s.start
    return if (instantMillis(end) - instantMillis(s.start) <= 8 * 86_400_000L) end else s.start
}

/**
 * Whether [next] is the onward journey of a connection at [landing]'s destination, as home.ts: it leaves from there (or
 * another of that city's airports) within twelve hours of landing.
 */
fun isConnection(landing: Segment, next: Segment): Boolean {
    if (landing.type !in journeyTypes || next.type !in journeyTypes) return false
    val gap = instantMillis(next.start) - instantMillis(arrives(landing))
    return gap > 0 && gap <= 12 * 3_600_000L && sameArea(landing.destination, next.origin)
}

/**
 * Whether a journey that lands away from home opens the trip whose first booking is [next], as home.ts: a journey
 * leaving the same city, or another of its airports or stations, after it lands.
 */
fun opensTrip(landing: Segment, next: Segment, periods: List<HomePeriod>, overrides: List<HomePeriod> = emptyList()): Boolean {
    if (landing.type !in journeyTypes || next.type !in journeyTypes) return false
    val landed = arrives(landing)
    if (journeyHome(landing.destination, landed.take(10), periods, overrides)) return false
    return compareInstants(next.start, landed) > 0 && sameArea(landing.destination, next.origin)
}

private const val REBOOKED_WITHIN_DAYS = 14

private fun bookingReference(s: Segment): String = s.confirmation?.uppercase()?.filter { it in 'A'..'Z' || it in '0'..'9' } ?: ""

private const val MAX_JOURNEYS = 64

// Every journey the flights make, as home.ts's journeys: each whole run of connections under one reference, from a
// flight nothing connects onto to one that connects onto nothing, a flight on several runs on each.
private fun journeys(flights: List<Segment>): List<List<Segment>> {
    fun joins(landing: Segment, next: Segment) = bookingReference(landing) == bookingReference(next) && isConnection(landing, next)
    val sorted = flights.sortedWith { a, b -> compareInstants(a.start, b.start) }
    val onward = sorted.mapIndexed { i, flight -> sorted.filterIndexed { j, next -> j > i && joins(flight, next) } }
    val reached = onward.flatten().toSet()
    val out = mutableListOf<List<Segment>>()
    fun walk(path: List<Segment>) {
        if (out.size >= MAX_JOURNEYS) return
        val next = onward[sorted.indexOf(path.last())]
        if (next.isEmpty()) out += path
        for (flight in next) walk(path + flight)
    }
    for (flight in sorted) if (flight !in reached) walk(listOf(flight))
    return out
}

/** A flight a rebooking replaced, with every journey that replaced it (the latest email confirming one whole dates the cancellation). */
data class RebookedFlight(val flight: Segment, val by: List<List<Segment>>)

/**
 * The flights of [older] that [newer] rebooked, as home.ts's rebookedFlights: whole journeys under the same reference,
 * between the same cities (or their other airports), leaving within two weeks of each other.
 */
fun rebookedFlights(older: List<Segment>, newer: List<Segment>): List<RebookedFlight> {
    fun referenced(list: List<Segment>) = list.filter { it.type == SegmentType.FLIGHT && bookingReference(it).isNotEmpty() }
    val fresh = journeys(referenced(newer))
    val found = mutableMapOf<Segment, List<List<Segment>>>()
    for (journey in journeys(referenced(older))) {
        val first = journey.first()
        val last = journey.last()
        val by = fresh.filter { other ->
            val from = other.first()
            val reference = bookingReference(from)
            journey.all { bookingReference(it) == reference } &&
                other.all { bookingReference(it) == reference } &&
                sameArea(first.origin, from.origin) &&
                sameArea(last.destination, other.last().destination) &&
                abs(instantMillis(from.start) - instantMillis(first.start)) <= REBOOKED_WITHIN_DAYS * 86_400_000L
        }
        if (by.isNotEmpty()) for (flight in journey) found[flight] = (found[flight].orEmpty() + by).distinct()
    }
    return older.filter { it in found }.map { RebookedFlight(it, found.getValue(it)) }
}

/** The Profile's home line, as home.ts: "Home: London since Mar 2021 · Boston 2018–2021"; null when nothing is known. */
fun homeLine(periods: List<HomePeriod>): String? = describeHomes(periods).takeIf { it.isNotEmpty() }?.let { "Home: $it" }

/** One correction as the Profile lists it: "London, GB from 12 Mar 2021". */
fun correctionText(c: HomeCorrection): String = "${if (c.country != null) "${c.city}, ${c.country}" else c.city} from ${formatDayMonthYear(c.from)}"

/** A correction from the Profile's fields, or why it cannot be one. */
sealed interface ParsedCorrection {
    data class Correction(val correction: HomeCorrection) : ParsedCorrection
    data class Problem(val text: String) : ParsedCorrection
}

/** As home.ts's parseCorrection: a city, an optional country (a name or short form saved as its code) and a date. */
fun parseCorrection(city: String, country: String, from: String): ParsedCorrection {
    // A name or a common short form ("UK") is saved as its ISO code.
    val code = country.trim().takeIf { it.isNotEmpty() }?.let(::countryCode)
    if (city.isBlank()) return ParsedCorrection.Problem("Enter a city.")
    if (city.trim().length > MAX_HOME_CITY_LENGTH) return ParsedCorrection.Problem("Use a city name of at most $MAX_HOME_CITY_LENGTH characters.")
    if (code != null && (code.length != 2 || !isCountryCode(code))) return ParsedCorrection.Problem("Use a two-letter country code, such as GB.")
    val date = try {
        LocalDate.parse(from.trim()).toString()
    } catch (e: IllegalArgumentException) {
        return ParsedCorrection.Problem("Enter a date.")
    }
    return ParsedCorrection.Correction(HomeCorrection(city.trim(), code, date))
}
