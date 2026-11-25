package app.travelmo.core

// The documents as Firestore holds them (SPEC.md "Data model"): ISO strings
// for every instant, in the offset of the place it happens in. The web app's
// packages/core/src/schema.ts is the reference; what is read here is what
// the screens show.

/** A booking's kind, by its wire name. */
enum class SegmentType(val wire: String, val label: String) {
    FLIGHT("flight", "Flight"),
    TRAIN("train", "Train"),
    BUS("bus", "Bus"),
    FERRY("ferry", "Ferry"),
    LODGING("lodging", "Stay"),
    CAR_RENTAL("car_rental", "Car"),
    ACTIVITY("activity", "Activity"),
    OTHER("other", "Other");

    companion object {
        fun fromWire(wire: String?): SegmentType? = entries.firstOrNull { it.wire == wire }
    }
}

data class Place(
    val name: String,
    val code: String? = null,
    val city: String? = null,
    val country: String? = null,
    val address: String? = null,
    /** The spot on the map, when the booking's source or a geocode gave one. */
    val lat: Double? = null,
    val lon: Double? = null,
    /** What kind of place it is ([PLACE_SETTINGS]), as the email showed or the reader knew. */
    val setting: String? = null,
)

data class Segment(
    val id: String,
    val tripId: String,
    val type: SegmentType,
    val title: String,
    /** An ISO instant with an offset, e.g. 2026-12-13T09:00:00+05:00. */
    val start: String,
    val end: String? = null,
    val provider: String? = null,
    val confirmation: String? = null,
    val origin: Place? = null,
    val destination: Place? = null,
    val notes: String? = null,
    val sender: String? = null,
    val rating: Int? = null,
    val favorite: Boolean = false,
    /** The emails, TripIt trips and calendar events it was read from, oldest first ([segmentSources]). */
    val sources: List<SourceRef> = emptyList(),
    /**
     * When a cancellation email was matched to it. A cancelled booking stays on
     * its trip but counts for nothing: not the trip's dates, what's next,
     * check-in, reminders or reports.
     */
    val cancelledAt: String? = null,
    /** The id of the cancellation email that cancelled it. */
    val cancelledBy: String? = null,
    /**
     * Set with [cancelledAt] when the person, not an email, said it didn't
     * happen: "booking" for this booking alone, "trip" when its whole trip was
     * cancelled. No email revives it; only Restore does.
     */
    val userCancelled: String? = null,
    /** Who it is for, as people write their names (SPEC "Travelers"); empty when its emails named nobody. */
    val travelers: List<String> = emptyList(),
)

val Segment.isCancelled: Boolean get() = cancelledAt != null

fun liveSegments(segments: List<Segment>): List<Segment> = segments.filter { !it.isCancelled }

/**
 * A trip whose every booking was cancelled isn't happening: no document
 * warnings, reminders or report counts for it. A trip with no bookings yet is
 * still a trip.
 */
fun allCancelled(segments: List<Segment>): Boolean = segments.isNotEmpty() && segments.all { it.isCancelled }

/**
 * A trip that isn't happening: its owner cancelled it, or every booking in it
 * was cancelled. One with no bookings yet still is, unless cancelled.
 */
fun tripCancelled(trip: Trip, segments: List<Segment>? = null): Boolean =
    // Before its bookings are read, the trip's own flag says.
    trip.cancelledAt != null || (if (segments != null) allCancelled(segments) else trip.allCancelled == true)

/**
 * A booking as it stands in a trip cancelled at [tripCancelledAt] (null for
 * one that isn't), for a write that puts it there: a live booking in a
 * cancelled trip is cancelled with it; one cancelled only with its trip is
 * live again in a trip that isn't (inTrip in packages/core).
 */
fun inTrip(segment: Segment, tripCancelledAt: String?, now: String): Segment = when {
    tripCancelledAt != null && !segment.isCancelled -> segment.copy(cancelledAt = now, userCancelled = "trip")
    tripCancelledAt == null && segment.userCancelled == "trip" -> segment.copy(cancelledAt = null, userCancelled = null)
    else -> segment
}

data class Trip(
    val id: String,
    val title: String,
    /** Calendar dates, yyyy-mm-dd. */
    val start: String,
    val end: String,
    val ownerUid: String,
    val sharedWith: List<String> = emptyList(),
    val deleting: Boolean = false,
    /** When the person now travels, once cancellations narrowed it (liveBounds in packages/core). */
    val liveStart: String? = null,
    val liveEnd: String? = null,
    /** When the owner marked the whole trip cancelled: it didn't happen. */
    val cancelledAt: String? = null,
    /** What the list's filters need of its bookings ([TripFlags]); null on a trip from before they were kept. */
    val allCancelled: Boolean? = null,
    val localOnly: Boolean? = null,
    /** Whom its bookings are for ([tripTravelers]); null on a trip from before it was kept. */
    val travelers: List<String>? = null,
    /** What kind of place it goes to, for its picture ([tripSetting]): one of [PLACE_SETTINGS] or "none"; null on a trip from before it was kept. */
    val setting: String? = null,
)

/**
 * What is wrong with a trip planned by hand (Add a trip), or null: it needs
 * a name and its dates, the end not before the start (tripDraftProblem in
 * packages/core).
 */
fun tripDraftProblem(title: String, start: String?, end: String?): String? = when {
    title.isBlank() -> "Give the trip a name"
    start == null || end == null -> "Pick its dates"
    end < start -> "It ends before it starts"
    else -> null
}

/** The dates a trip is shown with: when the person now travels, else its own (displayBounds). */
fun displayBounds(trip: Trip): Pair<String, String> =
    if (trip.liveStart != null && trip.liveEnd != null) trip.liveStart to trip.liveEnd else trip.start to trip.end

val Trip.shownStart: String get() = displayBounds(this).first
val Trip.shownEnd: String get() = displayBounds(this).second

/**
 * The trip once bookings are in it, as the web's edits do: its own dates
 * widen to cover every one, cancelled ones too (`booked`); the dates it is
 * shown with widen only for those still booked (`live`), and are kept apart
 * only while they differ. Nothing narrows here.
 */
fun widenedFor(trip: Trip, booked: Pair<String, String>, live: Pair<String, String>?): Trip {
    val start = minOf(trip.start, booked.first)
    val end = maxOf(trip.end, booked.second)
    val shown = displayBounds(trip)
    val liveStart = if (live != null) minOf(shown.first, live.first) else shown.first
    val liveEnd = if (live != null) maxOf(shown.second, live.second) else shown.second
    return if (liveStart == start && liveEnd == end) trip.copy(start = start, end = end, liveStart = null, liveEnd = null)
    else trip.copy(start = start, end = end, liveStart = liveStart, liveEnd = liveEnd)
}

/**
 * An address as the data stores it: trimmed and lowercase. Shared-with
 * lists hold lowercase addresses and the rules compare against the token's
 * lowercased email, so a query with the account's own casing finds nothing.
 */
fun normalizeEmail(email: String?): String? = email?.trim()?.lowercase()?.takeIf { it.isNotEmpty() }
