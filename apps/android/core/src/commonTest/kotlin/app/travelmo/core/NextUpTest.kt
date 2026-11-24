package app.travelmo.core

import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import kotlin.test.Test

// Mirrors packages/core/src/nextUp.test.ts. An invented flight: leaves London
// at 17:20 (17:20Z) and lands in Boston at 20:30 (01:30Z the next day); a stay
// in Boston after it.
class NextUpTest {
    private val flight = Segment(
        id = "f1",
        tripId = "t1",
        type = SegmentType.FLIGHT,
        title = "VS 11 LHR to BOS",
        start = "2026-11-24T17:20:00+00:00",
        end = "2026-11-24T20:30:00-05:00",
        origin = Place("London Heathrow", "LHR"),
        destination = Place("Boston Logan", "BOS"),
    )
    // A car at Boston booked for the scheduled landing, before the booked arrival.
    private val car = Segment("c1", "t1", SegmentType.CAR_RENTAL, "Hertz at Boston Logan", "2026-11-24T20:15:00-05:00", "2026-11-28T10:00:00-05:00")
    private val stay = Segment("h1", "t1", SegmentType.LODGING, "Harbor Hotel", "2026-11-25T15:00:00-05:00", "2026-11-28T11:00:00-05:00")
    private val key = "VS11_2026-11-24_LHR"
    private val before = "2026-11-24T15:19:00Z"
    private val after = "2026-11-24T19:20:00Z"

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
    ) = mapOf(
        key to FlightStatus(
            ident = "VS11",
            date = "2026-11-24",
            origin = "LHR",
            found = found,
            departureGate = departureGate,
            departureTerminal = departureTerminal,
            arrivalGate = arrivalGate,
            arrivalTerminal = arrivalTerminal,
            baggageClaim = baggageClaim,
            scheduledOut = "2026-11-24T17:20:00Z",
            scheduledIn = "2026-11-25T01:30:00Z",
            estimatedOut = estimatedOut,
            estimatedIn = estimatedIn,
            actualOut = actualOut,
            actualIn = actualIn,
            cancelled = cancelled,
            diverted = diverted,
            divertedTo = divertedTo,
            checkedAt = "2026-11-24T15:00:00Z",
        ),
    )

    @Test
    fun namesTheBookingThenWhatHappensAndHowSoonThenWhenAsBooked() {
        tripNextUp(listOf(flight, stay), before) shouldBe NextUp(flight, "VS 11 LHR to BOS", "Departs in 2 h 1 min · Tue 24 Nov 17:20")
        tripNextUp(listOf(stay), "2026-11-25T17:00:00Z")?.`when` shouldBe "Check-in in 3 h · Wed 25 Nov 15:00"
    }

    @Test
    fun givesOnlyTheDateAndTimeBeyondAWeek() {
        tripNextUp(listOf(flight), "2026-11-10T12:00:00Z")?.`when` shouldBe "Departs Tue 24 Nov 17:20"
        tripNextUp(listOf(flight), "2026-11-21T12:00:00Z")?.`when` shouldBe "Departs Tue 24 Nov 17:20"
        tripNextUp(listOf(flight), "2026-11-23T12:00:00Z")?.`when` shouldBe "Departs tomorrow · Tue 24 Nov 17:20"
    }

    @Test
    fun saysNothingOnceEverythingHasHappened() {
        tripNextUp(listOf(flight), "2026-11-26T00:00:00Z").shouldBeNull()
    }

    @Test
    fun givesTheDepartureTerminalAndGateBeforeTakeoffWhateverIsKnown() {
        tripNextUp(listOf(flight), before, status(departureTerminal = "3", departureGate = "12"))?.step shouldBe "Terminal 3 · Gate 12"
        tripNextUp(listOf(flight), before, status(departureTerminal = "3"))?.step shouldBe "Terminal 3"
        tripNextUp(listOf(flight), before, status(departureGate = "12"))?.step shouldBe "Gate 12"
        tripNextUp(listOf(flight), before, status(arrivalTerminal = "E", baggageClaim = "7"))?.step.shouldBeNull()
        tripNextUp(listOf(flight), before, status(found = false, departureGate = "12"))?.step.shouldBeNull()
    }

    @Test
    fun givesADelayBeforeTakeoffInPlaceOfTheGate() {
        val late = status(estimatedOut = "2026-11-24T17:55:00Z", departureGate = "12")
        val next = tripNextUp(listOf(flight), before, late)
        next?.`when` shouldBe "Departs in 2 h 36 min · Tue 24 Nov 17:20"
        next?.step shouldBe "Leaves 35 min late, at 17:55"
        tripNextUp(listOf(flight), "2026-11-24T17:40:00Z", late)?.`when` shouldBe "Departs in 15 min · Tue 24 Nov 17:20"
    }

    @Test
    fun movesToTheArrivalAfterTakeoffWithItsTerminalGateAndCarousel() {
        val flying = status(actualOut = "2026-11-24T17:30:00Z", estimatedIn = "2026-11-25T01:30:00Z", departureGate = "12", arrivalTerminal = "E", baggageClaim = "7")
        val next = tripNextUp(listOf(flight), after, flying)
        next?.`when` shouldBe "Arrives in 6 h 10 min · Tue 24 Nov 20:30"
        next?.step shouldBe "Terminal E · Bags on carousel 7"
        val early = tripNextUp(listOf(flight), "2026-11-24T17:10:00Z", status(actualOut = "2026-11-24T17:05:00Z", arrivalGate = "B5"))
        early?.`when` shouldBe "Arrives in 8 h 20 min · Tue 24 Nov 20:30"
        early?.step shouldBe "Gate B5"
        tripNextUp(listOf(flight), "2026-11-24T17:21:00Z", status(departureGate = "12"))?.step.shouldBeNull()
    }

    @Test
    fun staysOnAFlightInTheAirPastAnythingBookedBeforeItLands() {
        // 01:00Z is 20:00 in Boston: the car's 20:15 comes before the 20:30 landing.
        val flying = tripNextUp(listOf(flight, car, stay), "2026-11-25T01:00:00Z", status(actualOut = "2026-11-24T17:30:00Z", estimatedIn = "2026-11-25T01:40:00Z", arrivalGate = "B5"))
        flying?.segment shouldBe flight
        flying?.`when` shouldBe "Arrives in 40 min · Tue 24 Nov 20:30"
        flying?.step shouldBe "Gate B5"
        val booked = tripNextUp(listOf(flight, car, stay), "2026-11-25T01:00:00Z")
        booked?.segment shouldBe flight
        booked?.`when` shouldBe "Arrives in 30 min · Tue 24 Nov 20:30"
    }

    @Test
    fun staysOnALandedFlightForAnHourWithItsGateAndCarouselThenWhatWasBookedDuringTheFlight() {
        val down = status(actualOut = "2026-11-24T17:30:00Z", actualIn = "2026-11-25T01:40:00Z", arrivalTerminal = "E", arrivalGate = "B5", baggageClaim = "7")
        tripNextUp(listOf(flight, car, stay), "2026-11-25T01:52:00Z", down) shouldBe NextUp(
            flight,
            "VS 11 LHR to BOS",
            "Landed 12 min ago · Tue 24 Nov 20:30",
            "Terminal E · Gate B5 · Bags on carousel 7",
            "Then Hertz at Boston Logan · Pick up Tue 24 Nov 20:15",
        )
        tripNextUp(listOf(flight, car, stay), "2026-11-25T02:41:00Z", down) shouldBe NextUp(stay, "Harbor Hotel", "Check-in in 17 h 19 min · Wed 25 Nov 15:00")
        tripNextUp(listOf(flight, car, stay), "2026-11-25T01:31:00Z") shouldBe NextUp(car, "Hertz at Boston Logan", "Pick up Tue 24 Nov 20:15")
    }

    @Test
    fun givesTheNextBookingAfterALandedFlightOrNothingWhenItWasTheLast() {
        val down = status(actualOut = "2026-11-24T17:30:00Z", actualIn = "2026-11-25T01:40:00Z", arrivalGate = "B5", baggageClaim = "7")
        val next = tripNextUp(listOf(flight, stay), "2026-11-25T01:52:00Z", down)
        next?.segment shouldBe flight
        next?.step shouldBe "Gate B5 · Bags on carousel 7"
        next?.then shouldBe "Then Harbor Hotel · Check-in in 18 h 8 min · Wed 25 Nov 15:00"
        tripNextUp(listOf(flight), "2026-11-25T01:52:00Z", down) shouldBe NextUp(flight, "VS 11 LHR to BOS", "Landed 12 min ago · Tue 24 Nov 20:30", "Gate B5 · Bags on carousel 7")
        tripNextUp(listOf(flight), "2026-11-25T02:41:00Z", down).shouldBeNull()
    }

    @Test
    fun givesTheArrivalGateAndAConnectionsDepartureGateAfterLanding() {
        val onward = Segment("f2", "t1", SegmentType.FLIGHT, "B6 1 BOS to JFK", "2026-11-24T21:30:00-05:00", "2026-11-24T22:45:00-05:00", origin = Place("Boston Logan", "BOS"), destination = Place("New York JFK", "JFK"))
        val boarding = "B61_2026-11-24_BOS" to FlightStatus(
            ident = "B61", date = "2026-11-24", origin = "BOS", found = true, departureGate = "C22",
            scheduledOut = "2026-11-25T02:30:00Z", scheduledIn = "2026-11-25T03:45:00Z", checkedAt = "2026-11-24T15:00:00Z",
        )
        val next = tripNextUp(listOf(flight, onward), "2026-11-25T01:52:00Z", status(actualOut = "2026-11-24T17:30:00Z", actualIn = "2026-11-25T01:40:00Z", arrivalGate = "B5") + boarding)
        next?.segment shouldBe flight
        next?.step shouldBe "Gate B5"
        next?.then shouldBe "Then B6 1 BOS to JFK · Departs in 38 min · Tue 24 Nov 21:30 · Gate C22"
    }

    @Test
    fun holdsAFlightWithNoArrivalTimeNoLongerThanItsDeparture() {
        tripNextUp(listOf(flight.copy(end = null), stay), "2026-11-24T18:00:00Z")?.segment shouldBe stay
    }

    @Test
    fun leavesACancelledBookingOutOfWhatComesAfterALanding() {
        val down = status(actualOut = "2026-11-24T17:30:00Z", actualIn = "2026-11-25T01:40:00Z", baggageClaim = "7")
        val cancelled = car.copy(cancelledAt = "2026-11-20T10:00:00Z")
        tripNextUp(listOf(flight, cancelled, stay), "2026-11-25T01:52:00Z", down)?.then shouldBe "Then Harbor Hotel · Check-in in 18 h 8 min · Wed 25 Nov 15:00"
        tripNextUp(listOf(flight, cancelled, stay), "2026-11-25T01:31:00Z")?.segment shouldBe stay
    }

    @Test
    fun neverNamesAFlightLandedEarlyAsWhatFollowsIt() {
        val early = status(actualOut = "2026-11-24T17:10:00Z", actualIn = "2026-11-25T01:10:00Z", baggageClaim = "7")
        tripNextUp(listOf(flight), "2026-11-25T01:20:00Z", early) shouldBe NextUp(flight, "VS 11 LHR to BOS", "Landed 10 min ago · Tue 24 Nov 20:30", "Bags on carousel 7")
    }

    @Test
    fun putsAPickUpBookedForTheVeryLandingAfterIt() {
        val atLanding = car.copy(start = "2026-11-24T20:30:00-05:00")
        val down = status(actualOut = "2026-11-24T17:20:00Z", actualIn = "2026-11-25T01:30:00Z", baggageClaim = "7")
        tripNextUp(listOf(flight, atLanding, stay), "2026-11-25T01:40:00Z", down)?.then shouldBe "Then Hertz at Boston Logan · Pick up Tue 24 Nov 20:30"
        tripNextUp(listOf(flight, atLanding, stay), "2026-11-25T01:40:00Z")?.segment shouldBe atLanding
    }

    @Test
    fun readsAConnectionWhileAnEarlyLandingIsOnTheCard() {
        val onward = Segment("f2", "t1", SegmentType.FLIGHT, "B6 1 BOS to JFK", "2026-11-24T21:30:00-05:00", "2026-11-24T22:45:00-05:00", origin = Place("Boston Logan", "BOS"), destination = Place("New York JFK", "JFK"))
        nextUpFlightKeys(listOf(flight, onward), "2026-11-25T01:20:00Z") shouldBe listOf(key, "B61_2026-11-24_BOS")
    }

    @Test
    fun saysAFlightIsCancelledOrDiverted() {
        tripNextUp(listOf(flight), before, status(cancelled = true))?.step shouldBe "Flight cancelled"
        tripNextUp(listOf(flight), after, status(actualOut = "2026-11-24T17:30:00Z", diverted = true, divertedTo = "JFK", baggageClaim = "7"))?.step shouldBe "Diverted to JFK"
    }

    @Test
    fun namesTheNextEventsFlightWhileItsStatusIsShown() {
        nextUpFlightKeys(listOf(flight, stay), before) shouldBe listOf(key)
        nextUpFlightKeys(listOf(flight, stay), after) shouldBe listOf(key)
        nextUpFlightKeys(listOf(flight, stay), "2026-11-20T00:00:00Z") shouldBe emptyList()
        nextUpFlightKeys(listOf(stay), before) shouldBe emptyList()
    }

    @Test
    fun keepsReadingAFlightBookedToHaveLandedWhileItMayStillBeLate() {
        nextUpFlightKeys(listOf(flight, stay), "2026-11-25T02:00:00Z") shouldBe listOf(key)
    }

    @Test
    fun readsAFlightInTheAirWhenSomethingElseIsBookedBeforeItLands() {
        nextUpFlightKeys(listOf(flight, car, stay), "2026-11-25T01:00:00Z") shouldBe listOf(key)
    }

    @Test
    fun keepsALateFlightOnTheCardPastItsBookedArrivalByTheServicesTimes() {
        val now = "2026-11-25T02:00:00Z"
        val flying = tripNextUp(listOf(flight, stay), now, status(actualOut = "2026-11-24T20:25:00Z", estimatedIn = "2026-11-25T04:30:00Z", baggageClaim = "7"))
        flying?.segment shouldBe flight
        flying?.`when` shouldBe "Arrives in 2 h 30 min · Tue 24 Nov 20:30"
        flying?.step shouldBe "Bags on carousel 7"
        val waiting = tripNextUp(listOf(flight, stay), now, status(estimatedOut = "2026-11-25T03:00:00Z", estimatedIn = "2026-11-25T11:10:00Z", departureGate = "12"))
        waiting?.segment shouldBe flight
        waiting?.`when` shouldBe "Departs in 1 h · Tue 24 Nov 17:20"
        tripNextUp(listOf(flight, stay), now, status(actualOut = "2026-11-24T17:25:00Z", actualIn = "2026-11-25T01:00:00Z"))?.segment shouldBe stay
        tripNextUp(listOf(flight, stay), now)?.segment shouldBe stay
    }

    @Test
    fun takeoffGoesByTheServiceThenItsTimesThenTheBooking() {
        val one = { s: Map<String, FlightStatus> -> s.getValue(key) }
        flightDeparted(flight, one(status(actualOut = "2026-11-24T17:00:00Z")), "2026-11-24T17:01:00Z") shouldBe true
        flightDeparted(flight, one(status(estimatedOut = "2026-11-24T18:00:00Z")), "2026-11-24T17:30:00Z") shouldBe false
        flightDeparted(flight, one(status()), "2026-11-24T17:20:00Z") shouldBe true
        flightDeparted(flight, null, "2026-11-24T17:19:00Z") shouldBe false
        flightDeparted(flight, one(status(cancelled = true, estimatedOut = "2026-11-24T18:00:00Z")), "2026-11-24T17:30:00Z") shouldBe true
        flightNextStep(null, flight, before).shouldBeNull()
    }
}
