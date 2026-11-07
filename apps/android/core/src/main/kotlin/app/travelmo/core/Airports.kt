package app.travelmo.core

// IATA airport code to IANA time zone, from the web's generated table
// (packages/core/src/airports.json, bundled as a resource by core/build.gradle.kts).
// Read once, on first use: only the booking form asks.
private val airportZones: Map<String, String> by lazy {
    val text = object {}.javaClass.getResourceAsStream("/airports.json")?.bufferedReader()?.readText()
        ?: error("airports.json is missing from the core resources")
    Regex(""""([A-Z0-9]{3})":\s*"([^"]+)"""").findAll(text).associate { it.groupValues[1] to it.groupValues[2] }
}

fun airportZone(code: String): String? {
    val key = code.trim().uppercase()
    return if (Regex("^[A-Z]{3}$").matches(key)) airportZones[key] else null
}
