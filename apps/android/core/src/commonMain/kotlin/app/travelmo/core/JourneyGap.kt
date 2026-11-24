package app.travelmo.core

/**
 * The journey a trip seems to be missing, as packages/core's journeyGap.ts:
 * its journeys don't come back to where they started, so a booking is
 * probably missing (an email the import never read, or read wrong).
 */
data class JourneyGap(
    /** "back": no journey back to where the trip started; "out": the trip ends at home but starts elsewhere. */
    val direction: String,
    /** The city the missing journey goes to. */
    val to: String,
    /** "flight" when every journey on the trip flies, else "journey". */
    val mode: String,
    /** The day the missing journey would be: what "Add it yourself" starts on. */
    val date: String,
    /** The trip's journeys' booking references, to search the mailbox for. */
    val references: List<String>,
)

private val gapJourneyTypes = setOf(SegmentType.FLIGHT, SegmentType.TRAIN, SegmentType.BUS, SegmentType.FERRY)

/**
 * The journey a trip seems to be missing, if any: its live journeys with both
 * ends known, in order, don't end where they started. [homes] (the person's
 * own home corrections) tell a trip that only comes home from one that only
 * leaves; without them a trip is taken to start at home.
 */
fun journeyGap(segments: List<Segment>, homes: List<HomePeriod> = emptyList()): JourneyGap? {
    val journeys = liveSegments(segments)
        .filter { it.type in gapJourneyTypes && it.origin != null && it.destination != null }
        .sortedBy { instantMillis(it.start) }
    val first = journeys.firstOrNull() ?: return null
    val last = journeys.last()
    val start = first.origin!!
    val end = last.destination!!
    if (sameArea(start, end)) return null
    val mode = if (journeys.all { it.type == SegmentType.FLIGHT }) "flight" else "journey"
    val references = journeys.mapNotNull { it.confirmation?.trim() }.distinct()
    val landed = localDate(last.end ?: last.start)
    val endsHome = homes.isNotEmpty() && journeyHome(end, landed, homes) && !journeyHome(start, localDate(first.start), homes)
    return if (endsHome) {
        JourneyGap("out", start.city ?: start.name, mode, localDate(first.start), references)
    } else {
        JourneyGap("back", start.city ?: start.name, mode, landed, references)
    }
}

/** The homes [journeyGap] goes by: those set on Profile, each with the airports chosen for it, so landing at SFO is coming home to Mountain View. */
fun journeyGapHomes(homes: List<HomeCorrection>, chosen: List<ChosenHomeAirports>): List<HomePeriod> =
    withChosenAirports(homeCorrections(homes), chosen)

/** "No flight back to London found", or for one that only comes home, "No flight to Boston found". */
fun journeyGapText(gap: JourneyGap): String =
    if (gap.direction == "back") "No ${gap.mode} back to ${gap.to} found" else "No ${gap.mode} to ${gap.to} found"

/** A Gmail search for the missing booking's email: the trip's booking references, else the city it goes to. */
fun journeyGapSearch(gap: JourneyGap): String =
    if (gap.references.isNotEmpty()) gap.references.joinToString(" OR ") else "\"${gap.to.replace('"', ' ')}\""

/** That search in Gmail's web app, in whichever account the browser has open first. */
fun gmailSearchUrl(query: String): String = "https://mail.google.com/mail/u/0/#search/${encodeUriComponent(query)}"

/** The trips a person said go one way; past this many the oldest is dropped. */
const val MAX_ONE_WAY_TRIPS = 200

/** The list with one more trip, the newest kept when it is full. */
fun withOneWay(trips: List<String>, tripId: String): List<String> = (trips.filter { it != tripId } + tripId).takeLast(MAX_ONE_WAY_TRIPS)
