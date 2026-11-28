package app.travelmo.core

/**
 * A journey a trip seems to be missing, as packages/core's journeyGap.ts: its
 * journeys don't join up, so a booking is probably missing (an email the
 * import never read, or read wrong).
 */
data class JourneyGap(
    /** "out": the trip ends at home but starts elsewhere; "between": one journey ends far from where the next starts; "back": no journey back to where the trip started. */
    val direction: String,
    /** The cities the missing journey goes from and to. */
    val from: String,
    val to: String,
    /** "flight" when every journey on the trip flies, else "journey". */
    val mode: String,
    /** The first day the missing journey could be: what "Add it yourself" starts on. */
    val date: String,
    /** For one between journeys, the day the next leaves. */
    val until: String? = null,
    /** The ends' airport or station codes, where known, to search for too. */
    val fromCode: String? = null,
    val toCode: String? = null,
)

private val gapJourneyTypes = setOf(SegmentType.FLIGHT, SegmentType.TRAIN, SegmentType.BUS, SegmentType.FERRY)

private fun words(text: String) = " " + text.lowercase().replace(Regex("[^\\p{L}\\p{N}]+"), " ").trim() + " "

/**
 * Whether a car hire's end is at a journey's: in the same town or near it, or named after it ("Example Cars Raleigh
 * Durham Airport" for RDU's Raleigh/Durham). Where neither says where it is, it isn't.
 */
private fun near(place: Place, end: Place): Boolean {
    if (sameArea(place, end)) return true
    // A known country that differs rules out the name: "London Downtown" in Ontario is not London's Heathrow.
    val a = countryOf(place)
    val b = countryOf(end)
    return !(a != null && b != null && a != b) && words(place.name).contains(words(end.city ?: end.name))
}

private fun countryOf(place: Place): String? = place.country?.let(::countryCode) ?: place.code?.let { airportPlace(it)?.country }

private fun sameJourney(a: Segment, b: Segment) =
    instantMillis(a.start) == instantMillis(b.start) && sameArea(a.origin, b.origin) && sameArea(a.destination, b.destination)

private fun gap(direction: String, from: Place, to: Place, mode: String, date: String, until: String? = null) =
    JourneyGap(direction, from.city ?: from.name, to.city ?: to.name, mode, date, until, from.code, to.code)

/**
 * The journeys a trip seems to be missing, in order: its live journeys with
 * both ends known don't end where they started (one out or back), or one
 * lands far from where the next leaves ([farApart]: a drive is not missing).
 * [homes] (the person's own home corrections) tell a trip that only comes
 * home from one that only leaves; without them a trip is taken to start at
 * home. [oneWay] leaves out the trip's ends.
 */
fun journeyGaps(segments: List<Segment>, homes: List<HomePeriod> = emptyList(), oneWay: Boolean = false): List<JourneyGap> {
    val journeys = liveSegments(segments)
        .filter { it.type in gapJourneyTypes && it.origin != null && it.destination != null }
        .sortedBy { instantMillis(it.start) }
        // Two travelers' own bookings on one flight are one journey.
        .let { all -> all.filterIndexed { i, j -> all.take(i).none { k -> sameJourney(k, j) } } }
    val first = journeys.firstOrNull() ?: return emptyList()
    val last = journeys.last()
    val mode = if (journeys.all { it.type == SegmentType.FLIGHT }) "flight" else "journey"
    fun landed(j: Segment) = localDate(j.end ?: j.start)
    // A car hired in one town and returned in another, as from Raleigh to Savannah, is the journey between them: driven, not missing.
    val drives = liveSegments(segments).filter {
        it.type == SegmentType.CAR_RENTAL && it.end != null && it.origin != null && it.destination != null &&
            // Returned elsewhere: by name, or by the airports its desks are at where both are called "Avis".
            (!sameCity(it.origin.city ?: it.origin.name, it.destination.city ?: it.destination.name) ||
                (it.origin.code != null && it.destination.code != null && it.origin.code != it.destination.code))
    }
    fun driven(from: Place, to: Place, after: String, before: String? = null) = drives.any { d ->
        near(d.origin!!, from) && near(d.destination!!, to) && localDate(d.end!!) >= after && (before == null || localDate(d.start) <= before)
    }
    val between = journeys.zipWithNext()
        // One leaving before the last has landed is a clash of two bookings (one of them not taken), not a journey missing
        // between them; by the clock, not the date, as eastbound over the date line a flight leaves the day before.
        .filter { (before, next) -> farApart(before.destination, next.origin) && instantMillis(next.start) >= instantMillis(before.end ?: before.start) && !driven(before.destination!!, next.origin!!, landed(before), localDate(next.start)) }
        .map { (before, next) -> gap("between", before.destination!!, next.origin!!, mode, landed(before), localDate(next.start)) }
    val start = first.origin!!
    val end = last.destination!!
    if (oneWay || sameArea(start, end)) return between
    val endsHome = homes.isNotEmpty() && journeyHome(end, landed(last), homes) && !journeyHome(start, localDate(first.start), homes)
    if (endsHome) return if (driven(end, start, "", localDate(first.start))) between else listOf(gap("out", end, start, mode, localDate(first.start))) + between
    return if (driven(end, start, landed(last))) between else between + gap("back", end, start, mode, landed(last))
}

/** The homes [journeyGaps] goes by: those set on Profile, each with the airports chosen for it, so landing at SFO is coming home to Mountain View. */
fun journeyGapHomes(homes: List<HomeCorrection>, chosen: List<ChosenHomeAirports>): List<HomePeriod> =
    withChosenAirports(homeCorrections(homes), chosen)

/**
 * "No flight from Boston back to London found", "No flight from London to
 * Boston found" for one that only comes home, or "No flight from Adelaide to
 * London found between 10 Jan and 15 Feb".
 */
fun journeyGapText(gap: JourneyGap): String {
    val what = "No ${gap.mode} from ${gap.from} ${if (gap.direction == "back") "back " else ""}to ${gap.to} found"
    val until = gap.until
    if (gap.direction != "between" || until == null) return what
    return if (until == gap.date) "$what on ${dayMonth(gap.date)}" else "$what between ${dayMonth(gap.date)} and ${dayMonth(until)}"
}

/** The places in a mailbox search for the missing booking's email (the parser adds the dates): both its ends, each by city or code, as `("Adelaide" OR ADL) ("London" OR LHR)`. */
fun journeyGapSearch(gap: JourneyGap): String {
    fun term(city: String, code: String?): String {
        val name = "\"${city.replace('"', ' ')}\""
        return if (code != null && !code.equals(city, ignoreCase = true)) "($name OR $code)" else name
    }
    return "${term(gap.from, gap.fromCode)} ${term(gap.to, gap.toCode)}"
}

/** "Look for it" on the parser (its findJourney.ts): the person's mailbox searched for a gap's emails, a few read at a time. */
const val LOOK_PATH = "/trips/look"

/**
 * What came of one email a look found, as journeyGap.ts's LookedEmail: read now ("imported", "cancellation",
 * "not_booking", "filtered" or "failed"), "already" imported before, or "busy" being imported right now. [report], for
 * one read now, is Import anyway's, to copy.
 */
data class LookedEmail(val messageId: String, val subject: String, val outcome: String, val report: String? = null)

/** A look's emails, and [next], where to keep looking from, while there are more. */
data class LookResult(val emails: List<LookedEmail>, val next: Int? = null)

/** A key for one gap of a trip, to keep what looking for it found. */
fun journeyGapKey(tripId: String, gap: JourneyGap): String = "$tripId/${gap.direction}/${gap.date}/${gap.from}/${gap.to}"

/** The trips a person said go one way; past this many the oldest is dropped. */
const val MAX_ONE_WAY_TRIPS = 200

/** The list with one more trip, the newest kept when it is full. */
fun withOneWay(trips: List<String>, tripId: String): List<String> = (trips.filter { it != tripId } + tripId).takeLast(MAX_ONE_WAY_TRIPS)
