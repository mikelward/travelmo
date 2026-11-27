package app.travelmo.core

import io.kotest.matchers.shouldBe
import kotlin.test.Test

/** Invented flights, as in mixedTrip.test.ts: the user's out and back, and a relative's from the other side of the world. */
class MixedTripTest {
    private fun flight(id: String, title: String, from: String, to: String, start: String, end: String, travelers: List<String> = emptyList()) =
        Segment(id, "t", SegmentType.FLIGHT, title, start, end, origin = Place(from, code = from), destination = Place(to, code = to), travelers = travelers)

    private val out = flight("out", "XX 1 LHR to DXB", "LHR", "DXB", "2026-12-12T09:00:00+00:00", "2026-12-12T19:00:00+04:00")
    private val back = flight("back", "XX 2 DXB to LHR", "DXB", "LHR", "2026-12-20T09:00:00+04:00", "2026-12-20T13:00:00+00:00")
    private val stay = Segment(
        "stay", "t", SegmentType.LODGING, "Example Hotel", "2026-12-12T20:00:00+04:00", "2026-12-20T07:00:00+04:00",
        destination = Place("Example Hotel", city = "Dubai", country = "AE"),
    )

    @Test
    fun isNothingForOneTravelersJourneyWithAConnectionAndAFlightBookedTwice() {
        val onward = flight("onward", "XX 3 DXB to SYD", "DXB", "SYD", "2026-12-12T22:00:00+04:00", "2026-12-13T18:00:00+11:00")
        mixedTrip(listOf(out, stay, back)) shouldBe null
        mixedTrip(listOf(out, onward)) shouldBe null
        mixedTrip(listOf(out, out.copy(id = "again", title = "XX 1"), back)) shouldBe null
        // Nor when the bookings don't say when it lands.
        mixedTrip(listOf(out.copy(end = null), out.copy(id = "again", title = "XX 1", end = null))) shouldBe null
        mixedTrip(emptyList()) shouldBe null
    }

    @Test
    fun isTwoFlightsInTheAirAtOnce() {
        // 04:00 to 13:00 UTC, while XX 1 flies 09:00 to 15:00.
        val theirs = flight("theirs", "YY 9 SYD to SIN", "SYD", "SIN", "2026-12-12T15:00:00+11:00", "2026-12-12T21:00:00+08:00")
        mixedTrip(listOf(out, theirs, back)) shouldBe MixedTrip.Overlap(theirs, out)
        mixedTrip(listOf(out, theirs.copy(cancelledAt = "2026-11-01T00:00:00Z"))) shouldBe null
    }

    @Test
    fun isAFlightLeavingFromAnotherCountryHoursAfterTheLastLandedButNotDaysAfter() {
        // Six hours after XX 1 lands in Dubai (15:00 UTC).
        val theirs = flight("theirs", "YY 8 SYD to AKL", "SYD", "AKL", "2026-12-13T08:00:00+11:00", "2026-12-13T13:00:00+13:00")
        mixedTrip(listOf(out, theirs)) shouldBe MixedTrip.Elsewhere(out, theirs)
        mixedTrip(listOf(out, theirs.copy(start = "2026-12-16T08:00:00+11:00", end = "2026-12-16T13:00:00+13:00"))) shouldBe null
    }

    @Test
    fun isBookingsForTwoGroupsOfPeopleWhoShareNoFlight() {
        val ours = listOf(out.copy(travelers = listOf("Sam Example")), back.copy(travelers = listOf("SAM EXAMPLE")), stay.copy(travelers = listOf("Sam Example")))
        val theirs = flight("theirs", "YY 7 LHR to DXB", "LHR", "DXB", "2026-12-14T09:00:00+00:00", "2026-12-14T19:00:00+04:00", listOf("Pat Example"))
        mixedTrip(ours + theirs) shouldBe MixedTrip.Travelers(listOf(listOf("Sam Example"), listOf("Pat Example")))
        // A party booked apart on the same flight is one trip.
        mixedTrip(ours + out.copy(id = "pat", travelers = listOf("Pat Example"))) shouldBe null
        // Names on one booking travel together.
        mixedTrip(ours + theirs.copy(travelers = listOf("Pat Example", "Sam Example"))) shouldBe null
        // A party joined by one who flies out with some and back with others.
        mixedTrip(
            listOf(
                out.copy(travelers = listOf("Alice Example")), out.copy(id = "out2", travelers = listOf("Bob Example")),
                back.copy(travelers = listOf("Bob Example")), back.copy(id = "back2", travelers = listOf("Carol Example")),
            ),
        ) shouldBe null
        // Another spelling of one person is that person.
        mixedTrip(listOf(out.copy(travelers = listOf("John Smith")), back.copy(travelers = listOf("John Andrew Smith")), theirs.copy(travelers = listOf("J Smith")))) shouldBe null
        // One the owner took off the trip doesn't count.
        mixedTrip(ours + theirs, listOf("Pat Example")) shouldBe null
    }
}
