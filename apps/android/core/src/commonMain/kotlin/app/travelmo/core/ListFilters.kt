package app.travelmo.core

/** What the trip list leaves out (SPEC "Filtering the trip list"), as set on this phone; nothing by default (listFilters.ts). */
data class ListFilters(val hideCancelled: Boolean = false, val hideLocal: Boolean = false, val hideWatching: Boolean = false) {
    val any: Boolean get() = hideCancelled || hideLocal || hideWatching
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

/** The most travelers a trip keeps, as the stored schema allows (maxTripTravelers in listFilters.ts). */
const val MAX_TRIP_TRAVELERS = 100

/**
 * Whom a trip's bookings are for: every name they give, as people write it ([canonicalName]), each spelling once, going
 * by what is still booked unless nothing is. Spellings stay apart ("J Smith" beside "John Smith") until they're matched
 * to the user's people, who may tell them apart. More than [MAX_TRIP_TRAVELERS] is kept as none, so a trip is never
 * taken for one the user isn't on for want of room for their name.
 */
fun tripTravelers(segments: List<Segment>): List<String> {
    val live = liveSegments(segments)
    val names = live.ifEmpty { segments }.flatMap { it.travelers }.mapNotNull(::canonicalName).distinct()
    return if (names.size > MAX_TRIP_TRAVELERS) emptyList() else names
}

/**
 * Whether the user is only watching a trip: its bookings name travelers and none of them is the user ([guessMe],
 * [findPerson]). Never while who the user is is unknown, nor for a trip whose bookings name no one (watching in
 * listFilters.ts).
 */
fun watching(travelers: List<String>?, people: List<Person>): Boolean {
    val me = guessMe(people) ?: return false
    if (travelers.isNullOrEmpty()) return false
    return travelers.none { findPerson(people, it)?.id == me.id }
}

/**
 * Whether the user is only watching [trip]: by its bookings when they are read ([segments]), else by what the trip
 * keeps of them. What is the user's own (warnings, reminders, check-in, rides, reports, residence, the download,
 * working out home) leaves such a trip out (watchedTrip in listFilters.ts).
 */
fun watchedTrip(trip: Trip, segments: List<Segment>?, people: List<Person>): Boolean =
    watching(segments?.let(::tripTravelers) ?: trip.travelers, people)

/**
 * What the trip list needs of a trip's bookings (for its filters, and [setting] for its picture), kept on the trip
 * so the list goes without reading them: the parser records it as it files bookings, and an app that sees a trip's
 * bookings disagree with it puts it right ([tripFlagsToWrite]), which also fills it in for trips from before it was
 * kept. As listFilters.ts.
 */
data class TripFlags(val allCancelled: Boolean, val localOnly: Boolean, val travelers: List<String>, val setting: String)

fun tripFlags(segments: List<Segment>): TripFlags = TripFlags(allCancelled(segments), localOnly(segments), tripTravelers(segments), tripSetting(segments))

/** The flags to write on a trip whose bookings have just been read, or null when the trip already says so. */
fun tripFlagsToWrite(trip: Trip, segments: List<Segment>): TripFlags? {
    val flags = tripFlags(segments)
    val same = trip.allCancelled == flags.allCancelled && trip.localOnly == flags.localOnly && trip.travelers == flags.travelers && trip.setting == flags.setting
    return if (same) null else flags
}

/** Whether the list needs a trip's bookings to filter it or draw it: only while the trip doesn't yet say. */
fun flagsUnknown(trip: Trip): Boolean =
    trip.allCancelled == null || trip.localOnly == null || trip.travelers == null || trip.setting == null ||
        // A trip of local events kept a town before events took their booking's icon.
        (trip.localOnly == true && tripBookingType(trip.setting) == null)

/**
 * Whether the list leaves a trip out: by its own cancellation and flags, else, for a trip from before the flags
 * were kept, by its bookings once read ([segments]; null until then). [people] are the user's, for whether they're
 * only watching it.
 */
fun hiddenFromList(trip: Trip, segments: List<Segment>?, filters: ListFilters, people: List<Person> = emptyList()): Boolean {
    if (!filters.any) return false
    if (filters.hideCancelled) {
        if (trip.cancelledAt != null) return true
        val cancelled = trip.allCancelled ?: segments?.let(::allCancelled) ?: false
        if (cancelled) return true
    }
    if (filters.hideLocal) {
        val local = trip.localOnly ?: segments?.let(::localOnly) ?: false
        if (local) return true
    }
    if (filters.hideWatching) {
        val travelers = trip.travelers ?: segments?.let(::tripTravelers)
        if (watching(travelers, people)) return true
    }
    return false
}
