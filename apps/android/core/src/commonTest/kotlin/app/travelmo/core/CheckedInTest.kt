package app.travelmo.core

import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import kotlin.test.Test

// Mirrors packages/core/src/checkedIn.test.ts. An invented flight leaving
// Manchester at 09:00 Dubai time (04:00Z); its check-in usually opens a day before.
class CheckedInTest {
    private val flight = Segment("f1", "t1", SegmentType.FLIGHT, "XX 100 MAN to DXB", "2026-12-13T09:00:00+05:00")

    @Test
    fun marksABookingOnceAndUnmarksIt() {
        withCheckedIn(emptyList(), "f1", true) shouldBe listOf("f1")
        withCheckedIn(listOf("f1", "f2"), "f1", true) shouldBe listOf("f2", "f1")
        withCheckedIn(listOf("f1", "f2"), "f1", false) shouldBe listOf("f2")
        withCheckedIn(listOf("f2"), "f1", false) shouldBe listOf("f2")
    }

    @Test
    fun keepsTheNewestWithinTheLimit() {
        val marked = withCheckedIn(List(MAX_CHECKED_IN) { "f$it" }, "new", true)
        marked.size shouldBe MAX_CHECKED_IN
        marked.last() shouldBe "new"
        ("f0" in marked) shouldBe false
    }

    @Test
    fun leavesOutAnIdThatIsNotOne() {
        checkedInOf(listOf("f1", 3, "")) shouldBe listOf("f1")
        checkedInOf(null) shouldBe emptyList()
    }

    @Test
    fun offersTheMarkFromWhenCheckInOpensUntilDepartureThenSaysItIsDone() {
        flightCheckInState(flight, emptySet(), "2026-12-12T03:59:00Z").shouldBeNull()
        flightCheckInState(flight, emptySet(), "2026-12-12T04:00:00Z") shouldBe FlightCheckIn.OFFER
        flightCheckInState(flight, setOf("f1"), "2026-12-12T04:00:00Z") shouldBe FlightCheckIn.DONE
        flightCheckInState(flight, setOf("f1"), "2026-12-13T04:00:00Z").shouldBeNull()
        flightCheckInState(flight, emptySet(), "2026-12-13T04:00:00Z").shouldBeNull()
    }

    @Test
    fun offersNothingForAnythingButAFlightOrACancelledOne() {
        flightCheckInState(flight.copy(type = SegmentType.TRAIN), emptySet(), "2026-12-12T12:00:00Z").shouldBeNull()
        flightCheckInState(flight.copy(cancelledAt = "2026-12-01T00:00:00Z"), emptySet(), "2026-12-12T12:00:00Z").shouldBeNull()
    }
}
