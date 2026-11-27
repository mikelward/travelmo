package app.travelmo.core

// IATA airport code to IANA time zone, from the web's generated table
// (packages/core/src/airports.json, compiled in by core/build.gradle.kts).
// Read once, on first use: only the booking form asks.
private val airportZones: Map<String, String> by lazy {
    val text = airportsJson
    val map = HashMap<String, String>(10_000)
    var pos = 0
    val len = text.length
    while (pos < len) {
        val nl = text.indexOf('\n', pos).let { if (it < 0) len else it }
        val q1 = text.indexOf('"', pos)
        if (q1 in pos until nl) {
            val q2 = text.indexOf('"', q1 + 1)
            val q3 = if (q2 in (q1 + 1) until nl) text.indexOf('"', q2 + 1) else -1
            val q4 = if (q3 in (q2 + 1) until nl) text.indexOf('"', q3 + 1) else -1
            if (q4 in (q3 + 1) until nl) map[text.substring(q1 + 1, q2)] = text.substring(q3 + 1, q4)
        }
        pos = nl + 1
    }
    map
}

fun airportZone(code: String): String? {
    val key = code.trim().uppercase()
    return if (isIataCode(key)) airportZones[key] else null
}
