package app.travelmo.core

import io.kotest.matchers.shouldBe
import kotlin.test.Test

class TripSearchTest {
    private val lisbon = Trip("t1", "Portugal", "2025-03-28", "2025-04-02", ownerUid = "u")
    private val stay = Segment(
        id = "s1", tripId = "t1", type = SegmentType.LODGING, title = "Hotel Avenida", start = "2025-03-28T15:00:00+00:00",
        provider = "Hilton", confirmation = "HX-4410", destination = Place("Hotel Avenida", city = "Lisboa", country = "PT"),
    )
    private val flight = Segment(
        id = "s2", tripId = "t1", type = SegmentType.FLIGHT, title = "BA 500 London to Lisbon", start = "2025-03-28T08:00:00+00:00",
        provider = "British Airways",
        origin = Place("Heathrow", code = "LHR", city = "London", country = "GB"),
        destination = Place("Humberto Delgado", code = "LIS", city = "Lisbon", country = "PT"),
    )

    private fun matches(text: String, segments: List<Segment> = listOf(stay, flight), trip: Trip = lisbon) =
        tripMatches(parseTripQuery(text), trip, trip.title, segments)

    @Test
    fun `reads words and a year or month or day in any common form`() {
        parseTripQuery("Lisbon 2025") shouldBe TripQuery(listOf("lisbon"), year = 2025)
        parseTripQuery("March 2025") shouldBe TripQuery(emptyList(), year = 2025, month = 3)
        parseTripQuery("12 Dec 2025") shouldBe TripQuery(emptyList(), year = 2025, month = 12, day = 12)
        parseTripQuery("sept 3rd") shouldBe TripQuery(emptyList(), month = 9, day = 3)
        parseTripQuery("2025-12-12") shouldBe TripQuery(emptyList(), year = 2025, month = 12, day = 12)
        parseTripQuery("VS 11") shouldBe TripQuery(listOf("vs", "11"))
        parseTripQuery("2025-13") shouldBe TripQuery(listOf("2025", "13"))
        parseTripQuery("2025-00-01") shouldBe TripQuery(listOf("2025", "00", "01"))
        tripMatches(parseTripQuery("2025-13"), lisbon, "Portugal", emptyList()) shouldBe false
        parseTripQuery("  ").isEmpty shouldBe true
    }

    @Test
    fun `finds a trip by its bookings' providers and places and codes and references`() {
        for (text in listOf("portugal", "hilton", "lisbon", "Lisboa", "LIS", "heathrow", "british", "hx 4410", "lisb")) matches(text) shouldBe true
        matches("madrid") shouldBe false
        matches("ba", listOf(stay)) shouldBe false
        matches("ba", listOf(flight)) shouldBe true
        matches("hilton lisbon") shouldBe true
        matches("hilton madrid") shouldBe false
        matches("LISBÓA") shouldBe true
    }

    @Test
    fun `finds a trip under way during a year or a month of any year or a day`() {
        matches("2025") shouldBe true
        matches("2024") shouldBe false
        matches("april") shouldBe true
        matches("march 2025") shouldBe true
        matches("may") shouldBe false
        matches("1 April 2025") shouldBe true
        matches("3 April 2025") shouldBe false
        matches("madrid april") shouldBe false
        val newYear = Trip("t2", "Edinburgh", "2025-12-30", "2026-01-02", ownerUid = "u")
        for (text in listOf("2026", "december", "january")) matches(text, emptyList(), newYear) shouldBe true
        matches("march", emptyList(), lisbon.copy(liveStart = "2025-04-01", liveEnd = "2025-04-02")) shouldBe false
    }
}
