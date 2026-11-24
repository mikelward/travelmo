package app.travelmo.core

import kotlinx.datetime.DatePeriod
import kotlinx.datetime.LocalDate
import kotlinx.datetime.minus

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

// Cities with an English name besides their own, by their own name folded,
// as packages/core's home.ts lists them.
private val cityNames = mapOf(
    "goteborg" to "gothenburg", "munchen" to "munich", "koln" to "cologne", "wien" to "vienna", "praha" to "prague",
    "warszawa" to "warsaw", "krakow" to "cracow", "kobenhavn" to "copenhagen", "lisboa" to "lisbon", "roma" to "rome",
    "milano" to "milan", "napoli" to "naples", "firenze" to "florence", "venezia" to "venice", "torino" to "turin",
    "geneve" to "geneva", "bruxelles" to "brussels", "brussel" to "brussels", "den haag" to "the hague", "sevilla" to "seville",
    "athina" to "athens", "moskva" to "moscow", "ciudad de mexico" to "mexico city",
)

private val marks = Regex("\\p{M}+")

// Letters that are not an accented letter, so no accent comes off them.
private val plainLetters = mapOf('ø' to "o", 'æ' to "ae", 'œ' to "oe", 'ß' to "ss", 'ł' to "l", 'đ' to "d", 'ð' to "d", 'þ' to "th", 'ı' to "i")

private fun foldCity(city: String): String {
    val folded = decomposed(city).replace(marks, "").trim().lowercase()
        .map { plainLetters[it] ?: it.toString() }.joinToString("")
    return cityNames[folded] ?: folded
}

/** Whether two city names are one city: ignoring case, accents and the local or English name. */
fun sameCity(a: String, b: String): Boolean = foldCity(a) == foldCity(b)

private fun sameTown(a: Town, b: HomePeriod): Boolean = sameTown(a, Town(b.city, b.country))

private data class RoundTrip(val base: Town, val start: String)

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
    // A cancelled journey was never travelled, so it says nothing about home.
    val journeys = liveSegments(segments)
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
        if (back == null || instantMillis(journeys[back].start) - instantMillis(journeys[i].start) > STAY_DAYS * 86_400_000L) {
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
 * them. A single trip from somewhere else is not a move, and nor are trips
 * from somewhere when the next round trip after them is from home again.
 */
fun homeTimeline(segments: List<Segment>): List<HomePeriod> {
    val trips = roundTrips(segments)
    val periods = mutableListOf<HomePeriod>()
    var current: Town? = null
    var i = 0
    while (i < trips.size) {
        val trip = trips[i]
        val home = current
        if (home == null) {
            current = trip.base
            periods += HomePeriod(trip.base.city, trip.base.country)
            i++
            continue
        }
        if (sameTown(trip.base, home)) {
            i++
            continue
        }
        var end = i
        while (end + 1 < trips.size && sameTown(trips[end + 1].base, trip.base)) end++
        val after = trips.getOrNull(end + 1)
        if (end > i && (after == null || !sameTown(after.base, home))) {
            periods[periods.lastIndex] = periods.last().copy(until = LocalDate.parse(trip.start).minus(DatePeriod(days = 1)).toString())
            periods += HomePeriod(trip.base.city, trip.base.country, from = trip.start)
            current = trip.base
        }
        i = end + 1
    }
    return periods
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

/** Whether [place] is in the town that was home on [date]; false when either is unknown. */
fun inHomeTown(place: Place?, date: String, periods: List<HomePeriod>, overrides: List<HomePeriod> = emptyList()): Boolean {
    val where = town(place) ?: return false
    val home = homeAt(periods, date, overrides) ?: return false
    return sameTown(where, home)
}

// Words that say nothing about which airport or station a place is.
private val hubWords = setOf("airport", "international", "terminal", "station", "central", "railway", "rail", "city")
private fun wordsOf(text: String) = text.lowercase().split(Regex("[^\\p{L}\\p{N}]+")).filter { it.isNotEmpty() }

// Whether a place in a ride's booking is the airport or station [hub]: the
// same code, the code written in it, or a word of the hub's name that is not
// its town's ("Heathrow" of London Heathrow).
private fun atHub(place: Place, hub: Place): Boolean {
    if (place.code != null && hub.code != null) return place.code.equals(hub.code, ignoreCase = true)
    val text = "${place.name} ${place.address ?: ""}"
    val code = hub.code?.uppercase()?.replace(Regex("[^A-Z0-9]"), "")
    if (!code.isNullOrEmpty() && Regex("\\b$code\\b", RegexOption.IGNORE_CASE).containsMatchIn(text)) return true
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

// Whether two places are one city's, as far as its airports and stations go: the same town, or within AREA_KM in one country.
private fun sameArea(a: Place?, b: Place?): Boolean {
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
    if (inHomeTown(landing.destination, landed.take(10), periods, overrides)) return false
    return compareInstants(next.start, landed) > 0 && sameArea(landing.destination, next.origin)
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
