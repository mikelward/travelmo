package app.travelmo.core

// Mirrors packages/core/src/landmarks.ts: a trip's picture in the trip list,
// an outline of the best-known landmark of the city its title names, drawn
// in a 48-unit square as one SVG path for a 1.5-unit round-capped stroke
// (packages/core/src/landmarks.json, compiled in). A title naming no city
// with a landmark gets the suitcase.

data class Landmark(
    val id: String,
    /** What it shows, for whoever maintains the drawings. */
    val name: String,
    /** The city names it stands for, folded ([foldText]). */
    val cities: List<String>,
    val d: String,
)

private val landmarkEntry = Regex(""""id":"([^"]+)","name":"([^"]*)","cities":\[([^\]]*)],"d":"([^"]+)"""")

val landmarks: List<Landmark> by lazy {
    landmarkEntry.findAll(landmarksJson).map { m ->
        val cities = Regex(""""([^"]+)"""").findAll(m.groupValues[3]).map { it.groupValues[1] }.toList()
        Landmark(m.groupValues[1], m.groupValues[2], cities, m.groupValues[4])
    }.toList().also { check(it.any { l -> l.id == "trip" }) { "landmarks.json has no suitcase" } }
}

/**
 * The landmark of the city named first in [title] ("Paris and Lyon" is Paris), else the suitcase.
 * Names match as whole words, accents and case ignored, so "Lisboa" is Lisbon and "Parisian" is nobody.
 */
fun tripLandmark(title: String): Landmark {
    val words = " ${foldText(title)} "
    var best: Pair<Int, Landmark>? = null
    for (landmark in landmarks) {
        for (city in landmark.cities) {
            val at = words.indexOf(" $city ")
            if (at >= 0 && (best == null || at < best.first)) best = at to landmark
        }
    }
    return best?.second ?: landmarks.first { it.id == "trip" }
}
