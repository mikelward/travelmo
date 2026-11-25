package app.travelmo.core

import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.shouldBe
import kotlin.test.Test

// Mirrors packages/core/src/journeyGap.test.ts.
private val heathrow = Place("Heathrow", code = "LHR", city = "London", country = "GB")
private val gatwick = Place("Gatwick", code = "LGW", city = "London", country = "GB")
private val logan = Place("Logan", code = "BOS", city = "Boston", country = "US")

private fun flight(id: String, start: String, end: String, origin: Place, destination: Place, type: SegmentType = SegmentType.FLIGHT) =
    Segment(id, "t", type, id, start, end = end, origin = origin, destination = destination)

private val out = flight("out", "2026-11-24T17:20:00+00:00", "2026-11-24T20:15:00-05:00", heathrow, logan)
private val back = flight("back", "2026-11-29T19:15:00-05:00", "2026-11-30T06:50:00+00:00", logan, heathrow)
private val hotel = Segment("hotel", "t", SegmentType.LODGING, "Example Hotel", "2026-11-24T22:00:00-05:00", destination = Place("Example Hotel", city = "Boston", country = "US"))
private val london = listOf(HomePeriod("London", "GB"))

private val melbourne = Place("Melbourne", code = "MEL", city = "Melbourne", country = "AU")
private val sydney = Place("Sydney", code = "SYD", city = "Sydney", country = "AU")
private val adelaide = Place("Adelaide", code = "ADL", city = "Adelaide", country = "AU")
private val hurghada = Place("Hurghada", code = "HRG", city = "Hurghada", country = "EG")
private val toSydney = flight("mel", "2026-01-02T09:00:00+11:00", "2026-01-02T10:30:00+11:00", melbourne, sydney)
private val toAdelaide = flight("adl", "2026-01-08T09:00:00+11:00", "2026-01-08T10:30:00+10:30", sydney, adelaide)
private val egypt = flight("hrg", "2026-02-15T08:00:00+00:00", "2026-02-15T15:00:00+02:00", gatwick, hurghada)
private val egyptBack = flight("lgw", "2026-02-22T16:00:00+02:00", "2026-02-22T20:00:00+00:00", hurghada, gatwick)

class JourneyGapTest {
    @Test
    fun `finds the flight back a trip that only goes out is missing`() {
        journeyGaps(listOf(out, hotel)) shouldBe listOf(JourneyGap("back", "Boston", "London", "flight", "2026-11-24", fromCode = "BOS", toCode = "LHR"))
    }

    @Test
    fun `finds nothing missing on a trip that comes back to any of the city's airports`() {
        journeyGaps(listOf(out, hotel, back)).shouldBeEmpty()
        journeyGaps(listOf(out, back.copy(destination = gatwick))).shouldBeEmpty()
    }

    @Test
    fun `takes two travelers' bookings on one flight as one journey`() {
        journeyGaps(listOf(out, out.copy(id = "out2", confirmation = "ZZ99"), back)).shouldBeEmpty()
    }

    @Test
    fun `goes by what is still booked`() {
        journeyGaps(listOf(out, back.copy(cancelledAt = "2026-11-01T00:00:00Z"))).map { it.direction } shouldBe listOf("back")
    }

    @Test
    fun `says journey when not every journey flies`() {
        journeyGaps(listOf(out.copy(type = SegmentType.TRAIN))).first().mode shouldBe "journey"
    }

    @Test
    fun `finds the journey out a trip that only comes home is missing once home is known`() {
        journeyGaps(listOf(back), london) shouldBe listOf(JourneyGap("out", "London", "Boston", "flight", "2026-11-29", fromCode = "LHR", toCode = "BOS"))
        journeyGaps(listOf(back)).first().direction shouldBe "back"
    }

    @Test
    fun `counts landing at a home's chosen airport as coming home`() {
        val toSfo = back.copy(destination = Place("San Francisco", code = "SFO", city = "San Francisco", country = "US"))
        val mountainView = listOf(HomeCorrection("Mountain View", "US", "2020-01-01"))
        journeyGaps(listOf(toSfo), journeyGapHomes(mountainView, listOf(ChosenHomeAirports("Mountain View", "US", listOf("SFO"))))).first().direction shouldBe "out"
        journeyGaps(listOf(toSfo), journeyGapHomes(mountainView, emptyList())).first().direction shouldBe "back"
    }

    @Test
    fun `finds a journey missing between two in order with the trip's ends`() {
        journeyGaps(listOf(egyptBack, toAdelaide, egypt, toSydney), london) shouldBe listOf(
            JourneyGap("out", "London", "Melbourne", "flight", "2026-01-02", fromCode = "LGW", toCode = "MEL"),
            JourneyGap("between", "Adelaide", "London", "flight", "2026-01-08", until = "2026-02-15", fromCode = "ADL", toCode = "LGW"),
        )
    }

    @Test
    fun `takes a drive between journeys as no gap`() {
        val birmingham = Place("Birmingham", code = "BHX", city = "Birmingham", country = "GB")
        journeyGaps(listOf(back, out.copy(origin = birmingham, start = "2026-12-01T10:00:00+00:00", end = "2026-12-01T13:00:00-05:00"))).shouldBeEmpty()
        val canberra = Place("Canberra", code = "CBR", city = "Canberra", country = "AU")
        journeyGaps(listOf(toSydney, toAdelaide.copy(origin = canberra))).map { it.direction } shouldBe listOf("back")
    }

    @Test
    fun `leaves out the trip's ends once it is one way not the gaps between`() {
        journeyGaps(listOf(out), oneWay = true).shouldBeEmpty()
        journeyGaps(listOf(toAdelaide, egypt), oneWay = true).map { it.direction } shouldBe listOf("between")
    }

    @Test
    fun `finds nothing on a trip with no journeys`() {
        journeyGaps(listOf(hotel)).shouldBeEmpty()
        journeyGaps(emptyList()).shouldBeEmpty()
    }

    @Test
    fun `names where the missing journey goes and when one between could be`() {
        journeyGapText(JourneyGap("back", "Boston", "London", "flight", "2026-11-24")) shouldBe "No flight from Boston back to London found"
        journeyGapText(JourneyGap("out", "London", "Boston", "journey", "2026-11-24")) shouldBe "No journey from London to Boston found"
        journeyGapText(JourneyGap("between", "Adelaide", "London", "flight", "2026-01-08", until = "2026-02-15")) shouldBe
            "No flight from Adelaide to London found between 8 Jan and 15 Feb"
        journeyGapText(JourneyGap("between", "Boston", "London", "flight", "2026-11-24", until = "2026-11-24")) shouldBe "No flight from Boston to London found on 24 Nov"
        journeyGapText(JourneyGap("between", "Boston", "London", "flight", "2026-09-01", until = "2026-09-02")) shouldBe
            "No flight from Boston to London found between 1 Sept and 2 Sept"
    }

    @Test
    fun `searches for both ends by city or code and keeps the newest one-way trips`() {
        journeyGapSearch(JourneyGap("back", "Adelaide", "London", "flight", "2026-01-10", fromCode = "ADL", toCode = "LHR")) shouldBe "(\"Adelaide\" OR ADL) (\"London\" OR LHR)"
        journeyGapSearch(JourneyGap("back", "Bath", "Say \"Hi\"", "journey", "2026-01-10")) shouldBe "\"Bath\" \"Say  Hi \""
        gmailSearchUrl("\"Bath\" \"London\"") shouldBe "https://mail.google.com/mail/u/0/#search/%22Bath%22%20%22London%22"
        withOneWay(listOf("t1", "t2"), "t1") shouldBe listOf("t2", "t1")
        withOneWay(List(200) { "t$it" }, "new") shouldHaveSize 200
    }
}
