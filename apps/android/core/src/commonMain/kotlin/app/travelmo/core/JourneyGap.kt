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
    val between = journeys.zipWithNext().filter { (before, next) -> farApart(before.destination, next.origin) }
        .map { (before, next) -> gap("between", before.destination!!, next.origin!!, mode, landed(before), localDate(next.start)) }
    val start = first.origin!!
    val end = last.destination!!
    if (oneWay || sameArea(start, end)) return between
    val endsHome = homes.isNotEmpty() && journeyHome(end, landed(last), homes) && !journeyHome(start, localDate(first.start), homes)
    return if (endsHome) listOf(gap("out", end, start, mode, localDate(first.start))) + between else between + gap("back", end, start, mode, landed(last))
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

/** A Gmail search for the missing booking's email: both its ends, each by city or code, as `("Adelaide" OR ADL) ("London" OR LHR)`. */
fun journeyGapSearch(gap: JourneyGap): String {
    fun term(city: String, code: String?): String {
        val name = "\"${city.replace('"', ' ')}\""
        return if (code != null && !code.equals(city, ignoreCase = true)) "($name OR $code)" else name
    }
    return "${term(gap.from, gap.fromCode)} ${term(gap.to, gap.toCode)}"
}

/** That search in Gmail's web app, in whichever account the browser has open first. */
fun gmailSearchUrl(query: String): String = "https://mail.google.com/mail/u/0/#search/${encodeUriComponent(query)}"

/** The trips a person said go one way; past this many the oldest is dropped. */
const val MAX_ONE_WAY_TRIPS = 200

/** The list with one more trip, the newest kept when it is full. */
fun withOneWay(trips: List<String>, tripId: String): List<String> = (trips.filter { it != tripId } + tripId).takeLast(MAX_ONE_WAY_TRIPS)
