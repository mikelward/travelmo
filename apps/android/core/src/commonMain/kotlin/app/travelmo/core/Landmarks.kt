package app.travelmo.core

// Mirrors packages/core/src/landmarks.ts: a trip's picture in the trip list,
// an outline of the best-known landmark of the city its title names, or a
// matching place kind, season, holiday or vacation drawing when no city is
// named, drawn in a 48-unit square as one SVG path for a 1.5-unit round-capped
// stroke (packages/core/src/landmarks.json, compiled in). Anything else gets
// the drawing of the kind of place it goes to ([tripPicture]), else the suitcase.

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
 * Parses the tables the trip list reads (the landmarks, and the airports a missing journey is told by), then
 * Reports' map, each read on first use: a few hundred milliseconds on a phone, so the app calls this off the main
 * thread before the list draws.
 */
fun warmTables() {
    landmarks.size
    airportPlace("LHR")
    airportZone("LHR")
    worldMap.countries.size
}

/** The kinds of place a stay or outing is in: a big city, a small town or village, a beach, the mountains, a lake, the countryside. */
val PLACE_SETTINGS = listOf("city", "town", "beach", "mountains", "lake", "countryside")

/** The booking types whose icon a trip that is just an event takes. */
private val OUTING_TYPES = setOf(SegmentType.ACTIVITY, SegmentType.OTHER, SegmentType.CAR_RENTAL)

/** The booking type whose icon a trip that is just an event takes, whatever its title: a dinner's calendar, a show's ticket ([setting]). */
fun tripBookingType(setting: String?): SegmentType? = SegmentType.fromWire(setting)?.takeIf { it in OUTING_TYPES }

/**
 * A trip's picture, for a trip not just an event ([tripBookingType]): what its title names ([tripLandmark]), else the
 * drawing of the kind of place it goes to ([setting]), else the suitcase.
 */
fun tripPicture(title: String, setting: String? = null): Landmark {
    val named = tripLandmark(title)
    if (named.id != "trip") return named
    return landmarks.firstOrNull { setting != null && setting in PLACE_SETTINGS && it.id == setting } ?: named
}

private val bigCityEntry = Regex(""""([^"]+)":\[([^\]]*)]""")

/** Each name some city of at least 250,000 people has, with the countries it is that big in (bigCities.json). */
private val bigCities: Map<String, List<String>> by lazy {
    bigCityEntry.findAll(bigCitiesJson).associate { m ->
        m.groupValues[1] to Regex(""""([A-Z]{2})"""").findAll(m.groupValues[2]).map { it.groupValues[1] }.toList()
    }
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
