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
    /** How many emails, TripIt trips or calendar events it was read from. */
    val sourceCount: Int = 0,
)

data class Trip(
    val id: String,
    val title: String,
    /** Calendar dates, yyyy-mm-dd. */
    val start: String,
    val end: String,
    val ownerUid: String,
    val sharedWith: List<String> = emptyList(),
    val deleting: Boolean = false,
)

/**
 * An address as the data stores it: trimmed and lowercase. Shared-with
 * lists hold lowercase addresses and the rules compare against the token's
 * lowercased email, so a query with the account's own casing finds nothing.
 */
fun normalizeEmail(email: String?): String? = email?.trim()?.lowercase()?.takeIf { it.isNotEmpty() }
