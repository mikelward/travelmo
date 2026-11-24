package app.travelmo.core

// What a trip card under way says comes next, as packages/core/src/nextUp.ts
// does it, in up to three lines:
//
//   VS 11 LHR to BOS
//   Departs in 2 h 1 min · Tue 24 Nov 17:20
//   Terminal 3 · Gate 12
//
// the booking, when (the verb, how soon, and the date and time as booked),
// and for a flight with live status the next step ([flightNextStep]).

data class NextUp(val segment: Segment, val title: String, val `when`: String, val step: String? = null)

/** Flights booked to have landed by now that may still be under way, while a trip page would show their status. */
private fun mayBeLate(segments: List<Segment>, now: String): List<Segment> =
    segments.filter { it.type == SegmentType.FLIGHT && flightStatusShown(it, now) && instantMillis(it.end ?: it.start) < instantMillis(now) }

/** The flights whose live status the card reads: the next event's, while a trip page would show it, and any booked to have landed that may be late. */
fun nextUpFlightKeys(segments: List<Segment>, now: String): List<String> {
    val event = nextEvent(segments, now)
    val flights = mayBeLate(segments, now) + listOfNotNull(event?.segment?.takeIf { flightStatusShown(it, now) })
    return flights.mapNotNull { flightStatusKey(it) }.distinct()
}

private fun statusOf(segment: Segment, statuses: Map<String, FlightStatus>, now: String): FlightStatus? {
    if (!flightStatusShown(segment, now)) return null
    val key = flightStatusKey(segment) ?: return null
    return statuses[key]?.takeIf { it.found }
}

/**
 * The next event, a flight's moved to its arrival once it has taken off and kept at its departure while it is late leaving.
 * A flight booked to have landed already that the service says has not (no arrival yet, one expected after now) is still the
 * card's event, under way or late leaving.
 */
private fun cardEvent(segments: List<Segment>, now: String, statuses: Map<String, FlightStatus>): UpcomingEvent? {
    val late = mayBeLate(segments, now).filter { s ->
        val live = statusOf(s, statuses, now)
        val arrives = live?.estimatedIn ?: live?.estimatedOut
        live != null && !live.cancelled && live.actualIn == null && arrives != null && instantMillis(arrives) > instantMillis(now)
    }.minByOrNull { instantMillis(it.start) }
    val event = late?.let { UpcomingEvent(it, EventKind.END, it.end ?: it.start) } ?: nextEvent(segments, now) ?: return null
    if (event.segment.type != SegmentType.FLIGHT) return event
    val segment = event.segment
    if (!flightDeparted(segment, statusOf(segment, statuses, now), now)) return UpcomingEvent(segment, EventKind.START, segment.start)
    return segment.end?.let { UpcomingEvent(segment, EventKind.END, it) } ?: event
}

/** When the event is expected, in its place's offset: a flight's estimate where the service gives one, else as booked. */
private fun expected(event: UpcomingEvent, status: FlightStatus?): String {
    if (status == null || status.cancelled) return event.at
    val estimate = if (event.kind == EventKind.START) status.estimatedOut.takeIf { status.actualOut == null } else status.actualIn ?: status.estimatedIn
    return estimate?.let { shiftInstant(event.at, instantMillis(it) - instantMillis(event.at)) } ?: event.at
}

/** The card's lines for what comes next, or null when nothing does; [statuses] are the live flight statuses by key ([nextUpFlightKeys]). */
fun tripNextUp(segments: List<Segment>, now: String, statuses: Map<String, FlightStatus> = emptyMap()): NextUp? {
    val event = cardEvent(segments, now, statuses) ?: return null
    val status = statusOf(event.segment, statuses, now)
    // "on Fri" says no more than the date after it.
    val soon = relativeTime(now, expected(event, status))?.takeUnless { it.startsWith("on ") }?.let { " $it ·" } ?: ""
    val `when` = "${eventVerb(event)}$soon ${formatDate(localDate(event.at))} ${localTime(event.at)}"
    return NextUp(event.segment, event.segment.title, `when`, status?.let { flightNextStep(it, event.segment, now) })
}
