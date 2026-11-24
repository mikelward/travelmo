package app.travelmo.core

// "I've checked in", as packages/core/src/checkedIn.ts has it: the flights a
// person says they checked in for, theirs alone, one document per trip
// (`users/{uid}/checkedIn/{tripId}`, a list of booking ids). A mark stops the
// card's check-in line and the parser's check-in reminders for that person;
// on a shared trip it is the viewer's own.

/** At most this many bookings marked on one trip, as the rules bound it. */
const val MAX_CHECKED_IN = 100

/** The stored ids that are ids, as the web's schema keeps them. */
fun checkedInOf(stored: List<*>?): List<String> =
    stored.orEmpty().filterIsInstance<String>().filter { it.isNotEmpty() && it.length <= 200 }

/** The stored list with a booking marked or unmarked: each id once, the newest last, the oldest dropped past the limit. */
fun withCheckedIn(ids: List<String>, id: String, checkedIn: Boolean): List<String> {
    val rest = ids.filter { it != id }
    return (if (checkedIn) rest + id else rest).takeLast(MAX_CHECKED_IN)
}

enum class FlightCheckIn { OFFER, DONE }

/**
 * What a flight on the trip page offers: "I've checked in" from when online check-in usually opens
 * until departure, then "Checked in" with an undo once marked, until departure; null otherwise.
 */
fun flightCheckInState(segment: Segment, checked: Set<String>, now: String): FlightCheckIn? {
    if (segment.type != SegmentType.FLIGHT || segment.isCancelled) return null
    val at = instantMillis(now)
    if (at >= instantMillis(segment.start)) return null
    if (segment.id in checked) return FlightCheckIn.DONE
    return if (at >= instantMillis(checkInOpensAt(segment))) FlightCheckIn.OFFER else null
}
