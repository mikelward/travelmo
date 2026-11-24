package app.travelmo.core

/** What the trip list leaves out (SPEC "Filtering the trip list"), as set on this phone; nothing by default (listFilters.ts). */
data class ListFilters(val hideCancelled: Boolean = false, val hideLocal: Boolean = false) {
    val any: Boolean get() = hideCancelled || hideLocal
}

/** An outing: a ticket, an event or a car hired and returned in one place; nothing that travels or stays (isOuting in home.ts). */
fun isOuting(segment: Segment): Boolean =
    (segment.type == SegmentType.ACTIVITY || segment.type == SegmentType.OTHER || segment.type == SegmentType.CAR_RENTAL) && !isTransfer(segment)

/**
 * A trip of local events alone: everything still booked in it is an outing.
 * One with nothing booked is not: where it goes is unknown.
 */
fun localOnly(segments: List<Segment>): Boolean {
    val live = liveSegments(segments)
    return live.isNotEmpty() && live.all(::isOuting)
}

/** Whether the list leaves a trip out. Until its bookings are read ([segments] null) only the trip's own cancellation can tell. */
fun hiddenFromList(trip: Trip, segments: List<Segment>?, filters: ListFilters): Boolean {
    if (filters.hideCancelled && tripCancelled(trip, segments)) return true
    return filters.hideLocal && segments != null && localOnly(segments)
}
