package app.travelmo.core

// Mirrors packages/core/src/landmarks.ts: a trip's picture in the trip list,
// an outline of the best-known landmark of the city its title names, or a
// matching place kind, season, holiday or vacation drawing when no city is
// named, drawn in a 48-unit square as one SVG path for a 1.5-unit round-capped
// stroke (packages/core/src/landmarks.json, compiled in). Anything else gets
// the suitcase.

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
    /** Longer names, folded, that a match of [cities] or [fallback] is not when it is part of one: "santiago de compostela" is not Santiago, and "lake victoria" is not Victoria. */
    val not: List<String> = emptyList(),
    /**
     * Kind-of-place, season, holiday or vacation words, folded: matched only when the title names no place from
     * [cities] or [capitalized], so "Summer in Paris" is Paris and "Summer vacation" is Summer.
     */
    val fallback: List<String> = emptyList(),
)

private val landmarkEntry = Regex(
    """"id":"([^"]+)","name":"([^"]*)","cities":\[([^\]]*)](?:,"capitalized":\[([^\]]*)])?(?:,"not":\[([^\]]*)])?(?:,"fallback":\[([^\]]*)])?,"d":"([^"]+)"""",
)
private val quoted = Regex(""""([^"]+)"""")

val landmarks: List<Landmark> by lazy {
    landmarkEntry.findAll(landmarksJson).map { m ->
        fun list(group: Int) = quoted.findAll(m.groupValues[group]).map { it.groupValues[1] }.toList()
        Landmark(
            m.groupValues[1],
            m.groupValues[2],
            list(3),
            m.groupValues[7],
            capitalized = list(4),
            not = list(5),
            fallback = list(6),
        )
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
 * The landmark of the city named first in [title] ("Paris and Lyon" is Paris), else the first matching place kind,
 * season, holiday or vacation word ([Landmark.fallback]), else the suitcase. Names match as whole words, accents and
 * case ignored, so "Lisboa" is Lisbon and "Parisian" is nobody; a capitalized name keeps its case.
 */
fun tripLandmark(title: String): Landmark {
    val plain = decomposed(title).replace(marks, "").trim()
    // Folded as foldText does, case kept and then not.
    val kept = " ${plain.replace(notLetters, " ").trim()} "
    val words = kept.lowercase()
    fun opensTitle(name: String) = plain == name || punctuationNext.containsMatchIn(plain.drop(name.length))
    fun pick(match: (Landmark, (Int) -> Unit) -> Unit): Landmark? {
        var best: Pair<Int, Landmark>? = null
        for (landmark in landmarks) {
            match(landmark) { at ->
                if (at >= 0 && (best == null || at < best!!.first)) best = at to landmark
            }
        }
        return best?.second
    }
    fun notExcluded(not: List<String>, name: String): (Int) -> Boolean = { at ->
        not.none { n ->
            val padded = " $n "
            var off = padded.indexOf(" $name ")
            var hit = false
            while (off >= 0 && !hit) {
                if (at >= off && words.startsWith(padded, at - off)) hit = true
                off = padded.indexOf(" $name ", off + 1)
            }
            hit
        }
    }
    val place = pick { landmark, consider ->
        for (city in landmark.cities) consider(firstAt(words, city, notExcluded(landmark.not, city)))
        for (name in landmark.capitalized) consider(firstAt(kept, name) { at -> at > 0 || opensTitle(name) })
    }
    if (place != null) return place
    val theme = pick { landmark, consider ->
        for (word in landmark.fallback) consider(firstAt(words, word, notExcluded(landmark.not, word)))
    }
    return theme ?: landmarks.first { it.id == "trip" }
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
