package app.travelmo.core

import io.kotest.matchers.collections.shouldContain
import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.collections.shouldNotContain
import io.kotest.matchers.doubles.plusOrMinus
import io.kotest.matchers.shouldBe
import kotlin.test.Test

// Mirrors packages/core/src/residence.test.ts. Invented trips; every name and booking is made up.
class ResidenceTest {
    private fun flight(from: String, to: String, start: String, end: String) =
        Segment("$from-$to-$start", "t", SegmentType.FLIGHT, "$from to $to", start, end, origin = Place(from, code = from), destination = Place(to, code = to))

    private fun train(from: Place, to: Place, start: String, end: String) =
        Segment("$start-train", "t", SegmentType.TRAIN, "${from.name} to ${to.name}", start, end, origin = from, destination = to)

    private fun trip(id: String, start: String, end: String, segments: List<Segment>) = TripWithSegments(Trip(id, id, start, end, "u"), segments)

    /** Out on the morning of the first, back on the evening of the last. */
    private fun roundTrip(id: String, out: String, back: String, from: String = "LHR", to: String = "CDG") = trip(
        id, out, back,
        listOf(flight(from, to, "${out}T09:00:00+00:00", "${out}T11:20:00+01:00"), flight(to, from, "${back}T18:00:00+01:00", "${back}T18:20:00+00:00")),
    )

    private val london = listOf(HomePeriod("London", "GB"))
    private val boston = listOf(HomePeriod("Boston", "US"))

    private fun rule(setId: String, ruleId: String) = residenceRuleSets.first { it.id == setId }.rules.first { it.id == ruleId }

    private fun evaluate(r: ResidenceRule, trips: List<TripWithSegments>, homes: List<HomePeriod>, date: String) =
        evaluateRule(r, presenceTimeline(trips, homes, shiftDate(date, DateShift(years = -8)), date), date, homes)

    private fun countries(timeline: Map<String, DayPresence>, from: String, to: String) =
        timeline.filterKeys { it in from..to }.mapValues { it.value.countries.sorted() }

    @Test
    fun `moves a date by years months and days keeping to the end of a shorter month`() {
        shiftDate("2024-02-29", DateShift(years = 1)) shouldBe "2025-02-28"
        shiftDate("2026-03-31", DateShift(months = -1)) shouldBe "2026-02-28"
        shiftDate("2026-01-01", DateShift(days = -1)) shouldBe "2025-12-31"
        shiftDate("2026-11-23", DateShift(years = -5, days = 1)) shouldBe "2021-11-24"
    }

    @Test
    fun `counts days at a home saved as UK as days in GB`() {
        countries(presenceTimeline(emptyList(), listOf(HomePeriod("London", "UK")), "2026-03-01", "2026-03-01"), "2026-03-01", "2026-03-01") shouldBe
            mapOf("2026-03-01" to listOf("GB"))
    }

    @Test
    fun `puts a travel day in both countries and the days with no trip at home`() {
        val timeline = presenceTimeline(listOf(roundTrip("paris", "2026-03-02", "2026-03-05")), london, "2026-03-01", "2026-03-06")
        countries(timeline, "2026-03-01", "2026-03-06") shouldBe mapOf(
            "2026-03-01" to listOf("GB"),
            "2026-03-02" to listOf("FR", "GB"),
            "2026-03-03" to listOf("FR"),
            "2026-03-04" to listOf("FR"),
            "2026-03-05" to listOf("FR", "GB"),
            "2026-03-06" to listOf("GB"),
        )
        timeline["2026-03-01"]!!.assumedHome shouldBe true
        timeline["2026-03-03"]!!.assumedHome shouldBe false
        timeline["2026-03-03"]!!.tripIds shouldBe setOf("paris")
    }

    @Test
    fun `counts an overnight flight's departure day only where it left`() {
        val sg = trip("sg", "2026-04-10", "2026-04-11", listOf(flight("LHR", "SIN", "2026-04-10T21:00:00+01:00", "2026-04-11T17:00:00+08:00")))
        countries(presenceTimeline(listOf(sg), london, "2026-04-10", "2026-04-11"), "2026-04-10", "2026-04-11") shouldBe
            mapOf("2026-04-10" to listOf("GB"), "2026-04-11" to listOf("SG"))
    }

    @Test
    fun `puts a day skipped across the date line in no country and does not call it unknown`() {
        val syd = trip("syd", "2026-01-05", "2026-01-07", listOf(flight("LAX", "SYD", "2026-01-05T23:00:00-08:00", "2026-01-07T07:00:00+11:00")))
        val timeline = presenceTimeline(listOf(syd), boston, "2026-01-05", "2026-01-07")
        countries(timeline, "2026-01-05", "2026-01-07") shouldBe mapOf("2026-01-05" to listOf("US"), "2026-01-06" to emptyList(), "2026-01-07" to listOf("AU"))
        timeline["2026-01-06"]!!.inTransit shouldBe true
    }

    @Test
    fun `follows a trip through several countries`() {
        val tour = trip(
            "tour", "2026-06-01", "2026-06-06",
            listOf(
                train(Place("London St Pancras", country = "GB"), Place("Paris Nord", country = "FR"), "2026-06-01T09:00:00+01:00", "2026-06-01T12:30:00+02:00"),
                flight("ORY", "MAD", "2026-06-03T10:00:00+02:00", "2026-06-03T12:00:00+02:00"),
                flight("MAD", "LHR", "2026-06-06T15:00:00+02:00", "2026-06-06T16:30:00+01:00"),
            ),
        )
        countries(presenceTimeline(listOf(tour), london, "2026-06-01", "2026-06-07"), "2026-06-01", "2026-06-07") shouldBe mapOf(
            "2026-06-01" to listOf("FR", "GB"),
            "2026-06-02" to listOf("FR"),
            "2026-06-03" to listOf("ES", "FR"),
            "2026-06-04" to listOf("ES"),
            "2026-06-05" to listOf("ES"),
            "2026-06-06" to listOf("ES", "GB"),
            "2026-06-07" to listOf("GB"),
        )
    }

    @Test
    fun `takes a trip's days before its first booking as at home`() {
        val early = trip("early", "2026-05-01", "2026-05-04", listOf(flight("LHR", "CDG", "2026-05-03T09:00:00+00:00", "2026-05-03T11:20:00+01:00")))
        val timeline = presenceTimeline(listOf(early), london, "2026-05-01", "2026-05-04")
        countries(timeline, "2026-05-01", "2026-05-04") shouldBe
            mapOf("2026-05-01" to listOf("GB"), "2026-05-02" to listOf("GB"), "2026-05-03" to listOf("FR", "GB"), "2026-05-04" to listOf("FR"))
        timeline["2026-05-01"]!!.assumedHome shouldBe true
    }

    @Test
    fun `follows home as it moves and knows no country with no home`() {
        val moved = listOf(HomePeriod("London", "GB", until = "2026-02-28"), HomePeriod("Toronto", "ca", from = "2026-03-01"))
        countries(presenceTimeline(emptyList(), moved, "2026-02-28", "2026-03-01"), "2026-02-28", "2026-03-01") shouldBe
            mapOf("2026-02-28" to listOf("GB"), "2026-03-01" to listOf("CA"))
        countries(presenceTimeline(emptyList(), emptyList(), "2026-02-28", "2026-02-28"), "2026-02-28", "2026-02-28") shouldBe mapOf("2026-02-28" to emptyList())
    }

    @Test
    fun `counts a day two trips share once in every country either puts it in`() {
        val a = roundTrip("a", "2026-03-02", "2026-03-05")
        val b = trip("b", "2026-03-05", "2026-03-06", listOf(train(Place("Paris Nord", country = "FR"), Place("Bruxelles-Midi", country = "BE"), "2026-03-05T08:00:00+01:00", "2026-03-05T09:30:00+01:00")))
        val timeline = presenceTimeline(listOf(a, b, a), london, "2026-03-05", "2026-03-05")
        countries(timeline, "2026-03-05", "2026-03-05") shouldBe mapOf("2026-03-05" to listOf("BE", "FR", "GB"))
        timeline["2026-03-05"]!!.tripIds.sorted() shouldBe listOf("a", "b")
    }

    @Test
    fun `UK settlement does not count the days of leaving and coming back as absences`() {
        val result = evaluate(rule("uk-settlement", "uk-settlement-absences"), listOf(roundTrip("paris", "2026-01-01", "2026-01-10")), london, "2026-11-23")
        result.used shouldBe 8.0
        result.limit shouldBe 180
        result.remaining shouldBe 172.0
        result.status shouldBe ResidenceStatus.OK
        result.stretches shouldBe listOf(Stretch("2026-01-02", "2026-01-09", 8, listOf("FR"), listOf("paris")))
    }

    @Test
    fun `UK settlement finds the worst 12 months over the five years before applying`() {
        val ilr = rule("uk-settlement", "uk-settlement-absences")
        val result = evaluate(ilr, listOf(roundTrip("long", "2023-02-01", "2023-08-19", "LHR", "JFK"), roundTrip("short", "2026-01-01", "2026-01-10")), london, "2026-11-23")
        result.used shouldBe 198.0
        result.status shouldBe ResidenceStatus.OVER
        (result.window.end >= "2023-08-18") shouldBe true
        (result.window.start <= "2023-02-02") shouldBe true
        result.window.start shouldBe shiftDate(result.window.end, DateShift(months = -12, days = 1))
        result.current?.used shouldBe 8
    }

    @Test
    fun `UK settlement is near the limit within a tenth of it`() {
        val result = evaluate(rule("uk-settlement", "uk-settlement-absences"), listOf(roundTrip("long", "2026-01-01", "2026-06-20", "LHR", "JFK")), london, "2026-11-23")
        result.used shouldBe 169.0
        result.status shouldBe ResidenceStatus.NEAR
    }

    @Test
    fun `counts a day no booking places as an absence and says how many there were`() {
        val lost = trip("lost", "2026-04-01", "2026-04-05", listOf(Segment("out", "t", SegmentType.FLIGHT, "Out", "2026-04-01T09:00:00+00:00", "2026-04-01T12:00:00+00:00", origin = Place("Somewhere"), destination = Place("Elsewhere"))))
        val result = evaluate(rule("uk-settlement", "uk-settlement-absences"), listOf(lost), london, "2026-11-23")
        result.used shouldBe 5.0
        result.unknownDays shouldBe 5
        result.unplaced shouldBe listOf(Stretch("2026-04-01", "2026-04-05", 5, emptyList(), listOf("lost")))
        evaluate(rule("schengen", "schengen-90-180"), listOf(lost.copy(trip = lost.trip.copy(start = "2026-11-01", end = "2026-11-03"), segments = lost.segments.map { it.copy(start = "2026-11-01T09:00:00+00:00", end = "2026-11-01T12:00:00+00:00") })), london, "2026-11-23").used shouldBe 3.0
    }

    @Test
    fun `UK citizenship counts absences in the five years and the last 12 months before applying`() {
        val trips = listOf(roundTrip("old", "2022-03-01", "2022-03-31"), roundTrip("recent", "2026-05-01", "2026-08-01"))
        val five = evaluate(rule("uk-citizenship", "uk-citizenship-five-years"), trips, london, "2026-11-23")
        val last = evaluate(rule("uk-citizenship", "uk-citizenship-last-year"), trips, london, "2026-11-23")
        listOf(five.used, five.limit, five.status) shouldBe listOf(120.0, 450, ResidenceStatus.OK)
        five.window shouldBe DateRange("2021-11-24", "2026-11-23")
        listOf(last.used, last.limit, last.status) shouldBe listOf(91.0, 90, ResidenceStatus.OVER)
        last.window shouldBe DateRange("2025-11-24", "2026-11-23")
    }

    @Test
    fun `Schengen counts the days of entering and leaving as days in the area`() {
        val result = evaluate(rule("schengen", "schengen-90-180"), listOf(roundTrip("paris", "2026-11-01", "2026-11-10")), london, "2026-11-23")
        result.used shouldBe 10.0
        result.current shouldBe CurrentWindow(10, DateRange("2026-05-28", "2026-11-23"))
        result.remaining shouldBe 80.0
    }

    @Test
    fun `Schengen counts every member Bulgaria Romania and Croatia included and not Ireland or Cyprus`() {
        for (code in listOf("BG", "RO", "HR", "CH", "NO", "IS", "LI")) schengenCountries shouldContain code
        for (code in listOf("IE", "CY", "GB")) schengenCountries shouldNotContain code
        schengenCountries shouldHaveSize 29
        val trips = listOf(roundTrip("sofia", "2026-10-01", "2026-10-03", "LHR", "SOF"), roundTrip("dublin", "2026-10-10", "2026-10-12", "LHR", "DUB"))
        evaluate(rule("schengen", "schengen-90-180"), trips, london, "2026-11-23").used shouldBe 3.0
    }

    @Test
    fun `Schengen finds a stay over 90 days in 180 and the stays that made it`() {
        val trips = listOf(roundTrip("spring", "2026-03-01", "2026-04-30"), roundTrip("summer", "2026-06-01", "2026-07-15", "LHR", "MAD"))
        val result = evaluate(rule("schengen", "schengen-90-180"), trips, london, "2026-11-23")
        result.used shouldBe 106.0
        result.status shouldBe ResidenceStatus.OVER
        result.stretches shouldBe listOf(
            Stretch("2026-03-01", "2026-04-30", 61, listOf("FR"), listOf("spring")),
            Stretch("2026-06-01", "2026-07-15", 45, listOf("ES"), listOf("summer")),
        )
    }

    @Test
    fun `Schengen checks every 180 days ending in the last year even those that start before it`() {
        val result = evaluate(rule("schengen", "schengen-90-180"), listOf(roundTrip("winter", "2025-10-01", "2026-01-10")), london, "2026-11-23")
        result.used shouldBe 102.0
        result.status shouldBe ResidenceStatus.OVER
        // The latest window holding the whole stay.
        (result.window.start <= "2025-10-01" && result.window.end >= "2026-01-10") shouldBe true
    }

    @Test
    fun `counts the days of a drive between countries as unknown and so as days in the Schengen area`() {
        // A car from Paris to Berlin for three months: where it was each day
        // is not known, so none of those days may drop out of the count.
        val drive = Segment(
            "drive", "drive", SegmentType.CAR_RENTAL, "Car from Paris to Berlin", "2026-01-01T10:00:00+01:00", "2026-04-01T10:00:00+02:00",
            origin = Place("Paris", country = "FR"), destination = Place("Berlin", country = "DE"),
        )
        val result = evaluate(rule("schengen", "schengen-90-180"), listOf(trip("drive", "2026-01-01", "2026-04-01", listOf(drive))), london, "2026-11-23")
        result.used shouldBe 91.0
        result.unknownDays shouldBe 89
        result.status shouldBe ResidenceStatus.OVER
    }

    @Test
    fun `US citizenship counts days present the days of leaving and coming back included`() {
        val result = evaluate(rule("us-citizenship", "us-citizenship-presence"), listOf(roundTrip("london", "2026-01-01", "2026-01-10", "BOS", "LHR")), boston, "2026-11-23")
        result.limit shouldBe 913
        result.used shouldBe 1818.0
        result.status shouldBe ResidenceStatus.OK
        result.stretches.map { it.start to it.end } shouldBe listOf("2026-01-02" to "2026-01-09")
        val spouse = evaluate(rule("us-citizenship-spouse", "us-citizenship-spouse-presence"), emptyList(), london, "2026-11-23")
        listOf(spouse.used, spouse.limit, spouse.status) shouldBe listOf(0.0, 548, ResidenceStatus.OVER)
    }

    @Test
    fun `counts Puerto Rico as the US for citizenship but not for tax`() {
        val pr = listOf(roundTrip("pr", "2026-10-01", "2026-10-31", "LHR", "SJU"))
        evaluate(rule("us-citizenship", "us-citizenship-presence"), pr, london, "2026-11-23").used shouldBe 31.0
        evaluate(rule("us-tax", "us-substantial-presence"), pr, london, "2026-11-23").current?.used shouldBe 0
    }

    @Test
    fun `UK settlement counts only days within the five years not the year before them`() {
        // Home known from the first day of the five years, and nothing before.
        val result = evaluate(rule("uk-settlement", "uk-settlement-absences"), emptyList(), listOf(HomePeriod("London", "GB", from = "2021-11-24")), "2026-11-23")
        result.unknownDays shouldBe 0
        result.used shouldBe 0.0
        result.status shouldBe ResidenceStatus.OK
    }

    @Test
    fun `UK settlement keeps the first window inside five years that start on 29 February`() {
        // 180 days away from the period's first day, then the UK.
        val away = roundTrip("away", "2024-02-28", "2024-08-27", "LHR", "JFK")
        val result = evaluate(rule("uk-settlement", "uk-settlement-absences"), listOf(away), london, "2029-02-28")
        result.period shouldBe QualifyingPeriod("2024-02-29", "2029-02-28", moved = false)
        result.used shouldBe 180.0
        result.unknownDays shouldBe 0
        (result.window.start >= "2024-02-29") shouldBe true
    }

    @Test
    fun `UK settlement starts the five years when the person moved to the UK and lists every absence since`() {
        val homes = listOf(HomePeriod("Sydney", "AU", until = "2023-03-02"), HomePeriod("London", "UK", from = "2023-03-03"))
        // Away before the move counts for nothing; both trips since are listed.
        val trips = listOf(roundTrip("before", "2022-06-01", "2022-12-01", "SYD", "JFK"), roundTrip("one", "2024-01-01", "2024-01-10"), roundTrip("two", "2026-01-01", "2026-01-10"))
        val result = evaluate(rule("uk-settlement", "uk-settlement-absences"), trips, homes, "2026-11-23")
        result.period shouldBe QualifyingPeriod("2023-03-03", "2026-11-23", moved = true)
        result.used shouldBe 8.0
        result.unknownDays shouldBe 0
        result.stretches.map { it.tripIds } shouldBe listOf(listOf("one"), listOf("two"))
    }

    @Test
    fun `UK settlement counts a period shorter than 12 months on its own days`() {
        val homes = listOf(HomePeriod("Sydney", "AU", until = "2026-05-31"), HomePeriod("London", "GB", from = "2026-06-01"))
        val result = evaluate(rule("uk-settlement", "uk-settlement-absences"), listOf(roundTrip("paris", "2026-07-01", "2026-07-10")), homes, "2026-11-23")
        result.window shouldBe DateRange("2026-06-01", "2026-11-23")
        result.current shouldBe CurrentWindow(8, DateRange("2026-06-01", "2026-11-23"))
        result.used shouldBe 8.0
    }

    @Test
    fun `UK settlement keeps the full five years when home has always been the UK`() {
        evaluate(rule("uk-settlement", "uk-settlement-absences"), emptyList(), london, "2026-11-23").period shouldBe QualifyingPeriod("2021-11-24", "2026-11-23", moved = false)
    }

    private fun show(title: String, start: String) = Segment("$start-show", "t", SegmentType.ACTIVITY, title, start, start, origin = Place(title))

    @Test
    fun `a booking that names no place leaves the traveler where a flight took them`() {
        // Out on the 9th, a show with no place on the 10th, back on the 22nd.
        val vegas = trip(
            "vegas", "2026-07-09", "2026-07-22",
            listOf(
                flight("LHR", "LAS", "2026-07-09T10:00:00+01:00", "2026-07-09T13:00:00-07:00"),
                show("A show", "2026-07-10T19:00:00-07:00"),
                flight("LAS", "LHR", "2026-07-21T18:00:00-07:00", "2026-07-22T12:00:00+01:00"),
            ),
        )
        val result = evaluate(rule("uk-settlement", "uk-settlement-absences"), listOf(vegas), london, "2026-11-23")
        result.unknownDays shouldBe 0
        result.unplaced shouldBe emptyList()
        result.stretches shouldBe listOf(Stretch("2026-07-10", "2026-07-21", 12, listOf("US"), listOf("vegas")))
    }

    @Test
    fun `outings that name no place are at home when nothing takes the traveler anywhere`() {
        val club = trip("club", "2025-11-13", "2025-11-13", listOf(show("Drama club", "2025-11-13T16:00:00+00:00")))
        val result = evaluate(rule("uk-settlement", "uk-settlement-absences"), listOf(club), london, "2026-11-23")
        result.used shouldBe 0.0
        result.unknownDays shouldBe 0
    }

    @Test
    fun `a stay that names no place still counts against the traveler`() {
        val away = trip("away", "2026-04-01", "2026-04-03", listOf(Segment("s", "t", SegmentType.LODGING, "Somewhere", "2026-04-01T15:00:00+00:00", "2026-04-03T11:00:00+00:00", destination = Place("Somewhere"))))
        evaluate(rule("uk-settlement", "uk-settlement-absences"), listOf(away), london, "2026-11-23").unknownDays shouldBe 3
    }

    @Test
    fun `names a window the way the report shows it`() {
        spanText(DateShift(months = 12)) shouldBe "12 months"
        spanText(DateShift(days = 180)) shouldBe "180 days"
        spanText(DateShift(years = 1)) shouldBe "1 year"
    }

    @Test
    fun `warns of a six-month absence even when a longer one by days is not one`() {
        // 184 days but not over six calendar months, then 183 days that are.
        val trips = listOf(roundTrip("spring", "2024-03-01", "2024-09-01", "BOS", "LHR"), roundTrip("winter", "2025-01-01", "2025-07-03", "BOS", "LHR"))
        val result = evaluate(rule("us-citizenship", "us-citizenship-continuous"), trips, boston, "2026-11-23")
        result.status shouldBe ResidenceStatus.NEAR
        result.window shouldBe DateRange("2025-01-01", "2025-07-03")
    }

    @Test
    fun `flags a single absence of over six months and one of a year or more as breaking residence`() {
        val residence = rule("us-citizenship", "us-citizenship-continuous")
        val seven = evaluate(residence, listOf(roundTrip("seven", "2025-01-10", "2025-08-20", "BOS", "LHR")), boston, "2026-11-23")
        seven.status shouldBe ResidenceStatus.NEAR
        seven.window shouldBe DateRange("2025-01-10", "2025-08-20")
        seven.used shouldBe 222.0
        evaluate(residence, listOf(roundTrip("year", "2025-01-10", "2026-01-10", "BOS", "LHR")), boston, "2026-11-23").status shouldBe ResidenceStatus.OVER
        evaluate(residence, listOf(roundTrip("short", "2025-01-10", "2025-07-10", "BOS", "LHR")), boston, "2026-11-23").status shouldBe ResidenceStatus.OK
    }

    @Test
    fun `counts an absence still going on up to the date`() {
        val away = trip("away", "2025-10-01", "2025-10-01", listOf(flight("BOS", "LHR", "2025-10-01T20:00:00-04:00", "2025-10-02T07:00:00+01:00")))
        val homes = listOf(HomePeriod("Boston", "US", until = "2025-10-01"), HomePeriod("London", "GB", from = "2025-10-02"))
        val result = evaluate(rule("us-green-card", "us-green-card-absence"), listOf(away), homes, "2026-11-23")
        result.status shouldBe ResidenceStatus.OVER
        result.window shouldBe DateRange("2025-10-01", "2026-11-23")
    }

    @Test
    fun `weighs this year's days in full last year's by a third and the year before's by a sixth`() {
        val tax = rule("us-tax", "us-substantial-presence")
        val visits = listOf(
            roundTrip("y0", "2026-01-01", "2026-04-30", "LHR", "JFK"),
            roundTrip("y1", "2025-01-01", "2025-04-30", "LHR", "JFK"),
            roundTrip("y2", "2024-01-01", "2024-04-29", "LHR", "JFK"),
        )
        val result = evaluate(tax, visits, london, "2026-11-23")
        result.current?.used shouldBe 120
        result.used shouldBe (180.0 plusOrMinus 1e-9)
        result.status shouldBe ResidenceStatus.NEAR
        evaluate(tax, visits + roundTrip("y0b", "2026-06-01", "2026-06-10", "LHR", "JFK"), london, "2026-11-23").status shouldBe ResidenceStatus.OVER
        val few = listOf(
            roundTrip("y0", "2026-01-01", "2026-01-30", "LHR", "JFK"),
            roundTrip("y1", "2025-01-01", "2025-12-31", "LHR", "JFK"),
            roundTrip("y2", "2024-01-01", "2024-12-31", "LHR", "JFK"),
        )
        val under = evaluate(tax, few, london, "2026-11-23")
        (under.used > 183) shouldBe true
        under.status shouldBe ResidenceStatus.NEAR
    }

    @Test
    fun `keeps a traveler in the country through a long train ride within it`() {
        // Two nights on a train from Chicago to Los Angeles never leave the US.
        val homes = listOf(HomePeriod("London", "GB", until = "2025-12-31"), HomePeriod("Boston", "US", from = "2026-01-01"))
        val ride = trip("ride", "2026-06-01", "2026-06-03", listOf(train(Place("Chicago", country = "US"), Place("Los Angeles", country = "US"), "2026-06-01T14:00:00-05:00", "2026-06-03T15:00:00-07:00")))
        val tax = rule("us-tax", "us-substantial-presence")
        val without = evaluate(tax, emptyList(), homes, "2026-07-02")
        val result = evaluate(tax, listOf(ride), homes, "2026-07-02")
        result.used shouldBe without.used
        result.status shouldBe ResidenceStatus.OVER
    }

    @Test
    fun `meets the substantial presence test at exactly 183 days with no rounding short of it`() {
        // 31 + 292/3 + 328/6 is 183 exactly, which floating point puts just under.
        val timeline = mutableMapOf<String, DayPresence>()
        fun fill(year: Int, inUs: Int) {
            var d = "$year-01-01"
            var i = 0
            while (d.startsWith("$year")) {
                timeline[d] = DayPresence(setOf(if (i < inUs) "US" else "GB"), emptySet(), assumedHome = false, inTransit = false)
                d = shiftDate(d, DateShift(days = 1))
                i++
            }
        }
        fill(2024, 328)
        fill(2025, 292)
        fill(2026, 31)
        val result = evaluateRule(rule("us-tax", "us-substantial-presence"), timeline, "2026-11-23")
        result.used shouldBe (183.0 plusOrMinus 1e-9)
        result.status shouldBe ResidenceStatus.OVER
    }

    @Test
    fun `Canada counts 1095 days present for citizenship and 730 for permanent residence`() {
        val toronto = listOf(HomePeriod("Toronto", "CA"))
        val away = listOf(roundTrip("away", "2023-01-01", "2024-12-31", "YYZ", "LHR"))
        val citizenship = evaluate(rule("ca-citizenship", "ca-citizenship-presence"), away, toronto, "2026-11-23")
        val pr = evaluate(rule("ca-permanent-residence", "ca-pr-presence"), away, toronto, "2026-11-23")
        citizenship.limit shouldBe 1095
        pr.limit shouldBe 730
        citizenship.used shouldBe 1097.0
        citizenship.status shouldBe ResidenceStatus.NEAR
        pr.status shouldBe ResidenceStatus.OK
    }

    @Test
    fun `Australia allows a year away in four years and 90 days in the last year`() {
        val melbourne = listOf(HomePeriod("Melbourne", "AU"))
        val trips = listOf(roundTrip("old", "2023-01-01", "2023-06-30", "MEL", "LHR"), roundTrip("recent", "2026-06-01", "2026-09-15", "MEL", "LHR"))
        val four = evaluate(rule("au-citizenship", "au-citizenship-four-years"), trips, melbourne, "2026-11-23")
        val last = evaluate(rule("au-citizenship", "au-citizenship-last-year"), trips, melbourne, "2026-11-23")
        listOf(four.used, four.limit, four.status) shouldBe listOf(284.0, 365, ResidenceStatus.OK)
        listOf(last.used, last.limit, last.status) shouldBe listOf(105.0, 90, ResidenceStatus.OVER)
    }

    @Test
    fun `evaluates every rule in a set counts trips booked up to the date and says whether home has a country`() {
        val set = residenceRuleSets.first { it.id == "uk-citizenship" }
        val report = residenceReport(listOf(roundTrip("paris", "2026-01-01", "2026-01-10")), london, set, "2026-11-23")
        report.results.map { it.rule.id to it.used } shouldBe listOf("uk-citizenship-five-years" to 8.0, "uk-citizenship-last-year" to 8.0)
        report.homeCountryKnown shouldBe true
        residenceReport(emptyList(), listOf(HomePeriod("London")), set, "2026-11-23").homeCountryKnown shouldBe false
        val schengen = residenceRuleSets.first { it.id == "schengen" }
        residenceReport(listOf(roundTrip("ahead", "2027-01-05", "2027-01-08")), london, schengen, "2027-01-31").results[0].used shouldBe 4.0
    }

    @Test
    fun `cites an official source for every rule as the web does`() {
        val official = Regex("^https://(www\\.gov\\.uk|home-affairs\\.ec\\.europa\\.eu|www\\.uscis\\.gov|www\\.irs\\.gov|www\\.canada\\.ca|immi\\.homeaffairs\\.gov\\.au)/")
        residenceRuleSets.map { it.id } shouldBe listOf(
            "uk-settlement", "uk-citizenship", "schengen", "us-citizenship", "us-citizenship-spouse", "us-green-card", "us-tax", "ca-permanent-residence", "ca-citizenship", "au-citizenship",
        )
        for (set in residenceRuleSets) for (r in set.rules) official.containsMatchIn(r.source) shouldBe true
    }
}
