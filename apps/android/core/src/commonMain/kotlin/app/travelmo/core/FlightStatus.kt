package app.travelmo.core

/**
 * A flight's live gates, terminals and baggage carousel, as the parser keeps
 * them in `flightStatus/{key}`, one per flight for everyone booked on it.
 * Mirrors packages/core/src/flightStatus.ts: the parts a trip page needs.
 * Times are UTC instants; absent fields are null.
 */
data class FlightStatus(
    val ident: String,
    val date: String,
    val origin: String? = null,
    val found: Boolean,
    val departureGate: String? = null,
    val departureTerminal: String? = null,
    val arrivalGate: String? = null,
    val arrivalTerminal: String? = null,
    val baggageClaim: String? = null,
    val scheduledOut: String? = null,
    val estimatedOut: String? = null,
    val actualOut: String? = null,
    val scheduledIn: String? = null,
    val estimatedIn: String? = null,
    val actualIn: String? = null,
    val cancelled: Boolean = false,
    val diverted: Boolean = false,
    val divertedTo: String? = null,
    val noticedOut: String? = null,
    val checkedAt: String,
)

private val designatorPattern = Regex("""(?:^|[^A-Z0-9])([A-Z][A-Z0-9]|[0-9][A-Z]) ?0*(\d{1,4})(?![0-9])""")

/** The flight number in a booking's title ("BA 117 LHR to JFK" → "BA117"); null for anything else. */
fun flightDesignator(segment: Segment): String? {
    if (segment.type != SegmentType.FLIGHT) return null
    val match = designatorPattern.find(segment.title) ?: return null
    return match.groupValues[1] + match.groupValues[2]
}

/** The flight a booking is on, as the parser names its status: "QF1_2026-12-13_SYD". */
fun flightStatusKey(segment: Segment): String? {
    val ident = flightDesignator(segment) ?: return null
    val origin = segment.origin?.code?.uppercase()?.takeIf { Regex("[A-Z]{3}").matches(it) }
    return listOfNotNull(ident, localDate(segment.start), origin).joinToString("_")
}

private const val MINUTE = 60_000L
private const val HOUR = 60 * MINUTE
private const val FAST_BEFORE_DEPARTURE = 2 * HOUR
private const val FAST_BEFORE_ARRIVAL = 30 * MINUTE
private const val AFTER_ARRIVAL = 45 * MINUTE
private const val FAST_INTERVAL = MINUTE
private const val SLOW_INTERVAL = 15 * MINUTE
private const val REFRESH_BEFORE_DEPARTURE = 6 * HOUR
private const val REFRESH_INTERVAL = MINUTE
private const val GIVE_UP_AFTER = 30 * HOUR
private const val SLACK = 15_000L

private data class Times(val departure: Long, val arrival: Long?, val departed: Boolean)

private fun times(segment: Segment, status: FlightStatus?): Times {
    val departure = instantMillis(status?.estimatedOut ?: status?.scheduledOut ?: segment.start)
    val arrival = (status?.actualIn ?: status?.estimatedIn ?: status?.scheduledIn ?: segment.end)?.let(::instantMillis)
    return Times(departure, arrival, status?.actualOut != null)
}

/** How often the parser looks at the flight now, in milliseconds; null when it does not. */
fun flightCheckInterval(segment: Segment, status: FlightStatus?, now: String): Long? {
    val at = instantMillis(now)
    if (status?.cancelled == true) return null
    if (at > instantMillis(segment.start) + GIVE_UP_AFTER) return null
    val (departure, arrival, departed) = times(segment, status)
    if (at < departure - FAST_BEFORE_DEPARTURE) return null
    if (status != null && !status.found) return if (at <= departure + HOUR) SLOW_INTERVAL else null
    if (arrival != null && at >= arrival + AFTER_ARRIVAL) return null
    if (!departed && at < departure + 30 * MINUTE) return FAST_INTERVAL
    if (arrival == null) return SLOW_INTERVAL
    return if (at >= arrival - FAST_BEFORE_ARRIVAL) FAST_INTERVAL else SLOW_INTERVAL
}

/** Whether an open trip page may have the flight looked at now: from six hours before departure, once a minute. */
fun flightRefreshDue(segment: Segment, status: FlightStatus?, now: String): Boolean {
    val at = instantMillis(now)
    val (departure) = times(segment, status)
    if (status?.cancelled == true || at < departure - REFRESH_BEFORE_DEPARTURE) return false
    val watched = at < departure - FAST_BEFORE_DEPARTURE || flightCheckInterval(segment, status, now) != null
    return watched && (status == null || at - instantMillis(status.checkedAt) >= REFRESH_INTERVAL - SLACK)
}

/** Whether a trip page shows the flight's status: from a day before departure until the looks stop; never for a cancelled booking. */
fun flightStatusShown(segment: Segment, now: String): Boolean {
    val at = instantMillis(now)
    val start = instantMillis(segment.start)
    return segment.type == SegmentType.FLIGHT && !segment.isCancelled && at >= start - 24 * HOUR && at <= start + GIVE_UP_AFTER
}

/** The keys of the flights whose status a trip page shows now, each once. */
fun shownFlightKeys(segments: List<Segment>, now: String): List<String> =
    segments.filter { flightStatusShown(it, now) }.mapNotNull(::flightStatusKey).distinct().sorted()

private fun where(gate: String?, terminal: String?): String? =
    listOfNotNull(terminal?.let { "terminal $it" }, gate?.let { "gate $it" }).takeIf { it.isNotEmpty() }?.joinToString(", ")

/** A departure or landing this far from the schedule is shown. */
private const val DELAY_SHOWN = 5 * MINUTE

/** "40 min", "1 h", "2 h 5 min". */
private fun span(millis: Long): String {
    val total = kotlin.math.round(kotlin.math.abs(millis) / MINUTE.toDouble()).toLong()
    val hours = total / 60
    val minutes = total % 60
    return when {
        hours == 0L -> "$minutes min"
        minutes == 0L -> "$hours h"
        else -> "$hours h $minutes min"
    }
}

/** A UTC instant as the clock reads where [place] (an instant with that place's offset) is: "10:25". */
private fun clockAt(at: String, place: String?): String? =
    place?.let { localTime(shiftInstant(it, instantMillis(at) - instantMillis(it))) }

/** "40 min late, at 10:25", "20 min early, at 18:10" or "on time, at 09:00". */
private fun timing(scheduled: String, estimated: String, place: String?): String {
    val off = instantMillis(estimated) - instantMillis(scheduled)
    val word = if (kotlin.math.abs(off) < DELAY_SHOWN) "on time" else "${span(off)} ${if (off > 0) "late" else "early"}"
    return clockAt(estimated, place)?.let { "$word, at $it" } ?: word
}

private fun offSchedule(scheduled: String?, estimated: String?): Boolean =
    scheduled != null && estimated != null && kotlin.math.abs(instantMillis(estimated) - instantMillis(scheduled)) >= DELAY_SHOWN

/**
 * What the flight's card says: whether it is cancelled or diverted, how late it leaves and lands,
 * where it leaves from and arrives at, and where the bags come out. Times read as the airports'
 * clocks do when the booking is given; a cancelled flight says only that. A departure back on time
 * after news of a delay still says so (it has a noticedOut).
 */
fun flightStatusLines(status: FlightStatus?, booked: Segment? = null): List<String> {
    if (status == null || !status.found) return emptyList()
    if (status.cancelled) return listOf("Flight cancelled")
    val to = status.divertedTo?.uppercase()
    val diverted = when {
        !status.diverted -> null
        to != null && to != booked?.destination?.code?.uppercase() -> "Diverted to $to"
        else -> "Diverted"
    }
    val leaves = status.actualOut == null && status.estimatedOut != null &&
        (offSchedule(status.scheduledOut, status.estimatedOut) || status.noticedOut != null)
    val lands = status.actualIn == null && offSchedule(status.scheduledIn, status.estimatedIn)
    return listOfNotNull(
        diverted,
        if (leaves) "Leaves ${timing(status.scheduledOut!!, status.estimatedOut!!, booked?.start)}" else null,
        where(status.departureGate, status.departureTerminal)?.let { "Departs from $it" },
        if (lands) "Lands ${timing(status.scheduledIn!!, status.estimatedIn!!, booked?.end)}" else null,
        where(status.arrivalGate, status.arrivalTerminal)?.let { "Arrives at $it" },
        status.baggageClaim?.let { "Bags on carousel $it" },
    )
}
