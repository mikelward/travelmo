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

/**
 * What the trip list's filters need of a trip's bookings, kept on the trip so the list filters without reading
 * them: the parser records it as it files bookings, and an app that sees a trip's bookings disagree with it puts it
 * right ([tripFlagsToWrite]), which also fills it in for trips from before it was kept. As listFilters.ts.
 */
data class TripFlags(val allCancelled: Boolean, val localOnly: Boolean)

fun tripFlags(segments: List<Segment>): TripFlags = TripFlags(allCancelled(segments), localOnly(segments))

/** The flags to write on a trip whose bookings have just been read, or null when the trip already says so. */
fun tripFlagsToWrite(trip: Trip, segments: List<Segment>): TripFlags? {
    val flags = tripFlags(segments)
    return if (trip.allCancelled == flags.allCancelled && trip.localOnly == flags.localOnly) null else flags
}

/** Whether the list needs a trip's bookings to filter it: only while the trip doesn't yet say. */
fun flagsUnknown(trip: Trip): Boolean = trip.allCancelled == null || trip.localOnly == null

/**
 * Whether the list leaves a trip out: by its own cancellation and flags, else, for a trip from before the flags
 * were kept, by its bookings once read ([segments]; null until then).
 */
fun hiddenFromList(trip: Trip, segments: List<Segment>?, filters: ListFilters): Boolean {
    val read = segments?.let(::tripFlags)
    if (filters.hideCancelled && (trip.cancelledAt != null || (trip.allCancelled ?: read?.allCancelled ?: false))) return true
    return filters.hideLocal && (trip.localOnly ?: read?.localOnly ?: false)
}
