package app.travelmo.core

import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test

private val stay = Segment("s", "t", SegmentType.LODGING, "Cove Liverpool", "2026-12-12T15:00:00+00:00", "2026-12-14T11:00:00+00:00")
private val flight = Segment("f", "t", SegmentType.FLIGHT, "XX 100 MAN to DXB", "2026-12-13T09:00:00+05:00", "2026-12-13T19:00:00+04:00", confirmation = "XX1234")
private val later = Segment("g", "t", SegmentType.FLIGHT, "XX 101 DXB to MAN", "2026-12-20T09:00:00+04:00")

class StatusTest {
    @Test
    fun `counts minutes, then hours, then days in the place's own calendar, up to a week`() {
        relativeTime("2026-12-13T03:35:00Z", flight.start) shouldBe "in 25 min"
        relativeTime("2026-12-13T00:40:00Z", flight.start) shouldBe "in 3 h 20 min"
        relativeTime("2026-12-13T01:00:00Z", flight.start) shouldBe "in 3 h"
        relativeTime("2026-12-12T20:00:20Z", flight.start) shouldBe "in 8 h"
        relativeTime("2026-12-13T03:00:40Z", flight.start) shouldBe "in 59 min"
        // 04:00Z on the 13th is 09:00 on the 13th in Dubai: 20:00Z on the 11th
        // is already the 12th there, so "tomorrow"; 16:00Z is still the 11th.
        relativeTime("2026-12-11T20:00:00Z", flight.start) shouldBe "tomorrow"
        relativeTime("2026-12-11T16:00:00Z", flight.start) shouldBe "on Sun"
        relativeTime("2026-12-01T12:00:00Z", flight.start).shouldBeNull()
        relativeTime("2026-12-13T05:00:00Z", flight.start).shouldBeNull()
    }

    @Test
    fun `instants keep their offsets`() {
        localDateAt("2026-12-12T22:00:00Z", offsetOf("+05:00".let { "2026-01-01T00:00:00$it" })) shouldBe "2026-12-13"
        shiftInstant(flight.start, -24 * 60 * 60_000L) shouldBe "2026-12-12T09:00:00+05:00"
        shiftInstant("2026-12-13T00:30:00-05:00", 60 * 60_000L) shouldBe "2026-12-13T01:30:00-05:00"
        shiftInstant("2026-12-13T00:30:00Z", 0) shouldBe "2026-12-13T00:30:00+00:00"
        localTime(flight.start) shouldBe "09:00"
        localDate(flight.end!!) shouldBe "2026-12-13"
    }

    @Test
    fun `names the next flight's window from a day before it opens, open once it has`() {
        flightCheckIn(listOf(stay, flight, later), "2026-12-11T03:00:00Z").shouldBeNull()
        flightCheckIn(listOf(stay, flight, later), "2026-12-11T05:00:00Z") shouldBe CheckIn(flight, "2026-12-12T09:00:00+05:00", false)
        val open = flightCheckIn(listOf(stay, flight, later), "2026-12-12T20:00:00Z")!!
        open shouldBe CheckIn(flight, "2026-12-12T09:00:00+05:00", true)
        checkInLine(open) shouldBe "Online check-in open, usually until departure · Ref XX1234"
        checkInLine(open.copy(open = false, segment = flight.copy(confirmation = null))) shouldBe "Online check-in usually opens Sat 12 Dec 09:00"
        flightCheckIn(listOf(stay, flight, later), "2026-12-13T05:00:00Z").shouldBeNull()
        flightCheckIn(listOf(stay), "2026-12-12T20:00:00Z").shouldBeNull()
    }

    @Test
    fun `knows the stay under way, the next event and the check-in together`() {
        currentStay(listOf(stay, flight), "2026-12-12T14:00:00Z").shouldBeNull()
        currentStay(listOf(stay, flight), "2026-12-12T20:00:00Z") shouldBe stay
        currentStay(listOf(stay, flight), "2026-12-14T11:00:00Z").shouldBeNull()
        val status = tripStatus(listOf(stay, flight, later), "2026-12-12T20:00:00Z")
        status.stay shouldBe stay
        status.next!!.segment shouldBe flight
        status.checkIn!!.open shouldBe true
        tripStatus(emptyList(), "2026-12-12T20:00:00Z") shouldBe TripStatus()
    }
}
