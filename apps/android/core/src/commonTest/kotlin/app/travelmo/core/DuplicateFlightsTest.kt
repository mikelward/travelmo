package app.travelmo.core

import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.shouldBe
import kotlin.test.Test

// Mirrors packages/core/src/duplicateFlights.test.ts.
private val gatwick = Place("Gatwick", code = "LGW", city = "London", country = "GB")
private val dubai = Place("Dubai", code = "DXB", city = "Dubai", country = "AE")
private fun flight(id: String, start: String) = Segment(id, "t", SegmentType.FLIGHT, "XX 10 LGW to DXB", start, origin = gatwick, destination = dubai)

class DuplicateFlightsTest {
    private val taken = flight("a", "2022-12-15T20:25:00+00:00")
    private val old = flight("b", "2022-12-17T21:45:00+00:00")

    @Test
    fun `finds one flight booked on two days near each other`() {
        val pairs = duplicateFlights(listOf(old, taken))
        pairs.map { listOf(it.first.id, it.second.id) } shouldBe listOf(listOf("a", "b"))
        duplicateFlightText(pairs[0]) shouldBe "XX 10 LGW to DXB is booked on 15 Dec and 17 Dec."
        duplicateFlightCancel(old) shouldBe "Mark 17 Dec cancelled"
    }

    @Test
    fun `leaves alone what isn't one flight booked twice`() {
        duplicateFlights(listOf(taken, old.copy(cancelledAt = "2022-12-01T00:00:00Z"))).shouldBeEmpty()
        duplicateFlights(listOf(taken, old.copy(title = "XX 12 LGW to DXB"))).shouldBeEmpty()
        duplicateFlights(listOf(taken, old.copy(destination = dubai.copy(code = "DWC")))).shouldBeEmpty()
        duplicateFlights(listOf(taken, old.copy(start = "2022-12-15T22:00:00+00:00"))).shouldBeEmpty()
        duplicateFlights(listOf(taken, old.copy(start = "2023-01-17T21:45:00+00:00"))).shouldBeEmpty()
    }

    @Test
    fun `asks no more once the owner says both were taken`() {
        duplicateFlights(listOf(taken, old), listOf(duplicateFlightKey(old, taken))).shouldBeEmpty()
    }
}
