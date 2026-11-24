package app.travelmo.core

// A summary of where the user has been, to download from Reports as CSV for
// visa and settlement forms, as packages/core's tripsExport.ts: one row per
// trip, or one per place stayed in, from the journeys, stays and cars alone.

private val exportJourneys = setOf(SegmentType.FLIGHT, SegmentType.TRAIN, SegmentType.BUS, SegmentType.FERRY)
private val exportCounted = exportJourneys + setOf(SegmentType.LODGING, SegmentType.CAR_RENTAL)

// A journey's end is its arrival; one that ends at 23:59 on a later day, or
// more than eight days on, is a ticket's validity, as trips.ts's withoutValidityEnds.
private fun arrival(s: Segment): String {
    val end = s.end ?: return s.start
    val days = daysBetween(localDate(s.start), localDate(end))
    return if (days > 8 || (days >= 1 && end.length >= 16 && end.substring(11, 16) == "23:59")) s.start else end
}

private data class Stop(val at: String, val date: String, val place: Place, val type: SegmentType, val until: String? = null)

// Where a trip took someone, in order: where each journey arrives, and each
// stay and car's place, never where a journey leaves from.
private fun stops(segments: List<Segment>): List<Stop> = liveSegments(segments)
    .filter { it.type in exportCounted }
    .mapNotNull { s ->
        if (s.type in exportJourneys) {
            val at = arrival(s)
            s.destination?.let { Stop(at, localDate(at), it, s.type) }
        } else {
            val place = if (s.type == SegmentType.CAR_RENTAL) s.origin ?: s.destination else s.destination ?: s.origin
            place?.let { Stop(s.start, localDate(s.start), it, s.type, s.end?.let(::localDate)) }
        }
    }
    .sortedWith { a, b -> compareInstants(a.at, b.at) }

private fun cityOf(place: Place) = (place.city ?: place.name).trim()

private fun countryOf(stop: Stop, lookup: (String) -> AirportPlace?): String? = placeCountry(stop.place, stop.type, lookup)?.let(::countryCode)

private fun englishName(code: String) = displayCountry(code, "en").ifEmpty { code }

// A trip's stops, each with its country: its own, its airport's, or failing those another booking's on the trip for the same town.
private fun located(segments: List<Segment>, lookup: (String) -> AirportPlace?): List<Pair<Stop, String?>> {
    val all = stops(segments).map { it to countryOf(it, lookup) }
    return all.map { (s, c) -> s to (c ?: all.firstOrNull { (o, oc) -> oc != null && sameCity(cityOf(o.place), cityOf(s.place)) }?.second) }
}

// Whether a stop is in the home town of its day, judged with its country
// as worked out (an airport's), so London, Canada is not London, UK.
private fun atHome(place: Place, country: String?, date: String, periods: List<HomePeriod>) =
    inHomeTown(if (country != null) place.copy(country = country) else place, date, periods)

private fun abroad(country: String?, date: String, periods: List<HomePeriod>): Boolean {
    val home = homeAt(periods, date)?.country
    // With home's country unknown, nothing can be left out as domestic.
    return home == null || country == null || country != countryCode(home)
}

// The trips to list: begun by [until] and not cancelled, wholly or by its owner.
private fun taken(trips: List<TripWithSegments>, until: String) =
    trips.filter { (trip, segments) -> displayBounds(trip).first <= until && !tripCancelled(trip, segments) }

// One town, not two of a name in different countries.
private fun sameStop(a: Place, aCountry: String?, b: Place, bCountry: String?) =
    sameCity(cityOf(a), cityOf(b)) && (aCountry == null || bCountry == null || aCountry == bCountry)

data class TripRow(val trip: String, val start: String, val end: String, val cities: List<String>, val countries: List<String>)

/** One row per trip, oldest first: its dates and the towns and countries it went to, home left out. */
fun tripRows(
    trips: List<TripWithSegments>,
    periods: List<HomePeriod>,
    until: String,
    international: Boolean = false,
    titles: Map<String, String> = emptyMap(),
    lookup: (String) -> AirportPlace? = ::airportPlace,
): List<TripRow> = taken(trips, until).mapNotNull { (trip, segments) ->
    val (start, end) = displayBounds(trip)
    val located = located(segments, lookup).filter { (s, c) -> !atHome(s.place, c, s.date, periods) }
    val away = located.map { it.first }
    // A trip of nothing but events and tickets, or only at home, went nowhere to list.
    if (away.isEmpty()) return@mapNotNull null
    val countries = located.map { it.second }
    // Each place against the home of its own day: home may change mid-trip.
    if (international && away.indices.none { abroad(countries[it], away[it].date, periods) }) return@mapNotNull null
    TripRow(titles[trip.id] ?: trip.title, start, end, away.map { cityOf(it.place) }.filter { it.isNotEmpty() }.distinct(), countries.filterNotNull().map(::englishName).distinct())
}.sortedBy { it.start }

data class PlaceRow(val city: String, val country: String, val start: String, val end: String, val trip: String)

private class Visit(val stop: Stop, var country: String?, val start: String, var until: String?, var home: Boolean)

/** One row per place stayed in, oldest first: from the day someone got there until they moved on, as tripsExport.ts. */
fun placeRows(
    trips: List<TripWithSegments>,
    periods: List<HomePeriod>,
    until: String,
    international: Boolean = false,
    titles: Map<String, String> = emptyMap(),
    lookup: (String) -> AirportPlace? = ::airportPlace,
): List<PlaceRow> {
    val rows = mutableListOf<PlaceRow>()
    for ((trip, segments) in taken(trips, until)) {
        val tripEnd = displayBounds(trip).second
        val title = titles[trip.id] ?: trip.title
        val visits = mutableListOf<Visit>()
        for ((stop, country) in located(segments, lookup)) {
            val last = visits.lastOrNull()
            if (last != null && sameStop(last.stop.place, last.country, stop.place, country)) {
                if (stop.until != null && (last.until == null || stop.until > last.until!!)) last.until = stop.until
                // A later booking may say the country an earlier one left out, which can show the place is not home after all.
                if (last.country == null && country != null) {
                    last.country = country
                    last.home = atHome(last.stop.place, country, last.start, periods)
                }
                continue
            }
            visits += Visit(stop, country, stop.date, stop.until, atHome(stop.place, country, stop.date, periods))
        }
        visits.forEachIndexed { i, v ->
            if (v.home) return@forEachIndexed
            if (international && !abroad(v.country, v.start, periods)) return@forEachIndexed
            val next = visits.getOrNull(i + 1)
            val end = next?.start ?: listOfNotNull(v.until, tripEnd).max()
            rows += PlaceRow(cityOf(v.stop.place), v.country?.let(::englishName).orEmpty(), v.start, if (end < v.start) v.start else end, title)
        }
    }
    return rows.sortedBy { it.start }
}

// A field as RFC 4180 writes it: quoted when it holds a comma, a quote or a line break, with its quotes doubled.
// A spreadsheet would run a field starting =, +, -, @ or a tab as a formula, so such a field starts with an apostrophe instead.
private fun csvField(raw: String): String {
    val value = if (raw.isNotEmpty() && raw[0] in "=+-@\t\r") "'$raw" else raw
    return if (value.any { it == ',' || it == '"' || it == '\r' || it == '\n' }) "\"${value.replace("\"", "\"\"")}\"" else value
}

private fun csv(rows: List<List<String>>): String = rows.joinToString("") { row -> row.joinToString(",") { csvField(it) } + "\r\n" }

fun tripRowsCsv(rows: List<TripRow>): String =
    csv(listOf(listOf("Trip", "Start", "End", "Cities", "Countries")) + rows.map { listOf(it.trip, it.start, it.end, it.cities.joinToString("; "), it.countries.joinToString("; ")) })

fun placeRowsCsv(rows: List<PlaceRow>): String =
    csv(listOf(listOf("City", "Country", "Start", "End", "Trip")) + rows.map { listOf(it.city, it.country, it.start, it.end, it.trip) })
