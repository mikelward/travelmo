package app.travelmo.core

// The web's world map (apps/web/src/lib/worldMap.json, drawn by its
// worldmap script from Natural Earth in the Equal Earth projection),
// compiled in: each country's outline as rings of points in map units,
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

/** The rings of an SVG path made only of M, L and Z, as the map's are. */
fun parseRings(path: String): List<List<Pair<Float, Float>>> {
    val rings = mutableListOf<MutableList<Pair<Float, Float>>>()
    var i = 0
    val len = path.length
    fun skipSpaces() {
        while (i < len && path[i] <= ' ') i++
    }
    fun readFloat(): Float {
        skipSpaces()
        val start = i
        if (i < len && path[i] == '-') i++
        while (i < len && (path[i] in '0'..'9' || path[i] == '.')) i++
        return path.substring(start, i).toFloat()
    }
    while (i < len) {
        val c = path[i]
        when (c) {
            'M' -> {
                i++
                val x = readFloat()
                val y = readFloat()
                rings += mutableListOf(x to y)
            }
            'L' -> {
                i++
                val x = readFloat()
                val y = readFloat()
                rings.last() += x to y
            }
            else -> i++
        }
    }
    return rings
}

val worldMap: WorldMapData by lazy {
    val text = worldMapJson
    val scaleAt = text.indexOf("\"scale\":")
    if (scaleAt < 0) error("worldMap.json has no scale")
    val scaleEnd = text.indexOf(',', scaleAt + 8)
    val scale = text.substring(scaleAt + 8, scaleEnd).trim().toDouble()
    val vbAt = text.indexOf("\"viewBox\":")
    if (vbAt < 0) error("worldMap.json has no viewBox")
    val vbStart = text.indexOf('[', vbAt)
    val vbEnd = text.indexOf(']', vbStart)
    val viewBox = text.substring(vbStart + 1, vbEnd).split(',').map { it.trim().toDouble() }
    val countriesStart = text.indexOf("\"countries\":")
    val countries = mutableListOf<CountryOutline>()
    var pos = if (countriesStart >= 0) text.indexOf('{', countriesStart) + 1 else 0
    val len = text.length
    while (pos < len) {
        val nl = text.indexOf('\n', pos).let { if (it < 0) len else it }
        val q1 = text.indexOf('"', pos)
        if (q1 in pos until nl) {
            val q2 = text.indexOf('"', q1 + 1)
            val q3 = if (q2 in (q1 + 1) until nl) text.indexOf('"', q2 + 1) else -1
            val q4 = if (q3 in (q2 + 1) until nl) text.indexOf('"', q3 + 1) else -1
            if (q2 - q1 == 3 && q4 in (q3 + 1) until nl) {
                countries += CountryOutline(text.substring(q1 + 1, q2), parseRings(text.substring(q3 + 1, q4)))
            }
        }
        pos = nl + 1
    }
    WorldMapData(scale, viewBox, countries)
}
