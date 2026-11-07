package app.travelmo.core

import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test

class FavoritesTest {
    private fun booking(id: String, type: SegmentType = SegmentType.LODGING, title: String = id, origin: Place? = null, destination: Place? = null, rating: Int? = null, favorite: Boolean = false) =
        Segment(id, "t", type, title, "2026-05-01T15:00:00+02:00", origin = origin, destination = destination, rating = rating, favorite = favorite)

    private val cove = Place("Cove Liverpool", city = "Liverpool", country = "GB")

    @Test
    fun `a booking's place is where a journey ends, where a stay is, or its title`() {
        bookingPlace(booking("f", SegmentType.FLIGHT, "XX 1", origin = Place("A"), destination = Place("B"))) shouldBe Place("B")
        bookingPlace(booking("s", destination = cove)) shouldBe cove
        bookingPlace(booking("w", SegmentType.ACTIVITY, "Walking tour")) shouldBe Place("Walking tour")
    }

    @Test
    fun `gathers rated and favorite places once each, favorites first, best rating kept, every trip linked, latest first`() {
        val t1 = Trip("t1", "Liverpool", "2026-05-01", "2026-05-03", "u")
        val t0 = Trip("t0", "Liverpool first", "2025-03-01", "2025-03-03", "u")
        val t2 = Trip("t2", "Liverpool again", "2026-09-01", "2026-09-03", "u")
        val trips = listOf(
            TripWithBookings(t1, listOf(booking("s1", destination = cove, rating = 3), booking("s2", title = "Unrated", destination = Place("Elsewhere")))),
            // The same hotel again, unrated this time: still one of its trips.
            TripWithBookings(t0, listOf(booking("s0", destination = cove))),
            TripWithBookings(
                t2,
                listOf(
                    booking("s3", destination = cove.copy(name = "cove liverpool"), rating = 5, favorite = true),
                    booking("s4", SegmentType.ACTIVITY, "Anfield tour", destination = Place("Anfield", country = "GB"), rating = 4),
                    booking("s5", SegmentType.FLIGHT, "XX 2 LHR to JFK", origin = Place("Heathrow", code = "LHR"), destination = Place("JFK", code = "JFK", country = "US"), favorite = true),
                ),
            ),
            // The same trip listed twice (owned and shared) counts once.
            TripWithBookings(t2, listOf(booking("s3", destination = cove, rating = 5, favorite = true))),
        )
        favoritePlaces(trips) shouldBe listOf(
            FavoritePlace(
                "Cove Liverpool", "Liverpool", "GB", SegmentType.LODGING, favorite = true, rating = 5,
                trips = listOf(FavoriteTrip("t2", "Liverpool again", "2026-09-01"), FavoriteTrip("t1", "Liverpool", "2026-05-01"), FavoriteTrip("t0", "Liverpool first", "2025-03-01")),
            ),
            FavoritePlace("JFK", null, "US", SegmentType.FLIGHT, favorite = true, rating = null, trips = listOf(FavoriteTrip("t2", "Liverpool again", "2026-09-01"))),
            FavoritePlace("Anfield", null, "GB", SegmentType.ACTIVITY, favorite = false, rating = 4, trips = listOf(FavoriteTrip("t2", "Liverpool again", "2026-09-01"))),
        )
        favoritePlaces(emptyList()) shouldBe emptyList()
    }
}
