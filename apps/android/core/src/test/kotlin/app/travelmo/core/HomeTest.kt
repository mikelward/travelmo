package app.travelmo.core

import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test

// Mirrors packages/core/src/home.test.ts.
private val euston = Place("London Euston", code = "EUS", city = "London", country = "GB")
private val limeStreet = Place("Liverpool Lime Street", code = "LIV", city = "Liverpool", country = "GB")
private val academy = Place("Fixation Academy of Performing Arts", city = "London", country = "GB")

private fun club(id: String, title: String, start: String) = Segment(id, "t", SegmentType.ACTIVITY, title, start, destination = academy)
private fun train(id: String, start: String, origin: Place, destination: Place) =
    Segment(id, "t", SegmentType.TRAIN, "Avanti West Coast", start, origin = origin, destination = destination)
private fun flight(start: String, from: String, to: String) =
    Segment("$from-$to-$start", "t", SegmentType.FLIGHT, "$from to $to", start, origin = Place("$from airport", city = from), destination = Place("$to airport", city = to))
private fun roundTrip(from: String, to: String, out: String, back: String) =
    listOf(flight("${out}T09:00:00+00:00", from, to), flight("${back}T18:00:00+00:00", to, from))

// A holiday club at home on either side of a weekend in Liverpool.
private val may = listOf(
    club("c1", "Eva Ward's Stage Stars! Holiday Club", "2026-05-22T00:00:00+01:00"),
    train("t1", "2026-05-23T12:07:00+01:00", euston, limeStreet),
    train("t2", "2026-05-25T11:43:00+01:00", limeStreet, euston),
    club("c2", "Stage Stars! Holiday Club - Day 1", "2026-05-26T09:00:00+01:00"),
)

class HomeTest {
    @Test
    fun `takes home from where a round trip leaves and comes back to`() {
        homeTimeline(may) shouldBe listOf(HomePeriod("London", "GB"))
    }

    @Test
    fun `dates a move from the first of two round trips from the new base`() {
        val bookings = roundTrip("Boston", "Chicago", "2019-03-01", "2019-03-05") +
            roundTrip("Boston", "Denver", "2019-08-10", "2019-08-14") +
            roundTrip("Boston", "Miami", "2020-01-02", "2020-01-06") +
            roundTrip("London", "Paris", "2021-03-12", "2021-03-15") +
            roundTrip("London", "Rome", "2021-06-01", "2021-06-05") +
            roundTrip("London", "Lisbon", "2022-02-10", "2022-02-14")
        homeTimeline(bookings) shouldBe listOf(HomePeriod("Boston", until = "2021-03-11"), HomePeriod("London", from = "2021-03-12"))
    }

    @Test
    fun `does not count one trip from somewhere else as a move`() {
        val bookings = roundTrip("London", "Paris", "2025-03-12", "2025-03-15") +
            roundTrip("Sydney", "Melbourne", "2025-07-01", "2025-07-04") +
            roundTrip("London", "Rome", "2025-09-01", "2025-09-05")
        homeTimeline(bookings) shouldBe listOf(HomePeriod("London"))
    }

    @Test
    fun `follows a trip of several legs back to where it started`() {
        val bookings = listOf(
            flight("2025-04-01T09:00:00+00:00", "London", "Dubai"),
            flight("2025-04-02T03:00:00+04:00", "Dubai", "Sydney"),
            flight("2025-04-20T10:00:00+10:00", "Sydney", "London"),
        )
        homeTimeline(bookings) shouldBe listOf(HomePeriod("London"))
    }

    @Test
    fun `orders legs by the instant they leave, across the date line`() {
        val bookings = listOf(
            Segment("a", "t", SegmentType.FLIGHT, "Tokyo to Honolulu", "2026-01-02T01:00:00+09:00", origin = Place("Haneda", city = "Tokyo"), destination = Place("Honolulu", city = "Honolulu")),
            Segment("b", "t", SegmentType.FLIGHT, "Honolulu to Tokyo", "2026-01-01T22:00:00-10:00", origin = Place("Honolulu", city = "Honolulu"), destination = Place("Haneda", city = "Tokyo")),
        )
        homeTimeline(bookings) shouldBe listOf(HomePeriod("Tokyo"))
    }

    @Test
    fun `takes no home from a journey within one town`() {
        val crossing = Segment("x", "t", SegmentType.FERRY, "Thames Clipper", "2025-02-01T10:00:00+00:00", origin = Place("Westminster Pier", city = "London"), destination = Place("Greenwich Pier", city = "London"))
        homeTimeline(listOf(crossing)) shouldBe emptyList()
        homeTimeline(listOf(crossing) + roundTrip("London", "Rome", "2025-03-01", "2025-03-05")) shouldBe listOf(HomePeriod("London"))
    }

    @Test
    fun `knows no home without a round trip`() {
        homeTimeline(listOf(flight("2025-04-01T09:00:00+00:00", "London", "Boston"))) shouldBe emptyList()
        homeTimeline(listOf(club("c", "Holiday Club", "2026-05-22T09:00:00+01:00"))) shouldBe emptyList()
    }

    @Test
    fun `finds the home of a date, letting a correction win for its dates`() {
        val periods = listOf(HomePeriod("Boston", until = "2021-03-11"), HomePeriod("London", from = "2021-03-12"))
        homeAt(periods, "2020-06-01")?.city shouldBe "Boston"
        homeAt(periods, "2021-03-12")?.city shouldBe "London"
        homeAt(emptyList(), "2021-03-12").shouldBeNull()
        val overrides = listOf(HomePeriod("Cambridge", from = "2020-09-01", until = "2021-03-11"))
        homeAt(periods, "2020-10-01", overrides)?.city shouldBe "Cambridge"
        homeAt(periods, "2020-06-01", overrides)?.city shouldBe "Boston"
    }

    @Test
    fun `puts the holiday club at home and the trains and a Liverpool stay away`() {
        val periods = homeTimeline(may)
        may.map { isAtHome(it, periods) } shouldBe listOf(true, false, false, true)
        val stay = Segment("s", "t", SegmentType.LODGING, "Hotel", "2026-05-23T15:00:00+01:00", destination = Place("Hotel", city = "Liverpool", country = "GB"))
        isAtHome(stay, periods) shouldBe false
        isAtHome(may[0], emptyList()) shouldBe false
        isAtHome(Segment("x", "t", SegmentType.ACTIVITY, "Thing", "2026-05-22T09:00:00+01:00"), periods) shouldBe false
    }
}
