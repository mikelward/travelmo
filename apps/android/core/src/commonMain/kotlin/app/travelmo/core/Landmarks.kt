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
    /**
     * Names that are also everyday words ("Nice", "Bath"), accents dropped: they count only written with a capital
     * and not opening the title, unless the title is the name alone or punctuation follows it ("Nice, France"),
     * so "Nice weekend" and "Bath time" are nobody.
     */
    val capitalized: List<String> = emptyList(),
    /** Longer names, folded, that a match of [cities] is not when it begins one: "santiago de compostela" is not Santiago. */
    val not: List<String> = emptyList(),
)

private val landmarkEntry = Regex(
    """"id":"([^"]+)","name":"([^"]*)","cities":\[([^\]]*)](?:,"capitalized":\[([^\]]*)])?(?:,"not":\[([^\]]*)])?,"d":"([^"]+)"""",
)
private val quoted = Regex(""""([^"]+)"""")

val landmarks: List<Landmark> by lazy {
    landmarkEntry.findAll(landmarksJson).map { m ->
        fun list(group: Int) = quoted.findAll(m.groupValues[group]).map { it.groupValues[1] }.toList()
        Landmark(m.groupValues[1], m.groupValues[2], list(3), m.groupValues[6], capitalized = list(4), not = list(5))
    }.toList().also { check(it.any { l -> l.id == "trip" }) { "landmarks.json has no suitcase" } }
}

private val marks = Regex("\\p{M}+")
private val notLetters = Regex("[^\\p{L}\\p{N}]+")
private val punctuationNext = Regex("^\\s*[,;:(/\\-–—]")

/** Where ` name ` first occurs in [text] at a place [ok] accepts, else -1. */
private fun firstAt(text: String, name: String, ok: (Int) -> Boolean): Int {
    var at = text.indexOf(" $name ")
    while (at >= 0) {
        if (ok(at)) return at
        at = text.indexOf(" $name ", at + 1)
    }
    return -1
}

/**
 * The landmark of the city named first in [title] ("Paris and Lyon" is Paris), else the suitcase.
 * Names match as whole words, accents and case ignored, so "Lisboa" is Lisbon and "Parisian" is nobody;
 * a capitalized name keeps its case.
 */
fun tripLandmark(title: String): Landmark {
    val plain = decomposed(title).replace(marks, "").trim()
    // Folded as foldText does, case kept and then not.
    val kept = " ${plain.replace(notLetters, " ").trim()} "
    val words = kept.lowercase()
    fun opensTitle(name: String) = plain == name || punctuationNext.containsMatchIn(plain.drop(name.length))
    var best: Pair<Int, Landmark>? = null
    fun consider(at: Int, landmark: Landmark) {
        if (at >= 0 && (best == null || at < best!!.first)) best = at to landmark
    }
    for (landmark in landmarks) {
        for (city in landmark.cities) {
            consider(firstAt(words, city) { at -> landmark.not.none { words.startsWith(" $it ", at) } }, landmark)
        }
        for (name in landmark.capitalized) consider(firstAt(kept, name) { at -> at > 0 || opensTitle(name) }, landmark)
    }
    return best?.second ?: landmarks.first { it.id == "trip" }
}

/**
 * Parses the tables the trip list reads (the landmarks, and the airports a missing journey is told by), each read on
 * first use: a few hundred milliseconds on a phone, so the app calls this off the main thread before the list draws.
 */
fun warmTables() {
    landmarks.size
    airportPlace("LHR")
    airportZone("LHR")
}
