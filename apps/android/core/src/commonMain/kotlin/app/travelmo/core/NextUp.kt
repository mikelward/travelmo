package app.travelmo.core

// What a trip card under way says comes next, as packages/core/src/nextUp.ts
// does it, in up to three lines:
//
//   VS 11 LHR to BOS
//   Departs in 2 h 1 min · Tue 24 Nov 17:20
//   Terminal 3 · Gate 12
//
// the booking, when (the verb, how soon, and the date and time as booked),
// and for a flight with live status the next step ([flightNextStep]). For an
// hour after a flight lands, the card stays on it, the step giving its gate
// and carousel, and a fourth line says what comes next:
//
//   VS 11 LHR to BOS
//   Landed 12 min ago · Tue 24 Nov 20:30
//   Terminal E · Gate B5 · Bags on carousel 7
//   Then Hertz at Boston Logan · Pick up Tue 24 Nov 20:15

/** [then]: in the hour after a landing, what comes after the flight landed ("Then Hertz at Boston Logan · Pick up Tue 24 Nov 20:15"). */
data class NextUp(val segment: Segment, val title: String, val `when`: String, val step: String? = null, val then: String? = null)

/** Flights that may be under way: booked to have left by now, while a trip page would show their status. */
private fun mayBeUnderWay(segments: List<Segment>, now: String): List<Segment> =
    segments.filter { it.type == SegmentType.FLIGHT && flightStatusShown(it, now) && instantMillis(it.start) <= instantMillis(now) }

/**
 * The flights whose live status the card reads: the next event's, and that of the next event after any booked to have left (a
 * connection, which an early landing puts on the card before the booked arrival passes), while a trip page would show it; and
 * any booked to have left that may be under way.
 */
fun nextUpFlightKeys(segments: List<Segment>, now: String): List<String> {
    val underWay = mayBeUnderWay(segments, now)
    val events = listOf(nextEvent(segments, now), nextEvent(segments.filter { it !in underWay }, now))
    val flights = underWay + events.mapNotNull { e -> e?.segment?.takeIf { flightStatusShown(it, now) } }
    return flights.mapNotNull { flightStatusKey(it) }.distinct()
}

private fun statusOf(segment: Segment, statuses: Map<String, FlightStatus>, now: String): FlightStatus? {
    if (!flightStatusShown(segment, now)) return null
    val key = flightStatusKey(segment) ?: return null
    return statuses[key]?.takeIf { it.found }
}

/** When a flight that has taken off lands: the service's landing, else its estimate, else as booked. */
private fun landsAt(segment: Segment, status: FlightStatus?): String? = status?.actualIn ?: status?.estimatedIn ?: segment.end

private fun landed(segment: Segment, status: FlightStatus?, now: String): Boolean =
    landsAt(segment, status)?.let { instantMillis(it) <= instantMillis(now) } ?: false

/**
 * A flight the card stays on whatever else is booked before it is done: one late leaving past its booked time, and one in the
 * air until it lands (a car booked for the scheduled landing waits for the real one). The earliest such flight, if any.
 */
private fun heldEvent(segments: List<Segment>, now: String, statuses: Map<String, FlightStatus>): UpcomingEvent? =
    segments
        .filter { it.type == SegmentType.FLIGHT && flightStatusShown(it, now) && (instantMillis(it.start) <= instantMillis(now) || flightDeparted(it, statusOf(it, statuses, now), now)) }
        .mapNotNull { s ->
            val live = statusOf(s, statuses, now)
            when {
                live?.cancelled == true -> null
                !flightDeparted(s, live, now) -> UpcomingEvent(s, EventKind.START, s.start)
                // With no arrival time at all, booked or live, there is no telling when it lands: held no longer than its departure.
                landsAt(s, live) == null || landed(s, live, now) -> null
                else -> UpcomingEvent(s, EventKind.END, s.end ?: s.start)
            }
        }
        .minByOrNull { instantMillis(it.segment.start) }

/** How long after landing the card keeps to it: what waited on the landing, and the gate and carousel. */
private const val AFTER_LANDING = 60 * 60_000L

private class CardEvent(val event: UpcomingEvent, val then: UpcomingEvent? = null)

/** The next event, a flight's moved to its arrival once it has taken off and kept at its departure while it is late leaving. */
private fun upcoming(segments: List<Segment>, now: String, statuses: Map<String, FlightStatus>): UpcomingEvent? {
    val event = nextEvent(segments, now) ?: return null
    if (event.segment.type != SegmentType.FLIGHT) return event
    val segment = event.segment
    if (!flightDeparted(segment, statusOf(segment, statuses, now), now)) return UpcomingEvent(segment, EventKind.START, segment.start)
    return segment.end?.let { UpcomingEvent(segment, EventKind.END, it) } ?: event
}

/**
 * The hour after a flight lands (the latest to have landed, if several). What was booked to start while it was in the air (a car
 * to pick up at the scheduled landing) has not happened yet, and comes next before anything else. While the service has news of
 * the flight, the card stays on it, for its gate and carousel, with what comes next after it; without, what waited on the landing
 * is the card's.
 */
private fun afterLanding(segments: List<Segment>, now: String, statuses: Map<String, FlightStatus>): CardEvent? {
    val at = instantMillis(now)
    val live = { s: Segment -> statusOf(s, statuses, now) }
    val flight = segments
        .filter { f -> f.type == SegmentType.FLIGHT && flightStatusShown(f, now) && live(f)?.cancelled != true && landed(f, live(f), now) }
        .filter { f -> at < instantMillis(landsAt(f, live(f))!!) + AFTER_LANDING }
        .maxByOrNull { f -> instantMillis(landsAt(f, live(f))!!) } ?: return null
    val lands = instantMillis(landsAt(flight, live(flight))!!)
    val waiting = segments
        .filter { s ->
            val starts = instantMillis(s.start)
            s.type != SegmentType.FLIGHT && !s.isCancelled && starts >= instantMillis(flight.start) && starts <= lands && starts <= at
        }
        .minByOrNull { instantMillis(it.start) }
    // The flight landed is done, though its booked arrival may be to come.
    val next = waiting?.let { UpcomingEvent(it, EventKind.START, it.start) } ?: upcoming(segments.filter { it !== flight }, now, statuses)
    if (live(flight) != null) return CardEvent(UpcomingEvent(flight, EventKind.END, flight.end ?: flight.start), next)
    return waiting?.let { CardEvent(next!!) }
}

/** What the card is about: a flight under way ([heldEvent]), then the hour after a landing ([afterLanding]), then the next event. */
private fun cardEvent(segments: List<Segment>, now: String, statuses: Map<String, FlightStatus>): CardEvent? {
    heldEvent(segments, now, statuses)?.let { return CardEvent(it) }
    afterLanding(segments, now, statuses)?.let { return it }
    return upcoming(segments, now, statuses)?.let { CardEvent(it) }
}

/** "12 min ago", or "1 h 5 min ago": how long since a past instant. */
private fun ago(now: String, at: String): String {
    val minutes = maxOf(1L, roundHalfUp((instantMillis(now) - instantMillis(at)) / 60_000.0))
    if (minutes < 60) return "$minutes min ago"
    val rest = minutes % 60
    return "${minutes / 60} h${if (rest != 0L) " $rest min" else ""} ago"
}

/** When the event is expected, in its place's offset: a flight's estimate where the service gives one, else as booked. */
private fun expected(event: UpcomingEvent, status: FlightStatus?): String {
    if (status == null || status.cancelled) return event.at
    val estimate = if (event.kind == EventKind.START) status.estimatedOut.takeIf { status.actualOut == null } else status.actualIn ?: status.estimatedIn
    return estimate?.let { shiftInstant(event.at, instantMillis(it) - instantMillis(event.at)) } ?: event.at
}

/** When an event happens: the verb, how soon, and the date and time as booked; a flight's landing once it has landed. */
private fun whenLine(event: UpcomingEvent, status: FlightStatus?, now: String): String {
    val booked = "${formatDate(localDate(event.at))} ${localTime(event.at)}"
    val at = expected(event, status)
    if (event.segment.type == SegmentType.FLIGHT && event.kind == EventKind.END && instantMillis(at) <= instantMillis(now)) return "Landed ${ago(now, at)} · $booked"
    // "on Fri" says no more than the date after it.
    val soon = relativeTime(now, at)?.takeUnless { it.startsWith("on ") }?.let { " $it ·" } ?: ""
    return "${eventVerb(event)}$soon $booked"
}

/** The card's lines for what comes next, or null when nothing does; [statuses] are the live flight statuses by key ([nextUpFlightKeys]). */
fun tripNextUp(segments: List<Segment>, now: String, statuses: Map<String, FlightStatus> = emptyMap()): NextUp? {
    val card = cardEvent(segments, now, statuses) ?: return null
    val event = card.event
    val status = statusOf(event.segment, statuses, now)
    val then = card.then?.let { next ->
        // A flight next, a connection say, with its own gate.
        val nextStatus = statusOf(next.segment, statuses, now)
        listOfNotNull("Then ${next.segment.title}", whenLine(next, nextStatus, now), nextStatus?.let { flightNextStep(it, next.segment, now) }).joinToString(" · ")
    }
    return NextUp(event.segment, event.segment.title, whenLine(event, status, now), status?.let { flightNextStep(it, event.segment, now) }, then)
}
