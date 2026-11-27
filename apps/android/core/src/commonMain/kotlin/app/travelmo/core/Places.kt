package app.travelmo.core

// Where a booking is, as packages/core/src/reports.ts works it out: a place
// is known by the country its booking names, or for a flight by its airport
// code, from the web's generated airportPlaces.json, compiled in.

/** An airport's country, point and the city it serves ("Stockholm" for ARN), when the table names one. */
data class AirportPlace(val country: String, val lat: Double, val lon: Double, val city: String? = null)

private val airportPlaces: Map<String, AirportPlace> by lazy {
    val text = airportPlacesJson
    val map = HashMap<String, AirportPlace>(10_000)
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
                val code = text.substring(q1 + 1, q2)
                val c1 = text.indexOf('"', lb + 1)
                val c2 = if (c1 in (lb + 1) until rb) text.indexOf('"', c1 + 1) else -1
                val comma1 = if (c2 in (c1 + 1) until rb) text.indexOf(',', c2 + 1) else -1
                val comma2 = if (comma1 in (c2 + 1) until rb) text.indexOf(',', comma1 + 1) else -1
                if (comma2 > comma1 && comma1 > c2) {
                    val country = text.substring(c1 + 1, c2)
                    val comma3 = text.indexOf(',', comma2 + 1).takeIf { it in (comma2 + 1) until rb }
                    val lat = text.substring(comma1 + 1, comma2).trim().toDouble()
                    val lon = text.substring(comma2 + 1, comma3 ?: rb).trim().toDouble()
                    val city = if (comma3 != null) {
                        val s1 = text.indexOf('"', comma3 + 1)
                        val s2 = text.lastIndexOf('"', rb - 1)
                        if (s1 in (comma3 + 1) until s2) unescapeJson(text.substring(s1 + 1, s2)).takeIf { it.isNotEmpty() } else null
                    } else null
                    map[code] = AirportPlace(country, lat, lon, city)
                }
            }
        }
        pos = nl + 1
    }
    map
}

// A JSON string's text, its escapes undone ("\u00f6" is ö).
private fun unescapeJson(text: String): String {
    if ('\\' !in text) return text
    val out = StringBuilder(text.length)
    var i = 0
    while (i < text.length) {
        val c = text[i]
        if (c == '\\' && i + 1 < text.length) {
            val next = text[i + 1]
            if (next == 'u' && i + 5 < text.length) {
                out.append(text.substring(i + 2, i + 6).toInt(16).toChar())
                i += 6
            } else {
                out.append(when (next) {
                    'n' -> '\n'
                    't' -> '\t'
                    else -> next
                })
                i += 2
            }
        } else {
            out.append(c)
            i++
        }
    }
    return out.toString()
}

internal fun isIataCode(key: String): Boolean =
    key.length == 3 && key[0] in 'A'..'Z' && key[1] in 'A'..'Z' && key[2] in 'A'..'Z'

fun airportPlace(code: String): AirportPlace? {
    val key = code.trim().uppercase()
    return if (isIataCode(key)) airportPlaces[key] else null
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
