package app.travelmo.core

import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import kotlin.test.Test

class DirectionsTest {
    private val stay = Segment(
        "s", "t", SegmentType.LODGING, "Motel Example", "2026-12-12T15:00:00-08:00", "2026-12-13T11:00:00-08:00",
        destination = Place("Motel Example", city = "Las Vegas", country = "US", address = "123 Example Blvd, Las Vegas, NV 89101", lat = 36.17, lon = -115.14),
    )
    private val prefix = "https://www.google.com/maps/dir/?api=1&destination="

    @Test
    fun `a stay leads by its name and address in Google Maps`() {
        directionsUrl(stay) shouldBe prefix + "Motel%20Example%2C%20123%20Example%20Blvd%2C%20Las%20Vegas%2C%20NV%2089101"
    }

    @Test
    fun `without an address the spot on the map else the name and town`() {
        directionsQuery(Place("Motel Example", city = "Las Vegas", lat = 36.17, lon = -115.14)) shouldBe "36.17,-115.14"
        directionsQuery(Place("Motel Example", city = "Las Vegas")) shouldBe "Motel Example, Las Vegas"
        directionsQuery(Place("Las Vegas Motel", city = "Las Vegas")) shouldBe "Las Vegas Motel"
    }

    @Test
    fun `a journey or a car rental leads to where it starts`() {
        val flight = Segment(
            "f", "t", SegmentType.FLIGHT, "XX 100 LHR to LAS", "2026-12-12T09:00:00+00:00",
            origin = Place("London Heathrow", code = "LHR"), destination = Place("Harry Reid International", code = "LAS"),
        )
        directionsPlace(flight)?.name shouldBe "London Heathrow"
        directionsQuery(directionsPlace(flight.copy(type = SegmentType.CAR_RENTAL, origin = Place("Example Cars", address = "1 Airport Rd")))!!) shouldBe "Example Cars, 1 Airport Rd"
    }

    @Test
    fun `none for a cancelled booking or one with no place`() {
        directionsUrl(stay.copy(cancelledAt = "2026-11-01T00:00:00Z")).shouldBeNull()
        directionsUrl(Segment("n", "t", SegmentType.OTHER, "Note", "2026-12-12T09:00:00+00:00")).shouldBeNull()
    }
}
