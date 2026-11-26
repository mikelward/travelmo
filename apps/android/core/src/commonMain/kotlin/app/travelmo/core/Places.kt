package app.travelmo.core

// Where a booking is, as packages/core/src/reports.ts works it out: a place
// is known by the country its booking names, or for a flight by its airport
// code, from the web's generated airportPlaces.json, compiled in.

/** An airport's country, point and the city it serves ("Stockholm" for ARN), when the table names one. */
data class AirportPlace(val country: String, val lat: Double, val lon: Double, val city: String? = null)

private val airportPlaces: Map<String, AirportPlace> by lazy {
    val text = airportPlacesJson
    Regex(""""([A-Z0-9]{3})":\s*\[\s*"([A-Z]{2})"\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*(?:,\s*"((?:[^"\\]|\\.)*)"\s*)?]""").findAll(text)
        .associate {
            val city = it.groupValues[5].takeIf { c -> c.isNotEmpty() }?.let(::unescapeJson)
            it.groupValues[1] to AirportPlace(it.groupValues[2], it.groupValues[3].toDouble(), it.groupValues[4].toDouble(), city)
        }
}

// A JSON string's text, its escapes undone ("\u00f6" is ö).
private fun unescapeJson(text: String): String = Regex("""\\(u[0-9a-fA-F]{4}|.)""").replace(text) { m ->
    val e = m.groupValues[1]
    when {
        e.startsWith("u") && e.length == 5 -> e.substring(1).toInt(16).toChar().toString()
        e == "n" -> "\n"
        e == "t" -> "\t"
        else -> e
    }
}

fun airportPlace(code: String): AirportPlace? {
    val key = code.trim().uppercase()
    return if (Regex("^[A-Z]{3}$").matches(key)) airportPlaces[key] else null
}

/** The country a place is in, if its booking or its airport says. Station codes are not airport codes. */
fun placeCountry(place: Place?, type: SegmentType, lookup: (String) -> AirportPlace? = ::airportPlace): String? {
    if (place == null) return null
    if (place.country != null) return place.country.uppercase()
    return if (type == SegmentType.FLIGHT && place.code != null) lookup(place.code)?.country else null
}

private val transport = setOf(SegmentType.FLIGHT, SegmentType.TRAIN, SegmentType.BUS, SegmentType.FERRY, SegmentType.CAR_RENTAL)

/** The countries a trip's bookings are in, and whether every booking's place is known, so the set is whole. */
data class TripPlaces(val countries: Set<String>, val complete: Boolean)

fun tripPlaces(segments: List<Segment>, lookup: (String) -> AirportPlace? = ::airportPlace): TripPlaces {
    val countries = mutableSetOf<String>()
    val live = liveSegments(segments)
    var complete = live.isNotEmpty()
    for (s in live) {
        val places = listOfNotNull(s.origin, s.destination)
        // A journey with an end missing went somewhere unknown; a stay or activity has one place.
        if (places.isEmpty() || (s.type in transport && places.size < 2)) complete = false
        for (p in places) {
            val c = placeCountry(p, s.type, lookup)
            if (c != null) countries += c else complete = false
        }
    }
    return TripPlaces(countries, complete)
}
