package app.travelmo.core

import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import kotlin.test.Test

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
    fun `leaves cancelled journeys out`() {
        fun cancelled(legs: List<Segment>) = legs.map { it.copy(cancelledAt = "2025-01-01T00:00:00Z") }
        val bookings = roundTrip("London", "Paris", "2025-03-12", "2025-03-15") +
            cancelled(roundTrip("Sydney", "Melbourne", "2025-05-01", "2025-05-04")) +
            cancelled(roundTrip("Sydney", "Perth", "2025-07-01", "2025-07-04"))
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
    fun `orders legs by the instant they leave across the date line`() {
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

    // Someone living in London who visits family in Boston each winter.
    private val londonYears = roundTrip("London", "Paris", "2022-05-02", "2022-05-06") +
        roundTrip("London", "Rome", "2023-04-03", "2023-04-07") +
        roundTrip("London", "Lisbon", "2024-03-04", "2024-03-08") +
        roundTrip("London", "Berlin", "2024-07-01", "2024-07-05") +
        roundTrip("London", "Madrid", "2024-10-07", "2024-10-11") +
        roundTrip("London", "Oslo", "2025-04-07", "2025-04-11") +
        roundTrip("London", "Prague", "2025-09-01", "2025-09-05")
    private val winters = listOf(
        flight("2024-01-04T18:00:00-05:00", "Boston", "London"),
        flight("2024-12-20T09:00:00+00:00", "London", "Boston"),
        flight("2025-01-04T18:00:00-05:00", "Boston", "London"),
        flight("2025-12-19T09:00:00+00:00", "London", "Boston"),
        flight("2026-01-03T18:00:00-05:00", "Boston", "London"),
    )
    private val sideTrips = roundTrip("Boston", "New York", "2023-12-22", "2023-12-24") +
        roundTrip("Boston", "Portland", "2023-12-28", "2023-12-30")

    @Test
    fun `keeps home through visits whose first outbound flight is missing`() {
        homeTimeline(londonYears + winters) shouldBe listOf(HomePeriod("London"))
        homeTimeline(londonYears + winters + sideTrips) shouldBe listOf(HomePeriod("London"))
        val outbound = flight("2023-12-18T09:00:00+00:00", "London", "Boston")
        homeTimeline(londonYears + outbound + winters + sideTrips) shouldBe listOf(HomePeriod("London"))
    }

    @Test
    fun `still moves after years of trips from the new home and none from the old`() {
        val bookings = roundTrip("London", "Paris", "2020-05-02", "2020-05-06") +
            roundTrip("London", "Rome", "2021-04-03", "2021-04-07") +
            flight("2022-01-10T09:00:00+00:00", "London", "Boston") +
            roundTrip("Boston", "Chicago", "2022-03-01", "2022-03-05") +
            roundTrip("Boston", "Denver", "2022-08-10", "2022-08-14") +
            roundTrip("Boston", "London", "2023-07-01", "2023-07-15") +
            roundTrip("Boston", "Miami", "2024-01-02", "2024-01-06")
        homeTimeline(bookings) shouldBe listOf(HomePeriod("London", until = "2022-02-28"), HomePeriod("Boston", from = "2022-03-01"))
    }

    @Test
    fun `knows no home without a round trip`() {
        homeTimeline(listOf(flight("2025-04-01T09:00:00+00:00", "London", "Boston"))) shouldBe emptyList()
        homeTimeline(listOf(club("c", "Holiday Club", "2026-05-22T09:00:00+01:00"))) shouldBe emptyList()
    }

    @Test
    fun `finds the home of a date letting a correction win for its dates`() {
        val periods = listOf(HomePeriod("Boston", until = "2021-03-11"), HomePeriod("London", from = "2021-03-12"))
        homeAt(periods, "2020-06-01")?.city shouldBe "Boston"
        homeAt(periods, "2021-03-12")?.city shouldBe "London"
        homeAt(emptyList(), "2021-03-12").shouldBeNull()
        val overrides = listOf(HomePeriod("Cambridge", from = "2020-09-01", until = "2021-03-11"))
        homeAt(periods, "2020-10-01", overrides)?.city shouldBe "Cambridge"
        homeAt(periods, "2020-06-01", overrides).shouldBeNull()
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

    @Test
    fun `does not call a ride home from the airport a day out at home unlike a car hired there`() {
        val periods = listOf(HomePeriod("London", "GB"))
        val home = Place("1 Example Road, London N1 1AA", city = "London", country = "GB")
        val ride = Segment(
            "r", "t", SegmentType.CAR_RENTAL, "Abetta Car from Heathrow Terminal 3 to London", "2026-07-23T15:27:00+01:00",
            origin = Place("Heathrow Terminal 3 - LHR, TW6 1SX", city = "London", country = "GB"), destination = home,
        )
        val hertz = Place("Hertz Islington", city = "London", country = "GB")
        val hire = Segment("h", "t", SegmentType.CAR_RENTAL, "Hertz", "2026-07-23T09:00:00+01:00", origin = hertz, destination = hertz)
        isTransfer(ride) shouldBe true
        isTransfer(hire) shouldBe false
        isTransfer(ride.copy(destination = null)) shouldBe false
        isTransfer(ride.copy(type = SegmentType.LODGING)) shouldBe false
        isAtHome(ride, periods) shouldBe false
        isAtHome(hire, periods) shouldBe true
    }

    @Test
    fun `runs each correction until the next keeping the later of two on one date`() {
        homeCorrections(listOf(HomeCorrection("London", "GB", "2021-03-12"), HomeCorrection("Boston", "US", "2018-09-01"))) shouldBe listOf(
            HomePeriod("Boston", "US", from = "2018-09-01", until = "2021-03-11"),
            HomePeriod("London", "GB", from = "2021-03-12"),
        )
        homeCorrections(listOf(HomeCorrection("Leeds", from = "2021-03-12"), HomeCorrection("London", from = "2021-03-12"))) shouldBe
            listOf(HomePeriod("London", from = "2021-03-12"))
    }

    @Test
    fun `reads a country saved by name or short form as its code and a city by either of its names`() {
        homeCorrections(listOf(HomeCorrection("London", "UK", "2022-01-15"))) shouldBe listOf(HomePeriod("London", "GB", from = "2022-01-15"))
        countryCode("United Kingdom") shouldBe "GB"
        countryCode("gb") shouldBe "GB"
        sameCity("Göteborg", "Gothenburg") shouldBe true
        sameCity("Zürich", "zurich") shouldBe true
        sameCity("København", "Copenhagen") shouldBe true
        sameCity("Kraków", "Cracow") shouldBe true
        sameCity("London", "Londonderry") shouldBe false
    }

    @Test
    fun `is the corrections alone once there are any with no home before them`() {
        val inferred = listOf(HomePeriod("Boston", until = "2021-03-11"), HomePeriod("London", from = "2021-03-12"))
        effectiveHomes(inferred, emptyList()) shouldBe inferred
        effectiveHomes(inferred, listOf(HomeCorrection("Cambridge", "GB", "2020-09-01"))) shouldBe listOf(
            HomePeriod("Cambridge", "GB", from = "2020-09-01"),
        )
        effectiveHomes(listOf(HomePeriod("London")), listOf(HomeCorrection("London", from = "2024-01-01"))) shouldBe
            listOf(HomePeriod("London", from = "2024-01-01"))
    }

    @Test
    fun `drops a home inferred before the earliest correction`() {
        val corrections = listOf(
            HomeCorrection("London", from = "2022-01-15"),
            HomeCorrection("Mountain View", from = "2011-11-25"),
            HomeCorrection("Elsternwick", from = "2003-03-01"),
        )
        val homes = effectiveHomes(listOf(HomePeriod("London")), corrections)
        describeHomes(homes) shouldBe "London since Jan 2022 · Mountain View 2011–2022 · Elsternwick 2003–2011"
        homeAt(homes, "2003-02-28").shouldBeNull()
        homeAt(listOf(HomePeriod("London")), "2003-02-28", homeCorrections(corrections)).shouldBeNull()
        homeAt(homes, "2015-06-01")?.city shouldBe "Mountain View"
    }

    @Test
    fun `says home over time newest first`() {
        describeHomes(listOf(HomePeriod("Boston", from = "2018-09-01", until = "2021-03-11"), HomePeriod("London", from = "2021-03-12"))) shouldBe
            "London since Mar 2021 · Boston 2018–2021"
        describeHomes(listOf(HomePeriod("Boston", until = "2021-03-11"), HomePeriod("London", from = "2021-03-12"))) shouldBe
            "London since Mar 2021 · Boston until 2021"
        describeHomes(listOf(HomePeriod("London"))) shouldBe "London"
        describeHomes(emptyList()) shouldBe ""
    }
    @Test
    fun `measures the distance between two points`() {
        kotlin.math.round(distanceKm(51.507, -0.128, 48.857, 2.352)) shouldBe 343.0
    }

    @Test
    fun `puts a car hired in a town next to the airport with its flight`() {
        val heathrow = Place("London Heathrow", code = "LHR", city = "London", country = "GB", lat = 51.470, lon = -0.454)
        nearHub(Place("Car hire", city = "Hounslow", country = "GB", lat = 51.468, lon = -0.361), heathrow) shouldBe true
        nearHub(Place("Car hire", city = "Reading", country = "GB", lat = 51.454, lon = -0.973), heathrow) shouldBe false
        nearHub(Place("Car hire", city = "Hounslow", country = "GB"), heathrow) shouldBe false
    }

    // Mirrors packages/core/src/homeCorrections.test.ts.
    @Test
    fun `says where home has been newest first`() {
        homeLine(listOf(HomePeriod("Boston", from = "2018-09-01", until = "2021-03-11"), HomePeriod("London", from = "2021-03-12"))) shouldBe
            "Home: London since Mar 2021 · Boston 2018–2021"
        homeLine(emptyList()).shouldBeNull()
    }

    @Test
    fun `names a correction's town and date`() {
        correctionText(HomeCorrection("London", "GB", "2021-03-12")) shouldBe "London, GB from 12 Mar 2021"
        correctionText(HomeCorrection("London", from = "2021-03-12")) shouldBe "London from 12 Mar 2021"
    }

    @Test
    fun `takes a city and an optional country and a date and says what is missing`() {
        parseCorrection(" London ", "gb", "2021-03-12") shouldBe ParsedCorrection.Correction(HomeCorrection("London", "GB", "2021-03-12"))
        parseCorrection("London", "", "2021-03-12") shouldBe ParsedCorrection.Correction(HomeCorrection("London", from = "2021-03-12"))
        parseCorrection("London", "UK", "2021-03-12") shouldBe ParsedCorrection.Correction(HomeCorrection("London", "GB", "2021-03-12"))
        parseCorrection("Boston", "United States", "2021-03-12") shouldBe ParsedCorrection.Correction(HomeCorrection("Boston", "US", "2021-03-12"))
        parseCorrection("", "GB", "2021-03-12") shouldBe ParsedCorrection.Problem("Enter a city.")
        parseCorrection("x".repeat(100), "", "2021-03-12") shouldBe ParsedCorrection.Correction(HomeCorrection("x".repeat(100), from = "2021-03-12"))
        parseCorrection("x".repeat(101), "", "2021-03-12") shouldBe ParsedCorrection.Problem("Use a city name of at most 100 characters.")
        parseCorrection("London", "GBR", "2021-03-12") shouldBe ParsedCorrection.Problem("Use a two-letter country code, such as GB.")
        parseCorrection("London", "ZZ", "2021-03-12") shouldBe ParsedCorrection.Problem("Use a two-letter country code, such as GB.")
        parseCorrection("London", "GB", "") shouldBe ParsedCorrection.Problem("Enter a date.")
    }

    private val cdg = Place("Paris Charles de Gaulle", code = "CDG", city = "Paris", country = "FR")
    private val jfk = Place("JFK", code = "JFK", city = "New York", country = "US")
    private val ewr = Place("Newark", code = "EWR", city = "Newark", country = "US")
    private val toParis = Segment("p", "t", SegmentType.FLIGHT, "ZAG to PAR", "2026-04-04T16:00:00+02:00", "2026-04-04T18:15:00+02:00", destination = cdg)
    private val toNewYork = Segment("n", "t", SegmentType.FLIGHT, "PAR to JFK", "2026-04-04T20:30:00+02:00", "2026-04-04T22:40:00-04:00", origin = cdg, destination = jfk)
    private val homeFlight = Segment("h", "t", SegmentType.FLIGHT, "EWR to LHR", "2026-04-11T09:10:00-04:00", "2026-04-11T21:25:00+01:00", origin = ewr)
    private val london = listOf(HomePeriod("London", "GB"))

    @Test
    fun `takes a flight on within twelve hours from the same city as a connection`() {
        isConnection(toParis, toNewYork) shouldBe true
        isConnection(toParis, toNewYork.copy(start = "2026-04-05T20:30:00+02:00")) shouldBe false
    }

    @Test
    fun `lets a flight that lands away open the trip whose first flight leaves that city from another of its airports too`() {
        opensTrip(toNewYork, homeFlight, london) shouldBe true
        opensTrip(toNewYork, homeFlight.copy(origin = Place("Boston Logan", code = "BOS", city = "Boston", country = "US")), london) shouldBe false
        val lhr = Place("Heathrow", code = "LHR", city = "London", country = "GB")
        opensTrip(toNewYork.copy(destination = lhr), homeFlight.copy(origin = lhr), london) shouldBe false
    }

    @Test
    fun `home's airports are where two round trips leave from while living there and landing at one is coming home`() {
        val sfo = Place("San Francisco International", code = "SFO", city = "San Francisco", country = "US")
        val bos = Place("Boston Logan", code = "BOS", city = "Boston", country = "US")
        val sea = Place("Seattle-Tacoma", code = "SEA", city = "Seattle", country = "US")
        fun leg(id: String, start: String, from: Place, to: Place) = Segment(id, "t", SegmentType.FLIGHT, "${from.code} to ${to.code}", start, origin = from, destination = to)
        val boston = listOf(leg("b1", "2021-11-22T08:00:00-08:00", sfo, bos), leg("b2", "2021-12-01T13:00:00-05:00", bos, sfo))
        val seattle = listOf(leg("s1", "2021-12-03T08:00:00-08:00", sfo, sea), leg("s2", "2021-12-06T18:00:00-08:00", sea, sfo))
        val corrected = homeCorrections(listOf(HomeCorrection("Mountain View", "US", "2011-01-01")))
        val withAirports = withHomeAirports(corrected, boston + seattle)
        withAirports.single().airports.map { it.code } shouldBe listOf("SFO")
        withHomeAirports(corrected, boston).single().airports shouldBe emptyList()
        journeyHome(sfo, "2021-12-01", emptyList(), withAirports) shouldBe true
        journeyHome(sfo, "2021-12-01", emptyList(), corrected) shouldBe false
        // Side trips on a visit whose way out was never imported say nothing about home's airports.
        val lhr = Place("London Heathrow", code = "LHR", city = "London", country = "GB")
        val jfk = Place("John F. Kennedy", code = "JFK", city = "New York", country = "US")
        val londonTrips = listOf(
            leg("l1", "2021-03-01T09:00:00+00:00", lhr, sea), leg("l2", "2021-03-08T09:00:00-08:00", sea, lhr),
            leg("l3", "2021-05-01T09:00:00+01:00", lhr, sea), leg("l4", "2021-05-08T09:00:00-07:00", sea, lhr),
            leg("v1", "2021-09-03T09:00:00-04:00", bos, jfk), leg("v2", "2021-09-05T09:00:00-04:00", jfk, bos),
            leg("v3", "2021-09-10T09:00:00-04:00", bos, jfk), leg("v4", "2021-09-12T09:00:00-04:00", jfk, bos),
            leg("v5", "2021-09-20T19:00:00-04:00", bos, lhr),
            leg("l5", "2021-10-01T09:00:00+01:00", lhr, sea), leg("l6", "2021-10-08T09:00:00-07:00", sea, lhr),
        )
        withHomeAirports(homeCorrections(listOf(HomeCorrection("London", "GB", "2020-01-01"))), londonTrips).single().airports.map { it.code } shouldBe listOf("LHR")
        // SFO and Oakland, 18 km apart, are one home as homeTimeline tells it.
        val sfoAt = sfo.copy(lat = 37.62, lon = -122.38)
        val oak = Place("Oakland International", code = "OAK", city = "Oakland", country = "US", lat = 37.72, lon = -122.22)
        val bayTrips = listOf(
            leg("o1", "2021-01-01T08:00:00-08:00", sfoAt, sea), leg("o2", "2021-01-05T08:00:00-08:00", sea, sfoAt),
            leg("o3", "2021-02-01T08:00:00-08:00", oak, sea), leg("o4", "2021-02-05T08:00:00-08:00", sea, oak),
            leg("o5", "2021-03-01T08:00:00-08:00", oak, sea), leg("o6", "2021-03-05T08:00:00-08:00", sea, oak),
        )
        withHomeAirports(corrected, bayTrips).single().airports.map { it.code } shouldBe listOf("OAK")
        // Same-named stations in other towns are not home's.
        val washington = Place("Union Station", city = "Washington", country = "US")
        val nyp = Place("Penn Station", city = "New York", country = "US")
        fun train(id: String, start: String, from: Place, to: Place) = Segment(id, "t", SegmentType.TRAIN, "Amtrak", start, origin = from, destination = to)
        val amtrak = listOf(
            train("a1", "2021-01-01T08:00:00-05:00", washington, nyp), train("a2", "2021-01-03T08:00:00-05:00", nyp, washington),
            train("a3", "2021-02-01T08:00:00-05:00", washington, nyp), train("a4", "2021-02-03T08:00:00-05:00", nyp, washington),
        )
        val arlington = withHomeAirports(homeCorrections(listOf(HomeCorrection("Arlington", "US", "2020-01-01"))), amtrak)
        journeyHome(washington, "2021-03-01", emptyList(), arlington) shouldBe true
        journeyHome(Place("Union Station", city = "Chicago", country = "US"), "2021-03-01", emptyList(), arlington) shouldBe false
        // Landing home at SFO opens nothing: the next trip is its own.
        opensTrip(boston[1], seattle[0], emptyList(), withAirports) shouldBe false
    }

    @Test
    fun `chosen home airports replace those worked out and are typed as codes`() {
        val periods = listOf(HomePeriod("Mountain View", "US", from = "2011-01-01", airports = listOf(Place("SFO", code = "SFO"))))
        withChosenAirports(periods, listOf(ChosenHomeAirports("mountain view", "US", listOf("SJC", "SFO")))).single().let { airportCodes(it) } shouldBe listOf("SJC", "SFO")
        withChosenAirports(periods, listOf(ChosenHomeAirports("London", null, listOf("LHR")))).single().let { airportCodes(it) } shouldBe listOf("SFO")
        parseAirportCodes(" sfo, SJC  oak sfo") shouldBe ParsedAirports.Codes(listOf("SFO", "SJC", "OAK"))
        homeTownKey(" london ", "UK") shouldBe homeTownKey("London", "GB")
        (homeTownKey("London", "GB") == homeTownKey("London", "CA")) shouldBe false
        homeTownKey("München", "DE") shouldBe homeTownKey("Munich", "DE")
        withChosenAirports(listOf(HomePeriod("München", "DE")), listOf(ChosenHomeAirports("Munich", "DE", listOf("MUC")))).single().let { airportCodes(it) } shouldBe listOf("MUC")
        parseAirportCodes("Manchester Airport") shouldBe ParsedAirports.Problem("\"Manchester\" isn't an airport or station code.")
    }
}
