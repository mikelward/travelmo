package app.travelmo.core

// The places the traveler rated or marked as favorites, gathered across
// their trips for the reports page, as packages/core/src/favorites.ts: one
// entry per place (by name and country), with the best rating given to it
// and every trip it was on.

data class FavoriteTrip(val id: String, val title: String, val start: String)

data class FavoritePlace(
    val name: String,
    val city: String?,
    val country: String?,
    val type: SegmentType,
    val favorite: Boolean,
    val rating: Int?,
    /** Latest first. */
    val trips: List<FavoriteTrip>,
)

data class TripWithBookings(val trip: Trip, val segments: List<Segment>)

/** The place a booking is "at": where it ends for a journey, where it is for a stay or activity; the booking's title when it names no place. */
fun bookingPlace(segment: Segment): Place = segment.destination ?: segment.origin ?: Place(segment.title)

private fun placeKey(p: Place) = "${p.name.trim().lowercase()}|${p.country?.uppercase() ?: ""}"

/**
 * Favorites first, then the best rated, then by name. A place rated on two
 * trips keeps the higher rating, and links every trip it was booked on,
 * rated there or not; a place never rated or marked is left out. The same
 * trip listed twice (owned and shared) counts once.
 */
fun favoritePlaces(all: List<TripWithBookings>): List<FavoritePlace> {
    val byPlace = LinkedHashMap<String, FavoritePlace>()
    val seen = mutableSetOf<String>()
    for ((trip, segments) in all) {
        if (!seen.add(trip.id)) continue
        for (s in segments) {
            val place = bookingPlace(s)
            val key = placeKey(place)
            val entry = byPlace[key] ?: FavoritePlace(place.name, place.city, place.country?.uppercase(), s.type, favorite = false, rating = null, trips = emptyList())
            val rating = listOfNotNull(entry.rating, s.rating).maxOrNull()
            val trips = if (entry.trips.any { it.id == trip.id }) entry.trips else entry.trips + FavoriteTrip(trip.id, trip.title, trip.start)
            byPlace[key] = entry.copy(favorite = entry.favorite || s.favorite, rating = rating, trips = trips)
        }
    }
    return byPlace.values
        .filter { it.favorite || it.rating != null }
        .map { it.copy(trips = it.trips.sortedByDescending { t -> t.start }) }
        .sortedWith(compareByDescending<FavoritePlace> { it.favorite }.thenByDescending { it.rating ?: 0 }.thenBy { it.name })
}
