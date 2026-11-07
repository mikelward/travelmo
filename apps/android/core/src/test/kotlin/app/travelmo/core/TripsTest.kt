package app.travelmo.core

import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test

// Invented bookings: a stay in Liverpool and a flight out, in their own offsets.
private val stay = Segment("s", "t", SegmentType.LODGING, "Cove Liverpool", "2026-12-12T15:00:00+00:00", "2026-12-14T11:00:00+00:00")
private val flightOut = Segment("f1", "t", SegmentType.FLIGHT, "BA 117", "2026-12-12T09:00:00+00:00", "2026-12-12T12:00:00-05:00")
private val flightHome = Segment("f2", "t", SegmentType.FLIGHT, "BA 118", "2026-12-14T18:00:00+00:00")

private fun trip(id: String, start: String, end: String) = Trip(id, id, start, end, "u1")

class TripsTest {
    @Test
    fun `groups trips by calendar date, past newest first`() {
        val groups = groupTrips(
            listOf(trip("past2", "2026-03-20", "2026-03-22"), trip("now", "2026-10-31", "2026-11-03"), trip("soon", "2026-11-28", "2026-12-02"), trip("past1", "2026-09-14", "2026-09-19")),
            "2026-11-01",
        )
        groups.current.map { it.id } shouldBe listOf("now")
        groups.upcoming.map { it.id } shouldBe listOf("soon")
        groups.past.map { it.id } shouldBe listOf("past1", "past2")
    }

    @Test
    fun `the next event is the soonest start ahead, or the end of a booking under way`() {
        val before = nextEvent(listOf(stay, flightOut, flightHome), "2026-12-11T20:00:00Z")!!
        before.segment shouldBe flightOut
        eventVerb(before) shouldBe "Departs"
        val during = nextEvent(listOf(stay, flightOut, flightHome), "2026-12-13T08:00:00Z")!!
        during.segment shouldBe stay
        during.at shouldBe stay.end
        eventVerb(during) shouldBe "Check-out"
        // Compared by instant across offsets.
        nextEvent(listOf(flightOut, stay), "2026-12-12T10:00:00Z")!!.segment shouldBe stay
        nextEvent(listOf(stay, flightOut, flightHome), "2026-12-15T00:00:00Z").shouldBeNull()
    }

    @Test
    fun `rows read as the web shows them`() {
        val train = Segment(
            "r", "t", SegmentType.TRAIN, "Avanti to Liverpool", "2026-12-12T09:07:00+00:00", "2026-12-12T11:25:00+00:00",
            provider = "Avanti West Coast", confirmation = "ABC123",
            origin = Place("London Euston", code = "EUS"), destination = Place("Liverpool Lime Street", code = "LIV"),
        )
        routeLine(train) shouldBe "EUS London Euston → LIV Liverpool Lime Street"
        timesLine(train) shouldBe "09:07 – 11:25"
        referenceLine(train) shouldBe "Avanti West Coast · Ref ABC123"
        timesLine(stay) shouldBe "Check-in 15:00 · Check-out Mon 14 Dec 11:00"
        routeLine(stay).shouldBeNull()
        referenceLine(stay).shouldBeNull()
        placeLabel(Place("Cove Liverpool", city = "Liverpool")) shouldBe "Liverpool"
        segmentsByDay(listOf(stay, flightOut, flightHome)).map { (day, items) -> day to items.map { it.id } } shouldBe
            listOf("2026-12-12" to listOf("f1", "s"), "2026-12-14" to listOf("f2"))
    }

    @Test
    fun `addresses are compared lowercase`() {
        normalizeEmail(" Partner@Example.com ") shouldBe "partner@example.com"
        normalizeEmail("").shouldBeNull()
        normalizeEmail(null).shouldBeNull()
    }

    @Test
    fun `dates format as en-GB ranges`() {
        formatDate("2026-12-12") shouldBe "Sat 12 Dec"
        formatDateRange("2026-12-12", "2026-12-14") shouldBe "12–14 Dec 2026"
        formatDateRange("2026-11-28", "2026-12-02") shouldBe "28 Nov – 2 Dec 2026"
        formatDateRange("2026-12-30", "2027-01-02") shouldBe "30 Dec 2026 – 2 Jan 2027"
        formatDateRange("2026-12-12", "2026-12-12") shouldBe "12 Dec 2026"
    }

    @Test
    fun `the bookings' span feeds both bounds from both ends, and fitting is offered only when it differs`() {
        val trip = Trip("t", "T", "2026-12-10", "2026-12-20", "u")
        val flight = Segment("f", "t", SegmentType.FLIGHT, "Home", "2026-12-15T23:30:00+13:00", "2026-12-15T09:00:00-08:00")
        val stay = Segment("s", "t", SegmentType.LODGING, "Stay", "2026-12-12T15:00:00+00:00", "2026-12-14T11:00:00+00:00")
        segmentDateRange(listOf(flight, stay)) shouldBe ("2026-12-12" to "2026-12-15")
        segmentDateRange(emptyList()) shouldBe null
        fittedRange(trip, listOf(flight, stay)) shouldBe ("2026-12-12" to "2026-12-15")
        fittedRange(trip.copy(start = "2026-12-12", end = "2026-12-15"), listOf(flight, stay)) shouldBe null
        fittedRange(trip, emptyList()) shouldBe null
    }

    @Test
    fun `other trips leave out this one and any being deleted, by start`() {
        val trips = listOf(
            Trip("b", "B", "2026-12-01", "2026-12-02", "u"),
            Trip("a", "A", "2026-11-01", "2026-11-02", "u"),
            Trip("gone", "Gone", "2026-10-01", "2026-10-02", "u", deleting = true),
            Trip("me", "Me", "2026-09-01", "2026-09-02", "u"),
        )
        otherTrips(trips, "me").map { it.id } shouldBe listOf("a", "b")
    }
}
