package app.travelmo.core

// The web's world map (apps/web/src/lib/worldMap.json, drawn by its
// worldmap script from Natural Earth in the Equal Earth projection), read
// as a resource: each country's outline as rings of points in map units,
// with the scale that places a projected spot on it and the box it fills.

/** One country's outline: rings, each a closed run of (x, y) map points. */
data class CountryOutline(val code: String, val rings: List<List<Pair<Float, Float>>>)

data class WorldMapData(
    /** Map units per Earth radius. */
    val scale: Double,
    /** Left, top, width, height of the drawn area, in map units. */
    val viewBox: List<Double>,
    val countries: List<CountryOutline>,
) {
    /** Where a longitude and latitude fall on the map. */
    fun project(lon: Double, lat: Double): Pair<Float, Float> {
        val (x, y) = equalEarth(lon, lat)
        return (x * scale).toFloat() to (y * scale).toFloat()
    }
}

private val pathPoint = Regex("""([MLZ])\s*(-?\d+(?:\.\d+)?)?\s*(-?\d+(?:\.\d+)?)?""")

/** The rings of an SVG path made only of M, L and Z, as the map's are. */
fun parseRings(path: String): List<List<Pair<Float, Float>>> {
    val rings = mutableListOf<MutableList<Pair<Float, Float>>>()
    for (m in pathPoint.findAll(path)) {
        when (m.groupValues[1]) {
            "M" -> rings += mutableListOf(m.groupValues[2].toFloat() to m.groupValues[3].toFloat())
            "L" -> rings.last() += m.groupValues[2].toFloat() to m.groupValues[3].toFloat()
            "Z" -> {}
        }
    }
    return rings
}

val worldMap: WorldMapData by lazy {
    val text = object {}.javaClass.getResourceAsStream("/worldMap.json")?.bufferedReader()?.readText()
        ?: error("worldMap.json is missing from the core resources")
    val scale = Regex(""""scale":\s*(-?[\d.]+)""").find(text)?.groupValues?.get(1)?.toDouble() ?: error("worldMap.json has no scale")
    val viewBox = Regex(""""viewBox":\s*\[([^\]]*)]""").find(text)?.groupValues?.get(1)?.split(",")?.map { it.trim().toDouble() }
        ?: error("worldMap.json has no viewBox")
    val countries = Regex(""""([A-Z]{2})":\s*"([MLZ\d\s.-]+)"""").findAll(text).map { CountryOutline(it.groupValues[1], parseRings(it.groupValues[2])) }.toList()
    WorldMapData(scale, viewBox, countries)
}
