package app.travelmo.core

import java.time.LocalDate

// Where the user has been, worked out from their trips' bookings alone, as
// packages/core/src/reports.ts: a place is known by the country its booking
// names, or for a flight by its airport code, and sits on the map where its
// booking says it is.

private val transport = setOf(SegmentType.FLIGHT, SegmentType.TRAIN, SegmentType.BUS, SegmentType.FERRY, SegmentType.CAR_RENTAL)

/** A moment the traveler is known to be somewhere: the country counts for that day, and `then` is where they are afterwards. */
private data class Moment(val at: String, val country: String?, val then: String?)

private fun moments(segment: Segment, lookup: (String) -> AirportPlace?): List<Moment> {
    if (segment.type in transport) {
        val from = placeCountry(segment.origin, segment.type, lookup)
        val to = placeCountry(segment.destination, segment.type, lookup)
        // A car is driven from place to place in between; a flight is in the air.
        val during = if (segment.type == SegmentType.CAR_RENTAL && from == to) from else null
        return listOf(Moment(segment.start, from, during), Moment(segment.end ?: segment.start, to, to))
    }
    val here = placeCountry(segment.destination ?: segment.origin, segment.type, lookup)
    return listOfNotNull(Moment(segment.start, here, here), segment.end?.let { Moment(it, here, here) })
}

private fun nextDay(date: String): String = LocalDate.parse(date).plusDays(1).toString()

/**
 * The countries of each day of a trip, up to `today`: a day counts for every
 * country the traveler was in, so a travel day counts for both ends of the
 * journey, and a day in the air for neither. A day before anything says
 * where the traveler is has no country.
 */
fun tripDays(trip: Trip, segments: List<Segment>, today: String, lookup: (String) -> AirportPlace? = ::airportPlace): Map<String, Set<String>> {
    // In the order they happened, which across the date line is not the
    // order of their local dates: a flight can land the day before it left.
    val timeline = segments.flatMap { moments(it, lookup) }.sortedWith { a, b -> compareInstants(a.at, b.at) }
    val days = LinkedHashMap<String, Set<String>>()
    val last = minOf(trip.end, today)
    var day = trip.start
    while (day <= last) {
        // Where the traveler was as the day began: left by the latest moment dated before it.
        var where: String? = null
        val countries = mutableSetOf<String>()
        for (m in timeline) {
            val date = localDate(m.at)
            if (date < day) where = m.then else if (date == day && m.country != null) countries += m.country
        }
        if (where != null) countries += where
        days[day] = countries
        day = nextDay(day)
    }
    return days
}

data class CountryReport(val country: String, val days: Int, val trips: Int)

data class YearReport(val year: String, val trips: Int, val days: Int, val countries: Int)

data class AirportVisit(val code: String, val country: String, val lat: Double, val lon: Double)

/** A place other than an airport whose booking says where it is. */
data class PlaceVisit(val name: String, val city: String?, val country: String?, val lat: Double, val lon: Double)

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
private fun spot(lat: Double, lon: Double) = "%.3f,%.3f".format(java.util.Locale.ROOT, lat, lon)

fun travelReport(all: List<TripWithSegments>, today: String, year: String? = null, lookup: (String) -> AirportPlace? = ::airportPlace): TravelReport {
    fun inYear(date: String) = year == null || date.startsWith(year)
    val dayCountries = LinkedHashMap<String, MutableSet<String>>()
    val countryTrips = HashMap<String, MutableSet<String>>()
    val yearDays = HashMap<String, LinkedHashMap<String, MutableSet<String>>>()
    val yearTrips = HashMap<String, Int>()
    val airports = HashMap<String, AirportVisit>()
    val places = LinkedHashMap<String, PlaceVisit>()
    var trips = 0
    var unplaced = 0
    var upcoming = 0

    // The same trip listed twice (owned and shared) counts once.
    for ((trip, segments) in all.associateBy { it.trip.id }.values) {
        if (trip.start > today) {
            upcoming += 1
            continue
        }
        val startYear = trip.start.substring(0, 4)
        yearTrips[startYear] = (yearTrips[startYear] ?: 0) + 1
        if (inYear(trip.start)) trips += 1

        for ((day, countries) in tripDays(trip, segments, today, lookup)) {
            val y = day.substring(0, 4)
            yearDays.getOrPut(y) { LinkedHashMap() }.getOrPut(day) { mutableSetOf() } += countries
            if (!inYear(day)) continue
            dayCountries.getOrPut(day) { mutableSetOf() } += countries
            for (c in countries) countryTrips.getOrPut(c) { mutableSetOf() } += trip.id
        }

        for (s in segments) {
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
                    places.putIfAbsent(spot(p.lat, p.lon), PlaceVisit(p.name, p.city, p.country?.uppercase(), p.lat, p.lon))
                }
            }
        }
    }

    val daysIn = HashMap<String, Int>()
    var unknownDays = 0
    for (countries in dayCountries.values) {
        if (countries.isEmpty()) unknownDays += 1
        for (c in countries) daysIn[c] = (daysIn[c] ?: 0) + 1
    }

    val years = (yearTrips.keys + yearDays.keys).sortedDescending().map { y ->
        val days = yearDays[y].orEmpty()
        YearReport(y, yearTrips[y] ?: 0, days.size, days.values.flatten().toSet().size)
    }

    return TravelReport(
        trips = trips,
        days = dayCountries.size,
        countries = daysIn.map { (country, days) -> CountryReport(country, days, countryTrips[country]?.size ?: 0) }
            .sortedWith(compareByDescending<CountryReport> { it.days }.thenBy { it.country }),
        years = years,
        airports = airports.values.sortedBy { it.code },
        places = places.values.sortedWith(compareBy<PlaceVisit> { it.name }.thenBy { it.lat }.thenBy { it.lon }),
        unknownDays = unknownDays,
        unplaced = unplaced,
        upcoming = upcoming,
    )
}
