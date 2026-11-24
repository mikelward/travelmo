package app.travelmo.core

import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import kotlin.test.Test

// Mirrors packages/core/src/journeyGap.test.ts.
private val heathrow = Place("Heathrow", code = "LHR", city = "London", country = "GB")
private val gatwick = Place("Gatwick", code = "LGW", city = "London", country = "GB")
private val logan = Place("Logan", code = "BOS", city = "Boston", country = "US")

private fun flight(id: String, start: String, end: String, origin: Place, destination: Place, type: SegmentType = SegmentType.FLIGHT) =
    Segment(id, "t", type, id, start, end = end, confirmation = "AB12CD", origin = origin, destination = destination)

private val out = flight("out", "2026-11-24T17:20:00+00:00", "2026-11-24T20:15:00-05:00", heathrow, logan)
private val back = flight("back", "2026-11-29T19:15:00-05:00", "2026-11-30T06:50:00+00:00", logan, heathrow)
private val hotel = Segment("hotel", "t", SegmentType.LODGING, "Example Hotel", "2026-11-24T22:00:00-05:00", destination = Place("Example Hotel", city = "Boston", country = "US"))
private val london = listOf(HomePeriod("London", "GB"))

class JourneyGapTest {
    @Test
    fun `finds the flight back a trip that only goes out is missing`() {
        journeyGap(listOf(out, hotel)) shouldBe JourneyGap("back", "London", "flight", "2026-11-24", listOf("AB12CD"))
    }

    @Test
    fun `finds nothing missing on a trip that comes back to any of the city's airports`() {
        journeyGap(listOf(out, hotel, back)).shouldBeNull()
        journeyGap(listOf(out, back.copy(destination = gatwick))).shouldBeNull()
    }

    @Test
    fun `goes by what is still booked`() {
        journeyGap(listOf(out, back.copy(cancelledAt = "2026-11-01T00:00:00Z")))?.direction shouldBe "back"
    }

    @Test
    fun `says journey when not every journey flies`() {
        journeyGap(listOf(out.copy(type = SegmentType.TRAIN)))?.mode shouldBe "journey"
    }

    @Test
    fun `finds the journey out a trip that only comes home is missing once home is known`() {
        journeyGap(listOf(back), london) shouldBe JourneyGap("out", "Boston", "flight", "2026-11-29", listOf("AB12CD"))
        journeyGap(listOf(back))?.direction shouldBe "back"
    }

    @Test
    fun `counts landing at a home's chosen airport as coming home`() {
        val toSfo = back.copy(destination = Place("San Francisco", code = "SFO", city = "San Francisco", country = "US"))
        val mountainView = listOf(HomeCorrection("Mountain View", "US", "2020-01-01"))
        journeyGap(listOf(toSfo), journeyGapHomes(mountainView, listOf(ChosenHomeAirports("Mountain View", "US", listOf("SFO")))))?.direction shouldBe "out"
        journeyGap(listOf(toSfo), journeyGapHomes(mountainView, emptyList()))?.direction shouldBe "back"
    }

    @Test
    fun `finds nothing on a trip with no journeys`() {
        journeyGap(listOf(hotel)).shouldBeNull()
        journeyGap(emptyList()).shouldBeNull()
    }

    @Test
    fun `names the city and searches by references and keeps the newest one-way trips`() {
        journeyGapText(JourneyGap("back", "London", "flight", "2026-11-24", emptyList())) shouldBe "No flight back to London found"
        journeyGapText(JourneyGap("out", "Boston", "journey", "2026-11-29", emptyList())) shouldBe "No journey to Boston found"
        journeyGapSearch(JourneyGap("back", "London", "flight", "2026-11-24", listOf("AB12CD", "EF34"))) shouldBe "AB12CD OR EF34"
        journeyGapSearch(JourneyGap("back", "London", "flight", "2026-11-24", emptyList())) shouldBe "\"London\""
        gmailSearchUrl("AB12CD OR EF34") shouldBe "https://mail.google.com/mail/u/0/#search/AB12CD%20OR%20EF34"
        withOneWay(listOf("t1", "t2"), "t1") shouldBe listOf("t2", "t1")
        withOneWay(List(200) { "t$it" }, "new") shouldHaveSize 200
    }
}
