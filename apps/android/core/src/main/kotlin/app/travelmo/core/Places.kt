package app.travelmo.core

// Where a booking is, as packages/core/src/reports.ts works it out: a place
// is known by the country its booking names, or for a flight by its airport
// code, from the web's generated airportPlaces.json read as a resource.

data class AirportPlace(val country: String, val lat: Double, val lon: Double)

private val airportPlaces: Map<String, AirportPlace> by lazy {
    val text = object {}.javaClass.getResourceAsStream("/airportPlaces.json")?.bufferedReader()?.readText()
        ?: error("airportPlaces.json is missing from the core resources")
    Regex(""""([A-Z0-9]{3})":\s*\[\s*"([A-Z]{2})"\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*]""").findAll(text)
        .associate { it.groupValues[1] to AirportPlace(it.groupValues[2], it.groupValues[3].toDouble(), it.groupValues[4].toDouble()) }
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
    var complete = segments.isNotEmpty()
    for (s in segments) {
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
