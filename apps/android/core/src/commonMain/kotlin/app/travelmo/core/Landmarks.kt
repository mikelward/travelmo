package app.travelmo.core

// Mirrors packages/core/src/landmarks.ts: a trip's picture in the trip list,
// an outline of the best-known landmark of the city its title names, else a
// simplified map outline of the country it names, else a matching place kind,
// season, holiday or vacation drawing when no city or country is named, drawn
// in a 48-unit square as one SVG path for a 1.5-unit round-capped stroke
// (packages/core/src/landmarks.json, compiled in). Anything else gets the
// drawing of the kind of place it goes to ([tripPicture]), else the suitcase.

data class Landmark(
    val id: String,
    /** What it shows, for whoever maintains the drawings. */
    val name: String,
    /** The city names it stands for, folded ([foldText]). */
    val cities: List<String>,
    val d: String,
    /**
     * The country names it stands for, folded ([foldText]): matched only when the title names no place from
     * [cities] or city [capitalized], and before [fallback], so "Paris, France" is Paris and "Summer in France" is France.
     */
    val countries: List<String> = emptyList(),
    /**
     * Names that are also everyday words ("Nice", "Bath") or case-sensitive country abbreviations ("US", "UK", "NZ"),
     * accents dropped: title-case words count only capitalized and not opening the title unless alone or before
     * punctuation ("Nice, France"), while all-caps abbreviations ("US", "UK", "NZ") match anywhere in exact uppercase.
     */
    val capitalized: List<String> = emptyList(),
    /** Longer names, folded, that a match of [cities], [countries] or [fallback] is not when it is part of one. */
    val not: List<String> = emptyList(),
    /**
     * Kind-of-place, season, holiday or vacation words, folded: matched only when the title names no place from
     * [cities], [countries] or [capitalized], so "Summer in Paris" is Paris, "Summer in Japan" is Japan, and
     * "Summer vacation" is Summer.
     */
    val fallback: List<String> = emptyList(),
)

private fun scanQuotedStrings(src: String, start: Int, end: Int): List<String> {
    if (start >= end) return emptyList()
    val out = ArrayList<String>()
    var pos = src.indexOf('"', start)
    while (pos >= 0 && pos < end) {
        val close = src.indexOf('"', pos + 1)
        if (close < 0 || close >= end) break
        out.add(src.substring(pos + 1, close))
        pos = src.indexOf('"', close + 1)
    }
    return out
}

private fun parseStringField(line: String, key: String, from: Int): Pair<String, Int>? {
    val at = line.indexOf(key, from)
    if (at < 0) return null
    val start = at + key.length
    val end = line.indexOf('"', start)
    if (end < 0) return null
    return line.substring(start, end) to (end + 1)
}

private fun parseArrayField(line: String, key: String, from: Int): Pair<List<String>, Int>? {
    val at = line.indexOf(key, from)
    if (at < 0) return null
    val start = at + key.length
    val end = line.indexOf(']', start)
    if (end < 0) return null
    return scanQuotedStrings(line, start, end) to (end + 1)
}

val landmarks: List<Landmark> by lazy {
    val out = ArrayList<Landmark>(500)
    val src = landmarksJson
    var pos = 0
    while (pos < src.length) {
        val nl = src.indexOf('\n', pos).let { if (it < 0) src.length else it }
        val line = src.substring(pos, nl)
        pos = nl + 1
        val idHit = parseStringField(line, "\"id\":\"", 0) ?: continue
        val nameHit = parseStringField(line, "\"name\":\"", idHit.second) ?: continue
        val citiesHit = parseArrayField(line, "\"cities\":[", nameHit.second) ?: continue
        var cursor = citiesHit.second
        val countries = parseArrayField(line, "\"countries\":[", cursor)?.also { cursor = it.second }?.first.orEmpty()
        val capitalized = parseArrayField(line, "\"capitalized\":[", cursor)?.also { cursor = it.second }?.first.orEmpty()
        val not = parseArrayField(line, "\"not\":[", cursor)?.also { cursor = it.second }?.first.orEmpty()
        val fallback = parseArrayField(line, "\"fallback\":[", cursor)?.also { cursor = it.second }?.first.orEmpty()
        val dHit = parseStringField(line, "\"d\":\"", cursor) ?: continue
        out.add(Landmark(idHit.first, nameHit.first, citiesHit.first, dHit.first, countries = countries, capitalized = capitalized, not = not, fallback = fallback))
    }
    out.also { check(it.any { l -> l.id == "trip" }) { "landmarks.json has no suitcase" } }
}

private val landmarksById: Map<String, Landmark> by lazy { landmarks.associateBy { it.id } }

private class LandmarkHit(val order: Int, val landmark: Landmark, val name: String, val paddedNot: List<String>)

private class LandmarkIndex(
    val cities: Map<String, List<LandmarkHit>>,
    val capitalized: Map<String, List<LandmarkHit>>,
    val countries: Map<String, List<LandmarkHit>>,
    val countryCapitalized: Map<String, List<LandmarkHit>>,
    val fallback: Map<String, List<LandmarkHit>>,
    val suitcase: Landmark,
)

private val landmarkIndex: LandmarkIndex by lazy {
    val cities = HashMap<String, MutableList<LandmarkHit>>()
    val capitalized = HashMap<String, MutableList<LandmarkHit>>()
    val countries = HashMap<String, MutableList<LandmarkHit>>()
    val countryCapitalized = HashMap<String, MutableList<LandmarkHit>>()
    val fallback = HashMap<String, MutableList<LandmarkHit>>()
    fun add(map: HashMap<String, MutableList<LandmarkHit>>, phrase: String, hit: LandmarkHit) {
        val space = phrase.indexOf(' ')
        val first = if (space < 0) phrase else phrase.substring(0, space)
        if (first.isEmpty()) return
        map.getOrPut(first) { ArrayList(2) }.add(hit)
    }
    landmarks.forEachIndexed { order, landmark ->
        val paddedNot = landmark.not.map { " $it " }
        val isCountry = landmark.countries.isNotEmpty() && landmark.cities.isEmpty()
        for (city in landmark.cities) add(cities, city, LandmarkHit(order, landmark, city, paddedNot))
        for (country in landmark.countries) add(countries, country, LandmarkHit(order, landmark, country, paddedNot))
        for (name in landmark.capitalized) {
            add(if (isCountry) countryCapitalized else capitalized, name, LandmarkHit(order, landmark, name, paddedNot))
        }
        for (word in landmark.fallback) add(fallback, word, LandmarkHit(order, landmark, word, paddedNot))
    }
    LandmarkIndex(cities, capitalized, countries, countryCapitalized, fallback, landmarksById.getValue("trip"))
}

private val marks = Regex("\\p{M}+")
private val notLetters = Regex("[^\\p{L}\\p{N}]+")
private val punctuationNext = Regex("^\\s*[,;:(/\\-–—]")

/** Where ` name ` first occurs in [text] at a place [ok] accepts, else -1. */
private fun firstAt(text: String, name: String, ok: (Int) -> Boolean): Int {
    val needle = " $name "
    var at = text.indexOf(needle)
    while (at >= 0) {
        if (ok(at)) return at
        at = text.indexOf(needle, at + 1)
    }
    return -1
}

private fun isNotExcluded(words: String, paddedNot: List<String>, name: String, at: Int): Boolean {
    if (paddedNot.isEmpty()) return true
    val needle = " $name "
    for (padded in paddedNot) {
        var off = padded.indexOf(needle)
        while (off >= 0) {
            if (at >= off && words.startsWith(padded, at - off)) return false
            off = padded.indexOf(needle, off + 1)
        }
    }
    return true
}

private fun isAllCaps(name: String): Boolean =
    name.length >= 2 && name == name.uppercase() && name != name.lowercase()

/**
 * The landmark of the city named first in [title] ("Paris and Lyon" is Paris), else the first named country
 * ("Summer in Japan" is Japan), else the first matching place kind, season, holiday or vacation word
 * ([Landmark.fallback]), else the suitcase. Names match as whole words, accents and case ignored, so "Lisboa" is
 * Lisbon and "Parisian" is nobody; a capitalized name keeps its case.
 */
fun tripLandmark(title: String): Landmark {
    val index = landmarkIndex
    val plain = decomposed(title).replace(marks, "").trim()
    // Folded as foldText does, case kept and then not.
    val keptTrimmed = plain.replace(notLetters, " ").trim()
    val kept = " $keptTrimmed "
    val words = kept.lowercase()
    fun opensTitle(name: String) = plain == name || punctuationNext.containsMatchIn(plain.drop(name.length))
    val keptTokens = if (keptTrimmed.isEmpty()) emptySet() else keptTrimmed.split(' ').toHashSet()
    val lowerTokens = if (keptTrimmed.isEmpty()) emptySet() else keptTrimmed.lowercase().split(' ').toHashSet()

    var bestAt = Int.MAX_VALUE
    var bestOrder = Int.MAX_VALUE
    var best: Landmark? = null
    fun consider(at: Int, order: Int, landmark: Landmark) {
        if (at >= 0 && (at < bestAt || (at == bestAt && order < bestOrder))) {
            bestAt = at
            bestOrder = order
            best = landmark
        }
    }

    fun matchLower(map: Map<String, List<LandmarkHit>>) {
        for (token in lowerTokens) {
            val hits = map[token] ?: continue
            for (hit in hits) {
                consider(firstAt(words, hit.name) { at -> isNotExcluded(words, hit.paddedNot, hit.name, at) }, hit.order, hit.landmark)
            }
        }
    }

    fun matchCapitalized(map: Map<String, List<LandmarkHit>>) {
        for (token in keptTokens) {
            val hits = map[token] ?: continue
            for (hit in hits) {
                val lower = hit.name.lowercase()
                val allowStart = isAllCaps(hit.name) || opensTitle(hit.name)
                consider(
                    firstAt(kept, hit.name) { at -> (at > 0 || allowStart) && isNotExcluded(words, hit.paddedNot, lower, at) },
                    hit.order,
                    hit.landmark,
                )
            }
        }
    }

    matchLower(index.cities)
    matchCapitalized(index.capitalized)
    if (best == null) {
        matchLower(index.countries)
        matchCapitalized(index.countryCapitalized)
    }
    if (best == null) matchLower(index.fallback)
    return best ?: index.suitcase
}

/**
 * Parses the tables the trip list, trip pages and Reports read, each read on first use: a few hundred milliseconds on
 * a phone, so the app calls this off the main thread before the list draws.
 */
fun warmTables() {
    landmarkIndex.suitcase.id
    placeSetting(Place("", city = "London"))
    sameCity("London", "London")
    airportPlace("LHR")
    airportZone("LHR")
    worldMap.countries.size
}

/** The kinds of place a stay or outing is in: a big city, a small town or village, a beach, the mountains, a lake, the countryside. */
val PLACE_SETTINGS = listOf("city", "town", "beach", "mountains", "lake", "countryside")

/** The booking types whose icon a trip that is just an event takes. */
private val OUTING_TYPES = setOf(SegmentType.ACTIVITY, SegmentType.MEAL, SegmentType.OTHER, SegmentType.CAR_RENTAL)

/** The booking type whose icon a trip that is just an event takes, whatever its title: a dinner's fork and knife, a show's ticket ([setting]). */
fun tripBookingType(setting: String?): SegmentType? = SegmentType.fromWire(setting)?.takeIf { it in OUTING_TYPES }

/**
 * A trip's picture, for a trip not just an event ([tripBookingType]): what its title names ([tripLandmark]), else the
 * drawing of the kind of place it goes to ([setting]), else the suitcase.
 */
fun tripPicture(title: String, setting: String? = null): Landmark {
    val named = tripLandmark(title)
    if (named.id != "trip") return named
    return if (setting != null && setting in PLACE_SETTINGS) landmarksById[setting] ?: named else named
}

/** Each name some city of at least 250,000 people has, with the countries it is that big in (bigCities.json). */
private val bigCities: Map<String, List<String>> by lazy {
    val out = HashMap<String, List<String>>(2048)
    val src = bigCitiesJson
    var pos = 0
    while (pos < src.length) {
        val nl = src.indexOf('\n', pos).let { if (it < 0) src.length else it }
        val keyStart = src.indexOf('"', pos)
        if (keyStart >= 0 && keyStart < nl) {
            val keyEnd = src.indexOf('"', keyStart + 1)
            val arrStart = if (keyEnd >= 0 && keyEnd < nl) src.indexOf('[', keyEnd + 1) else -1
            val arrEnd = if (arrStart >= 0 && arrStart < nl) src.indexOf(']', arrStart + 1) else -1
            if (arrEnd >= 0) {
                out[src.substring(keyStart + 1, keyEnd)] = scanQuotedStrings(src, arrStart + 1, arrEnd)
            }
        }
        pos = nl + 1
    }
    out
}

/**
 * What kind of place a booking's place is: what the email or the reader said, else by its town's size: a city of
 * 250,000 people or more in its country is a city, any other named town a town. Null for a place with neither.
 */
fun placeSetting(place: Place?): String? {
    place?.setting?.takeIf { it in PLACE_SETTINGS }?.let { return it }
    val city = place?.city ?: return null
    val countries = bigCities[foldText(city)]
    return if (countries != null && (place.country == null || place.country in countries)) "city" else "town"
}

private val JOURNEYS = setOf(SegmentType.FLIGHT, SegmentType.TRAIN, SegmentType.BUS, SegmentType.FERRY)

// A booking's instants are checked where they are written (the rules' isInstant), so one that doesn't parse
// throws here, as everywhere else they are read (compareInstants), rather than order the bookings quietly wrong.
private fun lengthOf(s: Segment): Long = s.end?.let { end -> instantMillis(end) - instantMillis(s.start) } ?: 0L

/** Earliest first, then by title, so every app picks the same booking. */
private val inOrder = Comparator<Segment> { a, b -> compareInstants(a.start, b.start).takeIf { it != 0 } ?: a.title.compareTo(b.title) }

/**
 * What kind of place a trip goes to, for its picture: that of its longest stay, else of its first outing, else of
 * where its first journey arrives; "none" when none of them says. Goes by what is still booked unless nothing is.
 */
fun tripSetting(segments: List<Segment>): String {
    // A show, a dinner, a day out: its first booking's icon, not the town it is in.
    if (localOnly(segments)) return liveSegments(segments).sortedWith(inOrder).first().type.wire
    val live = liveSegments(segments)
    val from = live.ifEmpty { segments }
    val stays = from.filter { it.type == SegmentType.LODGING }.sortedWith(compareByDescending<Segment> { lengthOf(it) }.then(inOrder))
    val outings = from.filter { it.type != SegmentType.LODGING && it.type !in JOURNEYS }.sortedWith(inOrder)
    val journeys = from.filter { it.type in JOURNEYS }.sortedWith(inOrder)
    for (s in stays + outings) placeSetting(s.destination ?: s.origin)?.let { return it }
    for (s in journeys) placeSetting(s.destination)?.let { return it }
    return "none"
}
