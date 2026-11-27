package app.travelmo.core

import kotlinx.datetime.LocalDate
import kotlinx.serialization.Serializable

// Where the user has been, worked out from their trips' bookings alone, as
// packages/core/src/reports.ts: a place is known by the country its booking
// names, or for a flight by its airport code, and sits on the map where its
// booking says it is.

private val transport = setOf(SegmentType.FLIGHT, SegmentType.TRAIN, SegmentType.BUS, SegmentType.FERRY, SegmentType.CAR_RENTAL)

/**
 * A moment the traveler is known to be somewhere: the country counts for that
 * day, and `then` is where they are afterwards; `transit` marks setting off
 * on a journey, after which they are in no country until it arrives. `moves`
 * marks a journey or a stay, which puts the traveler where it says even when
 * that is not known; an outing that names no country (a show, a class)
 * leaves them where they were.
 */
private data class Moment(val at: String, val country: String?, val then: String?, val transit: Boolean = false, val moves: Boolean = false)

// A flight's ends that are a connection, as reports.ts finds them: it
// lands where the next flight leaves from (the same airport code) within a
// day, with no stay booked in between, so the landing and the takeoff place
// the traveler in no country, though they are still away.
private const val CONNECTION_HOURS = 24L

// An instant as a booking writes it, as compareInstants reads it when the
// timeline is sorted (a time that doesn't parse fails there either way).
private fun instantAt(at: String): Long = instantMillis(at)

private fun connections(live: List<Segment>, lookup: (String) -> AirportPlace?): Pair<Set<Segment>, Set<Segment>> {
    class TimedFlight(val s: Segment, val start: Long, val end: Long)
    class TimedStay(val start: Long, val end: Long, val where: String?)
    val flights = live.filter { it.type == SegmentType.FLIGHT }
        .map { TimedFlight(it, instantAt(it.start), instantAt(it.end ?: it.start)) }
        .sortedBy { it.start }
    val stays = live.filter { it.type == SegmentType.LODGING }
        .map { TimedStay(instantAt(it.start), instantAt(it.end ?: it.start), placeCountry(it.destination ?: it.origin, SegmentType.LODGING, lookup)) }
    val lands = mutableSetOf<Segment>()
    val leaves = mutableSetOf<Segment>()
    for (i in 0 until flights.size - 1) {
        val a = flights[i]
        val b = flights[i + 1]
        val at = a.s.destination?.code?.trim()?.uppercase() ?: continue
        if (at != b.s.origin?.code?.trim()?.uppercase()) continue
        val landed = a.end
        val left = b.start
        if (left < landed || left - landed > CONNECTION_HOURS * 3_600_000) continue
        // Only a stay in the connection's country makes it a stopover: a
        // hotel booked where the trip goes next can overlap the change of planes.
        val country = placeCountry(a.s.destination, SegmentType.FLIGHT, lookup)
        val stayed = stays.any { stay ->
            (stay.where == null || country == null || stay.where == country) &&
                stay.start < left && stay.end > landed
        }
        if (stayed) continue
        lands += a.s
        leaves += b.s
    }
    return lands to leaves
}

private fun moments(segment: Segment, lookup: (String) -> AirportPlace?, lands: Boolean = false, leaves: Boolean = false): List<Moment> {
    if (segment.type in transport) {
        val from = if (leaves) null else placeCountry(segment.origin, segment.type, lookup)
        val to = if (lands) null else placeCountry(segment.destination, segment.type, lookup)
        // A car is driven from place to place in between; a flight is in the air.
        // Only a flight is in no country on the way. A drive, a train, a bus
        // or a ferry that starts and ends in one country stays in it
        // throughout (a two-night train across the US never leaves it);
        // between two countries, where it is on the days between is not
        // known, which is not the same as nowhere.
        val flight = segment.type == SegmentType.FLIGHT
        val during = if (!flight && from != null && from == to) from else null
        return listOf(Moment(segment.start, from, during, transit = flight, moves = true), Moment(segment.end ?: segment.start, to, to, transit = lands, moves = true))
    }
    val here = placeCountry(segment.destination ?: segment.origin, segment.type, lookup)
    val stay = segment.type == SegmentType.LODGING
    return listOfNotNull(Moment(segment.start, here, here, moves = stay), segment.end?.let { Moment(it, here, here, moves = stay) })
}

/**
 * The countries of each day of a trip, up to `today`: a day counts for every
 * country the traveler was in, so a travel day counts for both ends of the
 * journey, and a day in the air for neither. A day before anything says
 * where the traveler is has no country.
 */
/**
 * A trip's dates as reports count them: what its bookings still span once a
 * cancellation has taken some (a cancelled stay that stretched the trip, or
 * started it, counts for none of its dates), none when every booking is
 * cancelled or the trip is, and its own dates when none is (as planned,
 * bookings or not).
 */
fun reportBounds(trip: Trip, segments: List<Segment>): Pair<String, String>? = when {
    trip.cancelledAt != null -> null
    segments.any { it.isCancelled } -> segmentDateRange(segments)
    else -> trip.start to trip.end
}

/**
 * What a trip says about one of its days: the countries the traveler was in,
 * whether they spent all of it between countries (a flight across the date
 * line can skip a calendar day), and whether any booking has started to
 * place them yet (a trip dated before its first booking says nothing about
 * those days), and whether, with no country, nothing has yet taken them
 * anywhere: only outings that name no place so far, no journey or stay (a
 * trip that is a class or a show near home), so they are at home.
 */
/**
 * [night]: the country the traveler ends the day in (sleeps in), if any booking says; null in the
 * air or where nothing places them. [nightAt]: when the booking that left them there happened, so
 * another trip's later booking that day can say where the night was instead.
 */
data class TripDay(val countries: Set<String>, val inTransit: Boolean, val started: Boolean, val local: Boolean = false, val night: String? = null, val nightAt: String? = null)

fun tripDayPlaces(trip: Trip, segments: List<Segment>, today: String, lookup: (String) -> AirportPlace? = ::airportPlace): Map<String, TripDay> {
    val days = LinkedHashMap<String, TripDay>()
    val bounds = reportBounds(trip, segments) ?: return days
    val last = minOf(bounds.second, today)
    if (bounds.first > last) return days
    // In the order they happened, which across the date line is not the
    // order of their local dates: a flight can land the day before it left.
    val live = liveSegments(segments)
    val (lands, leaves) = connections(live, lookup)
    class TimedMoment(val m: Moment, val ms: Long, val date: String)
    val timeline = live.flatMap { moments(it, lookup, it in lands, it in leaves) }
        .map { TimedMoment(it, instantAt(it.at), localDate(it.at)) }
        .sortedBy { it.ms }

    // Bucket moments by local date while preserving their instant-order index,
    // so advancing a day at a time only touches moments on that date.
    val byDate = HashMap<String, MutableList<Int>>()
    var started = false
    var travelled = false
    var lastIdx = -1
    for (idx in timeline.indices) {
        val entry = timeline[idx]
        if (entry.date < bounds.first) {
            started = true
            if (entry.m.moves || entry.m.country != null) travelled = true
            if (entry.m.moves || entry.m.then != null) lastIdx = idx
        } else if (entry.date <= last) {
            byDate.getOrPut(entry.date) { mutableListOf() }.add(idx)
        }
    }

    val startEpoch = LocalDate.parse(bounds.first).toEpochDays()
    val endEpoch = LocalDate.parse(last).toEpochDays()
    for (d in startEpoch..endEpoch) {
        val day = LocalDate.fromEpochDays(d).toString()
        val prev = if (lastIdx >= 0) timeline[lastIdx].m else null
        val where = prev?.then
        val transit = prev?.transit ?: false
        val countries = mutableSetOf<String>()
        val onDay = byDate[day]
        if (onDay != null) {
            for (idx in onDay) {
                val m = timeline[idx].m
                started = true
                if (m.moves || m.country != null) travelled = true
                if ((m.moves || m.then != null) && idx > lastIdx) lastIdx = idx
                if (m.country != null) countries += m.country
            }
        }
        if (where != null) countries += where
        val inTransit = countries.isEmpty() && transit
        val endM = if (lastIdx >= 0) timeline[lastIdx].m else null
        val night = if (endM != null && !endM.transit) endM.then else null
        val nightAt = endM?.at
        days[day] = TripDay(countries, inTransit, started, local = countries.isEmpty() && !inTransit && !travelled, night = night, nightAt = nightAt)
    }
    return days
}

fun tripDays(trip: Trip, segments: List<Segment>, today: String, lookup: (String) -> AirportPlace? = ::airportPlace): Map<String, Set<String>> =
    tripDayPlaces(trip, segments, today, lookup).mapValues { it.value.countries }

/** [tripIds]: the trips with days there, latest first, for listing them. */
@Serializable
data class CountryReport(val country: String, val days: Int, val trips: Int, val tripIds: List<String> = emptyList())

@Serializable
data class YearReport(val year: String, val trips: Int, val days: Int, val countries: Int)

@Serializable
data class AirportVisit(val code: String, val country: String, val lat: Double, val lon: Double)

/** A place other than an airport whose booking says where it is. */
@Serializable
data class PlaceVisit(val name: String, val city: String?, val country: String?, val lat: Double, val lon: Double)

@Serializable
data class TravelReport(
    /** Trips begun by today, in the year asked for (or ever). */
    val trips: Int,
    /** Days away: days with any trip, each counted once however many overlap. */
    val days: Int,
    /** Most days first. */
    val countries: List<CountryReport>,
    /** Every year with a trip, latest first; not narrowed to the year asked for. */
    val years: List<YearReport>,
    /** Airports flown from or to, for the map. */
    val airports: List<AirportVisit>,
    /** Stays, stations and the rest with coordinates, for the map, one per spot. */
    val places: List<PlaceVisit>,
    /** Trip days whose country no booking says. */
    val unknownDays: Int,
    /** Bookings whose places no country could be found for. */
    val unplaced: Int,
    /** Trips still ahead, not counted in anything else. */
    val upcoming: Int,
)

data class TripWithSegments(val trip: Trip, val segments: List<Segment>)

/** Two bookings within about a hundred meters are one spot on the map: the same hotel named two ways is one dot, under the first name. */
private fun spot(lat: Double, lon: Double) = "${fixed3(lat)},${fixed3(lon)}"

fun travelReport(all: List<TripWithSegments>, today: String, year: String? = null, lookup: (String) -> AirportPlace? = ::airportPlace): TravelReport {
    fun inYear(date: String) = year == null || date.startsWith(year)
    val dayCountries = LinkedHashMap<String, MutableSet<String>>()
    // Days between countries all day (changing planes), which are known.
    val transitDays = mutableSetOf<String>()
    val countryTrips = HashMap<String, MutableSet<String>>()
    val yearDays = HashMap<String, LinkedHashMap<String, MutableSet<String>>>()
    val yearTrips = HashMap<String, Int>()
    val airports = HashMap<String, AirportVisit>()
    val places = LinkedHashMap<String, PlaceVisit>()
    val tripStart = HashMap<String, String>()
    var trips = 0
    var unplaced = 0
    var upcoming = 0

    // The same trip listed twice (owned and shared) counts once.
    for ((trip, segments) in all.associateBy { it.trip.id }.values) {
        // Ahead, done, and in which year, by what it still books; not
        // happening at all when nothing is.
        val bounds = reportBounds(trip, segments) ?: continue
        if (bounds.first > today) {
            upcoming += 1
            continue
        }
        tripStart[trip.id] = bounds.first
        val startYear = bounds.first.substring(0, 4)
        yearTrips[startYear] = (yearTrips[startYear] ?: 0) + 1
        if (inYear(bounds.first)) trips += 1

        for ((day, place) in tripDayPlaces(trip, segments, today, lookup)) {
            val countries = place.countries
            if (place.inTransit && inYear(day)) transitDays += day
            val y = day.substring(0, 4)
            yearDays.getOrPut(y) { LinkedHashMap() }.getOrPut(day) { mutableSetOf() } += countries
            if (!inYear(day)) continue
            dayCountries.getOrPut(day) { mutableSetOf() } += countries
            for (c in countries) countryTrips.getOrPut(c) { mutableSetOf() } += trip.id
        }

        for (s in liveSegments(segments)) {
            fun counted(date: String) = date <= today && inYear(date)
            if (counted(localDate(s.start))) {
                val ends = listOfNotNull(s.origin, s.destination)
                if (ends.all { placeCountry(it, s.type, lookup) == null }) unplaced += 1
            }
            // Each place on the dates the traveler was there: a journey's ends on
            // the dates it left and arrived (a flight over New Year lands in the
            // next year's map), a stay's place on every day of the stay.
            fun occupied(from: String, to: String) = from <= today && (year == null || (from.substring(0, 4) <= year && year <= minOf(to, today).substring(0, 4)))
            val ends: List<Pair<Place?, Boolean>> = if (s.type in transport) {
                listOf(s.origin to counted(localDate(s.start)), s.destination to counted(localDate(s.end ?: s.start)))
            } else {
                listOf((s.destination ?: s.origin) to occupied(localDate(s.start), localDate(s.end ?: s.start)))
            }
            for ((p, there) in ends) {
                if (p == null || !there) continue
                val found = if (s.type == SegmentType.FLIGHT && p.code != null) lookup(p.code) else null
                if (found != null && p.code != null) {
                    val code = p.code.uppercase()
                    airports[code] = AirportVisit(code, found.country, found.lat, found.lon)
                } else if (p.lat != null && p.lon != null) {
                    places.getOrPut(spot(p.lat, p.lon)) { PlaceVisit(p.name, p.city, p.country?.uppercase(), p.lat, p.lon) }
                }
            }
        }
    }

    val daysIn = HashMap<String, Int>()
    var unknownDays = 0
    for ((day, countries) in dayCountries) {
        if (countries.isEmpty() && day !in transitDays) unknownDays += 1
        for (c in countries) daysIn[c] = (daysIn[c] ?: 0) + 1
    }

    val years = (yearTrips.keys + yearDays.keys).sortedDescending().map { y ->
        val days = yearDays[y].orEmpty()
        YearReport(y, yearTrips[y] ?: 0, days.size, days.values.flatten().toSet().size)
    }

    return TravelReport(
        trips = trips,
        days = dayCountries.size,
        countries = daysIn.map { (country, days) ->
            val ids = countryTrips[country].orEmpty().sortedWith(compareByDescending<String> { tripStart[it].orEmpty() }.thenBy { it })
            CountryReport(country, days, ids.size, ids)
        }
            .sortedWith(compareByDescending<CountryReport> { it.days }.thenBy { it.country }),
        years = years,
        airports = airports.values.sortedBy { it.code },
        places = places.values.sortedWith(compareBy<PlaceVisit> { it.name }.thenBy { it.lat }.thenBy { it.lon }),
        unknownDays = unknownDays,
        unplaced = unplaced,
        upcoming = upcoming,
    )
}

/**
 * Reports' counts and map for every year as last worked out, kept on the phone so the next visit
 * draws them at once, before the bookings have answered (SPEC "Reports"); [uid] says whose they are.
 */
@Serializable
data class ReportSnapshot(val uid: String, val report: TravelReport)
