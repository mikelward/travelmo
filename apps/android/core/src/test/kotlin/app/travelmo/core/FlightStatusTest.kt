package app.travelmo.core

import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test

// Mirrors packages/core/src/flightStatus.test.ts. An invented flight: leaves
// at 09:00 in Sydney (22:00Z the day before), lands at 15:30 in Singapore.
class FlightStatusTest {
    private val flight = Segment(
        id = "f1",
        tripId = "t1",
        type = SegmentType.FLIGHT,
        title = "XX 100 SYD to SIN",
        start = "2026-12-13T09:00:00+11:00",
        end = "2026-12-13T15:30:00+08:00",
    )

    private fun status(
        found: Boolean = true,
        departureGate: String? = null,
        departureTerminal: String? = null,
        arrivalGate: String? = null,
        arrivalTerminal: String? = null,
        baggageClaim: String? = null,
        actualOut: String? = null,
        actualIn: String? = null,
        cancelled: Boolean = false,
        checkedAt: String = "2026-12-12T19:00:00Z",
    ) = FlightStatus(
        ident = "XX100",
        date = "2026-12-13",
        origin = "SYD",
        found = found,
        departureGate = departureGate,
        departureTerminal = departureTerminal,
        arrivalGate = arrivalGate,
        arrivalTerminal = arrivalTerminal,
        baggageClaim = baggageClaim,
        scheduledOut = "2026-12-12T22:00:00Z",
        scheduledIn = "2026-12-13T07:30:00Z",
        actualOut = actualOut,
        actualIn = actualIn,
        cancelled = cancelled,
        checkedAt = checkedAt,
    )

    @Test
    fun readsTheFlightNumberFromTheTitle() {
        flightDesignator(flight) shouldBe "XX100"
        flightDesignator(flight.copy(title = "QF1 SYD to SIN")) shouldBe "QF1"
        flightDesignator(flight.copy(title = "BA 0117 LHR to JFK")) shouldBe "BA117"
        flightDesignator(flight.copy(title = "Flight 9W 7 to BOM")) shouldBe "9W7"
        flightDesignator(flight.copy(title = "Flight LHR to JFK")).shouldBeNull()
        flightDesignator(flight.copy(type = SegmentType.TRAIN, title = "ES 9014 London to Paris")).shouldBeNull()
    }

    @Test
    fun namesTheFlightByNumberDateAndAirport() {
        flightStatusKey(flight.copy(origin = Place("Sydney", code = "syd"))) shouldBe "XX100_2026-12-13_SYD"
        flightStatusKey(flight) shouldBe "XX100_2026-12-13"
        flightStatusKey(flight.copy(title = "Flight to SIN")).shouldBeNull()
    }

    @Test
    fun looksEveryMinuteAroundDepartureAndLanding() {
        flightCheckInterval(flight, null, "2026-12-12T19:59:00Z").shouldBeNull()
        flightCheckInterval(flight, null, "2026-12-12T20:00:00Z") shouldBe 60_000L
        val departed = status(actualOut = "2026-12-12T22:05:00Z")
        flightCheckInterval(flight, departed, "2026-12-13T02:00:00Z") shouldBe 15 * 60_000L
        flightCheckInterval(flight, departed, "2026-12-13T07:00:00Z") shouldBe 60_000L
        flightCheckInterval(flight, departed, "2026-12-13T08:15:00Z").shouldBeNull()
        flightCheckInterval(flight, status(cancelled = true), "2026-12-12T21:00:00Z").shouldBeNull()
        flightCheckInterval(flight, status(found = false), "2026-12-12T23:01:00Z").shouldBeNull()
    }

    @Test
    fun letsAnOpenTripPageLookOnceAMinuteFromSixHoursBefore() {
        flightRefreshDue(flight, null, "2026-12-12T15:59:00Z") shouldBe false
        flightRefreshDue(flight, null, "2026-12-12T16:00:00Z") shouldBe true
        val looked = status(checkedAt = "2026-12-12T17:00:00Z")
        flightRefreshDue(flight, looked, "2026-12-12T17:00:30Z") shouldBe false
        flightRefreshDue(flight, looked, "2026-12-12T17:01:00Z") shouldBe true
        val landed = status(actualOut = "2026-12-12T22:00:00Z", actualIn = "2026-12-13T07:30:00Z")
        flightRefreshDue(flight, landed, "2026-12-13T08:16:00Z") shouldBe false
    }

    @Test
    fun showsTheStatusFromADayBeforeUntilTheLooksStop() {
        flightStatusShown(flight, "2026-12-11T21:59:00Z") shouldBe false
        flightStatusShown(flight, "2026-12-11T22:00:00Z") shouldBe true
        flightStatusShown(flight, "2026-12-14T04:00:00Z") shouldBe true
        flightStatusShown(flight, "2026-12-14T04:01:00Z") shouldBe false
        flightStatusShown(flight.copy(type = SegmentType.TRAIN), "2026-12-12T21:00:00Z") shouldBe false
    }

    @Test
    fun showsNoStatusForACancelledBooking() {
        flightStatusShown(flight.copy(cancelledAt = "2026-11-01T00:00:00Z"), "2026-12-12T21:00:00Z") shouldBe false
    }

    @Test
    fun saysWhereTheFlightLeavesArrivesAndWhereTheBagsComeOut() {
        val known = status(departureGate = "8", departureTerminal = "1", arrivalGate = "D46", baggageClaim = "16")
        flightStatusLines(known) shouldBe listOf("Departs from terminal 1, gate 8", "Arrives at gate D46", "Bags on carousel 16")
        flightStatusLines(status(arrivalTerminal = "3")) shouldBe listOf("Arrives at terminal 3")
        flightStatusLines(null) shouldBe emptyList<String>()
        flightStatusLines(status(found = false, departureGate = "8")) shouldBe emptyList<String>()
    }

    @Test
    fun namesEachFlightNearDepartureOnce() {
        val stay = flight.copy(id = "h1", type = SegmentType.LODGING, title = "Hotel 100")
        val withOrigin = flight.copy(origin = Place("Sydney", code = "SYD"))
        shownFlightKeys(listOf(withOrigin, withOrigin.copy(id = "f2"), stay), "2026-12-12T21:00:00Z") shouldBe listOf("XX100_2026-12-13_SYD")
        shownFlightKeys(listOf(withOrigin), "2026-12-10T21:00:00Z") shouldBe emptyList<String>()
    }
}
