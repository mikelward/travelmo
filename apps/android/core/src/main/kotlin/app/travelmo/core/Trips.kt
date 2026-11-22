package app.travelmo.core

// Grouping and what comes next, as packages/core/src/trips.ts does it.

data class TripGroups(val current: List<Trip>, val upcoming: List<Trip>, val past: List<Trip>)

/** Now, upcoming and past by calendar date; past newest first. */
fun groupTrips(trips: List<Trip>, today: String): TripGroups {
    val current = trips.filter { it.start <= today && it.end >= today }.sortedBy { it.start }
    val upcoming = trips.filter { it.start > today }.sortedBy { it.start }
    val past = trips.filter { it.end < today }.sortedByDescending { it.end }
    return TripGroups(current, upcoming, past)
}

enum class EventKind { START, END }

data class UpcomingEvent(val segment: Segment, val kind: EventKind, val at: String)

/**
 * The soonest thing still ahead: a booking's start, or the end of one that is
 * under way (a stay's check-out, a flight's arrival).
 */
fun nextEvent(segments: List<Segment>, now: String): UpcomingEvent? {
    var best: UpcomingEvent? = null
    for (segment in segments) {
        val candidate = when {
            compareInstants(segment.start, now) >= 0 -> UpcomingEvent(segment, EventKind.START, segment.start)
            segment.end != null && compareInstants(segment.end, now) >= 0 -> UpcomingEvent(segment, EventKind.END, segment.end)
            else -> null
        }
        if (candidate != null && (best == null || compareInstants(candidate.at, best.at) < 0)) best = candidate
    }
    return best
}

/** "Departs", "Check-in", "Pick up"… the verb a card leads with. */
fun eventVerb(event: UpcomingEvent): String = when (event.segment.type) {
    SegmentType.FLIGHT, SegmentType.TRAIN, SegmentType.BUS, SegmentType.FERRY ->
        if (event.kind == EventKind.START) "Departs" else "Arrives"
    SegmentType.LODGING -> if (event.kind == EventKind.START) "Check-in" else "Check-out"
    SegmentType.CAR_RENTAL -> if (event.kind == EventKind.START) "Pick up" else "Return"
    SegmentType.ACTIVITY, SegmentType.OTHER -> if (event.kind == EventKind.START) "Starts" else "Ends"
}

/** A trip's bookings in order, grouped under the date each starts. */
fun segmentsByDay(segments: List<Segment>): List<Pair<String, List<Segment>>> =
    segments.sortedWith(compareBy({ instantMillis(it.start) }, { it.title }))
        .groupBy { localDate(it.start) }
        .toSortedMap()
        .map { (date, items) -> date to items }

/** A place as a row names it: the code and the city, or the name. */
fun placeLabel(place: Place?): String? {
    if (place == null) return null
    val where = place.city ?: place.name
    return if (place.code != null) "${place.code} $where" else where
}

/** "EUS London Euston → LIV Liverpool Lime Street", or nothing. */
fun routeLine(segment: Segment): String? =
    listOfNotNull(placeLabel(segment.origin), placeLabel(segment.destination)).takeIf { it.isNotEmpty() }?.joinToString(" → ")

/**
 * An activity with no time of its own: local midnight and no end, the
 * importer's convention for a dated thing with no stated time.
 */
fun isUntimed(segment: Segment): Boolean =
    (segment.type == SegmentType.ACTIVITY || segment.type == SegmentType.OTHER) && segment.end == null && localTime(segment.start) == "00:00"

/**
 * "09:07 – 11:25", or for a stay "Check-in 15:00 · Check-out Sun 13 Dec 11:00";
 * null for an untimed activity. The row sits under its start day's heading,
 * so an end on another day carries its date.
 */
fun timesLine(segment: Segment): String? {
    if (isUntimed(segment)) return null
    val end = segment.end?.let { end ->
        val time = localTime(end)
        if (localDate(end) == localDate(segment.start)) time else "${formatDate(localDate(end))} $time"
    }
    return if (segment.type == SegmentType.LODGING) {
        "Check-in ${localTime(segment.start)}" + (end?.let { " · Check-out $it" } ?: "")
    } else {
        localTime(segment.start) + (end?.let { " – $it" } ?: "")
    }
}

/** "Avanti West Coast · Ref ABC123", or nothing. */
fun referenceLine(segment: Segment): String? =
    listOfNotNull(segment.provider, segment.confirmation?.let { "Ref $it" }).takeIf { it.isNotEmpty() }?.joinToString(" · ")

/**
 * The calendar span of these bookings, both endpoints feeding both bounds
 * (across the date line a flight can land on an earlier local date than it
 * departed); null when there are none.
 */
fun segmentDateRange(segments: List<Segment>): Pair<String, String>? {
    var start: String? = null
    var end: String? = null
    for (segment in segments) {
        for (date in listOf(localDate(segment.start), localDate(trustedEnd(segment)))) {
            if (start == null || date < start) start = date
            if (end == null || date > end) end = date
        }
    }
    return if (start == null || end == null) null else start to end
}

private val journeyTypes = setOf(SegmentType.FLIGHT, SegmentType.TRAIN, SegmentType.BUS, SegmentType.FERRY)

// The longest a journey is believed to take, in days: a week on the
// Trans-Siberian, with a day to spare.
private const val MAX_JOURNEY_DAYS = 8L

// A journey's end more than a week after it leaves is not when it arrives
// (a ticket's expiry, read as its arrival) and never stretches a trip: its
// start stands for both.
private fun trustedEnd(segment: Segment): String {
    val end = segment.end ?: return segment.start
    if (segment.type !in journeyTypes) return end
    val days = java.time.temporal.ChronoUnit.DAYS.between(
        java.time.LocalDate.parse(localDate(segment.start)),
        java.time.LocalDate.parse(localDate(end)),
    )
    return if (days > MAX_JOURNEY_DAYS) segment.start else end
}

/** Whether "Fit dates to bookings" has anything to do: the bookings span less than the trip. */
fun fittedRange(trip: Trip, segments: List<Segment>): Pair<String, String>? =
    segmentDateRange(segments)?.takeIf { it.first != trip.start || it.second != trip.end }

/** The other trips a booking, or a whole trip, can move to: every other trip the viewer sees that is not being deleted, by start. */
fun otherTrips(trips: List<Trip>, tripId: String): List<Trip> =
    trips.filter { it.id != tripId && !it.deleting }.sortedBy { it.start }
