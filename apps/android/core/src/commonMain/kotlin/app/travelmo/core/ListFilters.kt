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
 * taken for one the user isn't on for want of room for their name. Names the owner took off the trip ([removed],
 * [Trip.removedTravelers]) are left out, however a booking spells them.
 */
fun tripTravelers(segments: List<Segment>, removed: List<String> = emptyList()): List<String> {
    val live = liveSegments(segments)
    val gone = removed.mapNotNull(::canonicalName).toSet()
    val names = live.ifEmpty { segments }.flatMap { it.travelers }.mapNotNull(::canonicalName).distinct().filter { it !in gone }
    return if (names.size > MAX_TRIP_TRAVELERS) emptyList() else names
}

/**
 * Every name a trip's bookings give, those the owner took off too, as the Travelers… dialog lists them: what is still
 * booked first, then the rest (namedTravelers in listFilters.ts).
 */
fun namedTravelers(segments: List<Segment>, removed: List<String> = emptyList()): List<String> {
    val live = liveSegments(segments)
    val all = (live + segments.filter { it !in live }).flatMap { it.travelers }
    return (all + removed).mapNotNull(::canonicalName).distinct()
}

/**
 * Whether the user is only watching a trip: its bookings name travelers and none of them is the user ([guessMe],
 * [findPerson]). Never while who the user is is unknown, nor for a trip whose bookings name no one, unless the owner
 * took the user off it ([removed]): a printout that named them wrongly (watching in listFilters.ts).
 */
fun watching(travelers: List<String>?, people: List<Person>, removed: List<String> = emptyList()): Boolean {
    val me = guessMe(people) ?: return false
    val isMe = { t: String -> findPerson(people, t)?.id == me.id }
    if (travelers.orEmpty().any(isMe)) return false
    if (removed.any(isMe)) return true
    return !travelers.isNullOrEmpty()
}

/**
 * Whether the user is only watching [trip]: by its bookings when they are read ([segments]), else by what the trip
 * keeps of them. What is the user's own (warnings, reminders, check-in, rides, reports, residence, the download,
 * working out home) leaves such a trip out (watchedTrip in listFilters.ts).
 */
fun watchedTrip(trip: Trip, segments: List<Segment>?, people: List<Person>): Boolean =
    watching(segments?.let { tripTravelers(it, trip.removedTravelers) } ?: trip.travelers, people, trip.removedTravelers)

/**
 * What the trip list needs of a trip's bookings (for its filters, and [setting] for its picture), kept on the trip
 * so the list goes without reading them: the parser records it as it files bookings, and an app that sees a trip's
 * bookings disagree with it puts it right ([tripFlagsToWrite]), which also fills it in for trips from before it was
 * kept. As listFilters.ts.
 */
data class TripFlags(val allCancelled: Boolean, val localOnly: Boolean, val travelers: List<String>, val setting: String)

fun tripFlags(segments: List<Segment>, removed: List<String> = emptyList()): TripFlags =
    TripFlags(allCancelled(segments), localOnly(segments), tripTravelers(segments, removed), tripSetting(segments))

/** The flags to write on a trip whose bookings have just been read, or null when the trip already says so. */
fun tripFlagsToWrite(trip: Trip, segments: List<Segment>): TripFlags? {
    val flags = tripFlags(segments, trip.removedTravelers)
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
        val travelers = trip.travelers ?: segments?.let { tripTravelers(it, trip.removedTravelers) }
        if (watching(travelers, people, trip.removedTravelers)) return true
    }
    return false
}
