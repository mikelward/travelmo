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

/** Whether a departure time is worth saying: not left and off schedule, or news of a delay went out. */
private fun leavesLate(status: FlightStatus): Boolean =
    status.actualOut == null && status.estimatedOut != null &&
        (offSchedule(status.scheduledOut, status.estimatedOut) || status.noticedOut != null)

private fun divertedLine(status: FlightStatus, booked: Segment?): String {
    val to = status.divertedTo?.uppercase()
    return if (to != null && to != booked?.destination?.code?.uppercase()) "Diverted to $to" else "Diverted"
}

/**
 * Whether the flight has taken off as of [at]: the service says it left, or the time it is
 * expected to leave (else the one scheduled, else the booking's) has passed. A cancelled flight
 * goes by its booking's time.
 */
fun flightDeparted(booked: Segment, status: FlightStatus?, at: String): Boolean {
    if (status != null && status.found && !status.cancelled) {
        if (status.actualOut != null) return true
        val out = status.estimatedOut ?: status.scheduledOut
        if (out != null) return instantMillis(at) >= instantMillis(out)
    }
    return instantMillis(at) >= instantMillis(booked.start)
}

/** "Terminal 3 · Gate 12", "Terminal E · Bags on carousel 7": what is known; null when nothing is. */
private fun listed(vararg parts: String?): String? = parts.filterNotNull().takeIf { it.isNotEmpty() }?.joinToString(" · ")

/**
 * The next thing to do for a flight, for a trip card's last line: before takeoff, how late it
 * leaves when it is late, else the terminal and gate it leaves from; after, the terminal and gate
 * it arrives at and where the bags come out. A cancelled or diverted flight says that instead.
 * Null when nothing is known.
 */
fun flightNextStep(status: FlightStatus?, booked: Segment, now: String): String? {
    if (status == null || !status.found) return null
    if (status.cancelled) return "Flight cancelled"
    if (!flightDeparted(booked, status, now)) {
        if (leavesLate(status)) return "Leaves ${timing(status.scheduledOut!!, status.estimatedOut!!, booked.start)}"
        return listed(status.departureTerminal?.let { "Terminal $it" }, status.departureGate?.let { "Gate $it" })
    }
    if (status.diverted) return divertedLine(status, booked)
    return listed(
        status.arrivalTerminal?.let { "Terminal $it" },
        status.arrivalGate?.let { "Gate $it" },
        status.baggageClaim?.let { "Bags on carousel $it" },
    )
}

/**
 * What the flight's card says: whether it is cancelled or diverted, how late it leaves and lands,
 * where it leaves from and arrives at, and where the bags come out. Times read as the airports'
 * clocks do when the booking is given; a cancelled flight says only that. A departure back on time
 * after news of a delay still says so (it has a noticedOut).
 */
fun flightStatusLines(status: FlightStatus?, booked: Segment? = null): List<String> {
    if (status == null || !status.found) return emptyList()
    if (status.cancelled) return listOf("Flight cancelled")
    val diverted = if (status.diverted) divertedLine(status, booked) else null
    val leaves = leavesLate(status)
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

/**
 * A flight's Live Update: an ongoing notification from two hours before departure until 45 minutes
 * after landing, with the most useful thing now in the status bar's [chip] ("T3 G28" before it
 * leaves, "Lands 15:10" in the air, "Bags 16" once landed), a one-line [text], [progress]
 * through the flight (0 to 100) and when to take it down ([endsAt], epoch
 * milliseconds) should no later look say so.
 */
data class LiveFlight(
    val chip: String,
    val text: String,
    val progress: Int,
    val endsAt: Long,
)

/** "T3" or "G28" for a short value, "Intl" or "B12" for one that names itself. */
private fun shortPlace(letter: String, value: String): String =
    if (value.length == 1 || value.first().isDigit()) "$letter$value" else value

/** "T3 G28", "T3", "G28", or null when neither is known. */
private fun shortWhere(gate: String?, terminal: String?): String? =
    listOfNotNull(terminal?.let { shortPlace("T", it) }, gate?.let { shortPlace("G", it) })
        .takeIf { it.isNotEmpty() }?.joinToString(" ")

/**
 * What the flight's Live Update shows now, for [booked] (the person's booking, whose offsets give
 * the airports' clocks); null while the parser does not watch the flight (too early, over,
 * cancelled, or never found), when the phone takes it down.
 */
fun liveFlight(status: FlightStatus?, booked: Segment, now: String): LiveFlight? {
    if (status == null || !status.found || status.cancelled) return null
    if (flightCheckInterval(booked, status, now) == null) return null
    val at = instantMillis(now)
    val to = status.divertedTo?.uppercase()
    val diverted = when {
        !status.diverted -> null
        to != null && to != booked.destination?.code?.uppercase() -> "Diverted to $to"
        else -> "Diverted"
    }
    val leavesAt = status.estimatedOut ?: status.scheduledOut ?: booked.start
    val landsAt = status.actualIn ?: status.estimatedIn ?: status.scheduledIn ?: booked.end
    val endsAt = landsAt?.let { instantMillis(it) + AFTER_ARRIVAL } ?: (instantMillis(booked.start) + GIVE_UP_AFTER)
    val departureWhere = where(status.departureGate, status.departureTerminal)
    val arrivalWhere = where(status.arrivalGate, status.arrivalTerminal)
    val out = status.actualOut
    if (out == null) {
        val leaves = if (status.scheduledOut != null && status.estimatedOut != null) {
            "Leaves ${timing(status.scheduledOut, status.estimatedOut, booked.start)}"
        } else {
            clockAt(leavesAt, booked.start)?.let { "Leaves at $it" }
        }
        val chip = shortWhere(status.departureGate, status.departureTerminal) ?: clockAt(leavesAt, booked.start) ?: "Soon"
        val text = listOfNotNull(diverted, leaves, departureWhere?.let { "Departs from $it" }).joinToString(" · ")
        return LiveFlight(chip, text, 0, endsAt)
    }
    if (status.actualIn == null) {
        val lands = if (status.scheduledIn != null && status.estimatedIn != null) {
            "Lands ${timing(status.scheduledIn, status.estimatedIn, booked.end)}"
        } else {
            landsAt?.let { clockAt(it, booked.end) }?.let { "Lands at $it" }
        }
        val chip = landsAt?.let { clockAt(it, booked.end) }?.let { "Lands $it" } ?: "In the air"
        val text = listOfNotNull(diverted, lands, arrivalWhere?.let { "Arrives at $it" }).joinToString(" · ").ifEmpty { "In the air" }
        val progress = landsAt?.let {
            val from = instantMillis(out)
            val span = instantMillis(it) - from
            if (span <= 0) 99 else ((at - from) * 100 / span).toInt().coerceIn(0, 99)
        } ?: 50
        return LiveFlight(chip, text, progress, endsAt)
    }
    val chip = status.baggageClaim?.let { "Bags $it" } ?: shortWhere(status.arrivalGate, status.arrivalTerminal) ?: "Landed"
    val text = listOfNotNull(
        diverted,
        status.baggageClaim?.let { "Bags on carousel $it" } ?: arrivalWhere?.let { "Arrives at $it" } ?: "Landed",
    ).joinToString(" · ")
    return LiveFlight(chip, text, 100, endsAt)
}

/** A flight's Live Update as the parser sends it (`apps/parser/src/fcm.ts`): the status, and the person's booking of it. */
data class LiveFlightMessage(val key: String, val tag: String, val url: String, val status: FlightStatus, val booking: Segment)

/** Reads a Live Update's message data (all strings); null for any other message or one missing what it needs. */
fun liveFlightMessage(data: Map<String, String>): LiveFlightMessage? {
    if (data["kind"] != "live") return null
    val key = data["key"] ?: return null
    val tag = data["tag"] ?: return null
    val url = data["url"] ?: return null
    val title = data["title"] ?: return null
    val start = data["start"] ?: return null
    val status = FlightStatus(
        ident = data["ident"] ?: return null,
        date = data["date"] ?: return null,
        origin = data["origin"],
        found = data["found"] == "true",
        departureGate = data["departureGate"],
        departureTerminal = data["departureTerminal"],
        arrivalGate = data["arrivalGate"],
        arrivalTerminal = data["arrivalTerminal"],
        baggageClaim = data["baggageClaim"],
        scheduledOut = data["scheduledOut"],
        estimatedOut = data["estimatedOut"],
        actualOut = data["actualOut"],
        scheduledIn = data["scheduledIn"],
        estimatedIn = data["estimatedIn"],
        actualIn = data["actualIn"],
        cancelled = data["cancelled"] == "true",
        diverted = data["diverted"] == "true",
        divertedTo = data["divertedTo"],
        noticedOut = data["noticedOut"],
        checkedAt = data["checkedAt"] ?: return null,
    )
    val booking = Segment(
        id = key,
        tripId = "",
        type = SegmentType.FLIGHT,
        title = title,
        start = start,
        end = data["end"],
        destination = data["destination"]?.let { Place(name = it, code = it) },
    )
    return LiveFlightMessage(key, tag, url, status, booking)
}
