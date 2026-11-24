package app.travelmo.core

import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import kotlin.test.Test

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
        estimatedOut: String? = null,
        estimatedIn: String? = null,
        actualOut: String? = null,
        actualIn: String? = null,
        cancelled: Boolean = false,
        diverted: Boolean = false,
        divertedTo: String? = null,
        noticedOut: String? = null,
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
        estimatedOut = estimatedOut,
        estimatedIn = estimatedIn,
        actualOut = actualOut,
        actualIn = actualIn,
        cancelled = cancelled,
        diverted = diverted,
        divertedTo = divertedTo,
        noticedOut = noticedOut,
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
    fun saysHowLateTheFlightLeavesAndLandsByTheAirportsClocks() {
        val late = status(estimatedOut = "2026-12-12T22:40:00Z", estimatedIn = "2026-12-13T07:10:00Z", departureGate = "8")
        flightStatusLines(late, flight) shouldBe listOf("Leaves 40 min late, at 09:40", "Departs from gate 8", "Lands 20 min early, at 15:10")
        flightStatusLines(status(estimatedOut = "2026-12-13T00:05:00Z")) shouldBe listOf("Leaves 2 h 5 min late")
        flightStatusLines(status(estimatedOut = "2026-12-12T22:04:00Z", estimatedIn = "2026-12-13T07:26:00Z"), flight) shouldBe emptyList<String>()
        flightStatusLines(status(estimatedOut = "2026-12-12T22:40:00Z", actualOut = "2026-12-12T22:41:00Z"), flight) shouldBe emptyList<String>()
    }

    @Test
    fun saysAFlightLeavesOnTimeAgainAfterNewsOfItsDelay() {
        val back = status(estimatedOut = "2026-12-12T22:00:00Z", noticedOut = "2026-12-12T22:00:00Z")
        flightStatusLines(back, flight) shouldBe listOf("Leaves on time, at 09:00")
    }

    @Test
    fun saysOnlyThatACancelledFlightIsCancelled() {
        flightStatusLines(status(cancelled = true, departureGate = "8", estimatedOut = "2026-12-12T22:40:00Z"), flight) shouldBe listOf("Flight cancelled")
    }

    @Test
    fun saysWhereADivertedFlightGoesWhenThatIsNotWhereItWasBookedTo() {
        val booked = flight.copy(destination = Place("Singapore", code = "SIN"))
        flightStatusLines(status(diverted = true, divertedTo = "KUL"), booked) shouldBe listOf("Diverted to KUL")
        flightStatusLines(status(diverted = true, divertedTo = "SIN"), booked) shouldBe listOf("Diverted")
        flightStatusLines(status(diverted = true), booked) shouldBe listOf("Diverted")
    }

    @Test
    fun namesEachFlightNearDepartureOnce() {
        val stay = flight.copy(id = "h1", type = SegmentType.LODGING, title = "Hotel 100")
        val withOrigin = flight.copy(origin = Place("Sydney", code = "SYD"))
        shownFlightKeys(listOf(withOrigin, withOrigin.copy(id = "f2"), stay), "2026-12-12T21:00:00Z") shouldBe listOf("XX100_2026-12-13_SYD")
        shownFlightKeys(listOf(withOrigin), "2026-12-10T21:00:00Z") shouldBe emptyList<String>()
    }

    // Live Updates: Android's own, not in packages/core.

    @Test
    fun liveUpdateShowsTheTerminalAndGateBeforeDeparture() {
        val live = liveFlight(status(departureGate = "28", departureTerminal = "3"), flight, "2026-12-12T21:00:00Z")!!
        live.chip shouldBe "T3 G28"
        live.text shouldBe "Leaves at 09:00 · Departs from terminal 3, gate 28"
        live.progress shouldBe 0
        // 45 minutes after the scheduled landing.
        live.endsAt shouldBe instantMillis("2026-12-13T08:15:00Z")
    }

    @Test
    fun liveUpdateChipShowsWhicheverPlaceIsKnownAndAGateThatNamesItself() {
        liveFlight(status(departureTerminal = "3"), flight, "2026-12-12T21:00:00Z")!!.chip shouldBe "T3"
        liveFlight(status(departureGate = "B12", departureTerminal = "1"), flight, "2026-12-12T21:00:00Z")!!.chip shouldBe "T1 B12"
        liveFlight(status(departureGate = "B12", departureTerminal = "Intl"), flight, "2026-12-12T21:00:00Z")!!.chip shouldBe "Intl B12"
    }

    @Test
    fun liveUpdateWithNoPlaceYetShowsTheDepartureTimeAndAnyDelay() {
        val live = liveFlight(status(estimatedOut = "2026-12-12T22:40:00Z"), flight, "2026-12-12T21:00:00Z")!!
        live.chip shouldBe "09:40"
        live.text shouldBe "Leaves 40 min late, at 09:40"
    }

    @Test
    fun liveUpdateInTheAirShowsTheLandingTimeAndHowFarAlong() {
        val live = liveFlight(
            status(departureGate = "28", arrivalGate = "D46", actualOut = "2026-12-12T22:00:00Z", estimatedIn = "2026-12-13T07:10:00Z"),
            flight,
            "2026-12-13T02:35:00Z",
        )!!
        live.chip shouldBe "Lands 15:10"
        live.text shouldBe "Lands 20 min early, at 15:10 · Arrives at gate D46"
        live.progress shouldBe 50
        live.endsAt shouldBe instantMillis("2026-12-13T07:55:00Z")
    }

    @Test
    fun liveUpdateOnceLandedShowsTheCarousel() {
        val landed = status(arrivalGate = "D46", actualOut = "2026-12-12T22:00:00Z", actualIn = "2026-12-13T07:20:00Z")
        val before = liveFlight(landed, flight, "2026-12-13T07:25:00Z")!!
        before.chip shouldBe "D46"
        before.text shouldBe "Arrives at gate D46"
        before.progress shouldBe 100
        val bags = liveFlight(landed.copy(baggageClaim = "16"), flight, "2026-12-13T07:30:00Z")!!
        bags.chip shouldBe "Bags 16"
        bags.text shouldBe "Bags on carousel 16"
    }

    @Test
    fun liveUpdateSaysWhereADivertedFlightLands() {
        val live = liveFlight(
            status(actualOut = "2026-12-12T22:00:00Z", diverted = true, divertedTo = "KUL"),
            flight,
            "2026-12-13T02:00:00Z",
        )!!
        live.text shouldBe "Diverted to KUL · Lands at 15:30"
    }

    @Test
    fun liveUpdateIsTakenDownOutsideTheWatchOrWhenCancelled() {
        // Three hours before departure: not yet.
        liveFlight(status(departureGate = "28"), flight, "2026-12-12T19:00:00Z").shouldBeNull()
        // An hour after landing.
        liveFlight(status(actualOut = "2026-12-12T22:00:00Z", actualIn = "2026-12-13T07:20:00Z"), flight, "2026-12-13T08:20:00Z").shouldBeNull()
        liveFlight(status(cancelled = true), flight, "2026-12-12T21:00:00Z").shouldBeNull()
        liveFlight(status(found = false), flight, "2026-12-12T21:00:00Z").shouldBeNull()
        liveFlight(null, flight, "2026-12-12T21:00:00Z").shouldBeNull()
    }

    @Test
    fun readsALiveUpdateMessage() {
        val message = liveFlightMessage(
            mapOf(
                "kind" to "live",
                "tag" to "live-XX100_2026-12-13_SYD",
                "key" to "XX100_2026-12-13_SYD",
                "title" to "XX 100 SYD to SIN",
                "url" to "https://travelmo.example/trips/t1",
                "start" to "2026-12-13T09:00:00+11:00",
                "end" to "2026-12-13T15:30:00+08:00",
                "destination" to "SIN",
                "ident" to "XX100",
                "date" to "2026-12-13",
                "origin" to "SYD",
                "found" to "true",
                "departureGate" to "28",
                "departureTerminal" to "3",
                "scheduledOut" to "2026-12-12T22:00:00Z",
                "scheduledIn" to "2026-12-13T07:30:00Z",
                "cancelled" to "false",
                "checkedAt" to "2026-12-12T19:00:00Z",
            ),
        )!!
        message.tag shouldBe "live-XX100_2026-12-13_SYD"
        message.url shouldBe "https://travelmo.example/trips/t1"
        message.status shouldBe status(departureGate = "28", departureTerminal = "3")
        liveFlight(message.status, message.booking, "2026-12-12T21:00:00Z")!!.chip shouldBe "T3 G28"
        message.booking.destination?.code shouldBe "SIN"
    }

    @Test
    fun ignoresMessagesThatAreNotLiveUpdates() {
        liveFlightMessage(mapOf("title" to "Before your trip", "body" to "Starts tomorrow", "tag" to "reminder-t1")).shouldBeNull()
        liveFlightMessage(mapOf("kind" to "live", "tag" to "live-x")).shouldBeNull()
    }
}
