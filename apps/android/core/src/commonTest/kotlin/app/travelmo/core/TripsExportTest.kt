package app.travelmo.core

import io.kotest.matchers.shouldBe
import kotlin.test.Test

// Mirrors packages/core/src/tripsExport.test.ts.
class TripsExportTest {
    private val london = Place("London Heathrow", code = "LHR", city = "London", country = "GB")
    private val periods = listOf(HomePeriod("London", "GB"))

    private fun seg(id: String, trip: String, type: SegmentType, start: String, end: String? = null, origin: Place? = null, destination: Place? = null) =
        Segment(id, trip, type, type.name, start, end = end, origin = origin, destination = destination)

    private val sweden = TripWithSegments(
        Trip("se", "Stockholm", "2026-08-15", "2026-08-23", "u1"),
        listOf(
            seg("1", "se", SegmentType.FLIGHT, "2026-08-15T09:00:00+01:00", "2026-08-15T12:30:00+02:00", london, Place("Arlanda", code = "ARN", city = "Stockholm", country = "SE")),
            seg("2", "se", SegmentType.LODGING, "2026-08-15T15:00:00+02:00", "2026-08-19T11:00:00+02:00", destination = Place("Hotel", city = "Stockholm", country = "SE")),
            // A ticket says nothing about where anyone slept.
            seg("3", "se", SegmentType.ACTIVITY, "2026-08-17T10:00:00+02:00", destination = Place("Castle", city = "Uppsala", country = "SE")),
            seg("4", "se", SegmentType.TRAIN, "2026-08-19T12:00:00+02:00", "2026-08-19T15:00:00+02:00", Place("Stockholm C", city = "Stockholm", country = "SE"), Place("Göteborg C", city = "Göteborg", country = "SE")),
            seg("5", "se", SegmentType.LODGING, "2026-08-19T16:00:00+02:00", "2026-08-23T11:00:00+02:00", destination = Place("Villa", city = "Göteborg", country = "SE")),
            seg("6", "se", SegmentType.FLIGHT, "2026-08-23T14:00:00+02:00", "2026-08-23T15:00:00+01:00", Place("Landvetter", code = "GOT", city = "Gothenburg", country = "SE"), london),
        ),
    )

    private val liverpool = TripWithSegments(
        Trip("lpl", "Liverpool", "2026-05-23", "2026-05-25", "u1"),
        listOf(
            seg("7", "lpl", SegmentType.TRAIN, "2026-05-23T12:00:00+01:00", "2026-05-23T14:15:00+01:00", Place("Euston", city = "London", country = "GB"), Place("Lime Street", city = "Liverpool", country = "GB")),
            seg("8", "lpl", SegmentType.TRAIN, "2026-05-25T11:00:00+01:00", "2026-05-25T13:15:00+01:00", Place("Lime Street", city = "Liverpool", country = "GB"), Place("Euston", city = "London", country = "GB")),
        ),
    )

    @Test
    fun `gives each trip's dates and where it went with home and tickets left out`() {
        tripRows(listOf(sweden, liverpool), periods, TODAY) shouldBe listOf(
            TripRow("Liverpool", "2026-05-23", "2026-05-25", listOf("Liverpool"), listOf("United Kingdom")),
            TripRow("Stockholm", "2026-08-15", "2026-08-23", listOf("Stockholm", "Göteborg"), listOf("Sweden")),
        )
        tripRows(listOf(sweden, liverpool), periods, TODAY, international = true).map { it.trip } shouldBe listOf("Stockholm")
    }

    @Test
    fun `gives each place from the day someone got there until they moved on`() {
        placeRows(listOf(sweden, liverpool), periods, TODAY) shouldBe listOf(
            PlaceRow("Liverpool", "United Kingdom", "2026-05-23", "2026-05-25", "Liverpool"),
            PlaceRow("Stockholm", "Sweden", "2026-08-15", "2026-08-19", "Stockholm"),
            PlaceRow("Göteborg", "Sweden", "2026-08-19", "2026-08-23", "Stockholm"),
        )
        placeRows(listOf(sweden, liverpool), periods, TODAY, international = true).map { it.city } shouldBe listOf("Stockholm", "Göteborg")
    }

    @Test
    fun `writes a header and quotes what needs it`() {
        tripRowsCsv(listOf(TripRow("Paris, \"spring\"", "2026-04-01", "2026-04-05", listOf("Paris"), listOf("France")))) shouldBe
            "Trip,Start,End,Cities,Countries\r\n\"Paris, \"\"spring\"\"\",2026-04-01,2026-04-05,Paris,France\r\n"
        placeRowsCsv(listOf(PlaceRow("Paris", "France", "2026-04-01", "2026-04-05", "Paris"))) shouldBe
            "City,Country,Start,End,Trip\r\nParis,France,2026-04-01,2026-04-05,Paris\r\n"
    }

    @Test
    fun `keeps a spreadsheet from reading a field as a formula`() {
        placeRowsCsv(listOf(PlaceRow("=HYPERLINK(\"x\",\"y\")", "@SUM(1)", "2026-04-01", "2026-04-05", "-1+2"))) shouldBe
            "City,Country,Start,End,Trip\r\n\"'=HYPERLINK(\"\"x\"\",\"\"y\"\")\",'@SUM(1),2026-04-01,2026-04-05,'-1+2\r\n"
    }

    @Test
    fun `leaves out trips that start after the day chosen and trips wholly cancelled`() {
        val later = liverpool.copy(trip = liverpool.trip.copy(id = "later", title = "Later", start = "2027-01-02", end = "2027-01-04"))
        val off = liverpool.copy(trip = liverpool.trip.copy(id = "off", title = "Off"), segments = liverpool.segments.map { it.copy(cancelledAt = "2026-05-01T00:00:00Z") })
        tripRows(listOf(liverpool, later, off), periods, TODAY).map { it.trip } shouldBe listOf("Liverpool")
        placeRows(listOf(liverpool, later, off), periods, TODAY).map { it.trip } shouldBe listOf("Liverpool")
        // A later day takes in a planned trip; a cancelled one stays out.
        tripRows(listOf(liverpool, later, off), periods, "2027-12-31").map { it.trip } shouldBe listOf("Liverpool", "Later")
    }

    @Test
    fun `judges each place against the home of its own day`() {
        val moved = listOf(HomePeriod("London", "GB", until = "2026-08-16"), HomePeriod("Paris", "FR", from = "2026-08-17"))
        val lyon = TripWithSegments(
            Trip("ly", "Lyon", "2026-08-15", "2026-08-20", "u1"),
            listOf(seg("9", "ly", SegmentType.LODGING, "2026-08-18T15:00:00+02:00", "2026-08-20T11:00:00+02:00", destination = Place("Hotel", city = "Lyon", country = "FR"))),
        )
        tripRows(listOf(lyon), moved, TODAY, international = true) shouldBe emptyList()
        placeRows(listOf(lyon), moved, TODAY, international = true) shouldBe emptyList()
    }

    @Test
    fun `keeps two towns of one name in different countries apart`() {
        val twoLondons = TripWithSegments(
            Trip("ca", "Ontario", "2026-06-01", "2026-06-10", "u1"),
            listOf(
                seg("10", "ca", SegmentType.LODGING, "2026-06-01T15:00:00-04:00", "2026-06-05T11:00:00-04:00", destination = Place("Inn", city = "London", country = "CA")),
                seg("11", "ca", SegmentType.FLIGHT, "2026-06-05T18:00:00-04:00", "2026-06-06T07:00:00+01:00", Place("YYZ", city = "Toronto", country = "CA"), Place("Heathrow", city = "London", country = "GB")),
            ),
        )
        placeRows(listOf(twoLondons), listOf(HomePeriod("Paris", "FR")), TODAY).map { "${it.city}, ${it.country}" } shouldBe listOf("London, Canada", "London, United Kingdom")
    }

    @Test
    fun `shows no town for a stay without one rather than the hotel's name but a station's for a journey`() {
        val inn = TripWithSegments(
            Trip("inn", "Inn", "2026-04-10", "2026-04-12", "u1"),
            listOf(
                seg("20", "inn", SegmentType.TRAIN, "2026-04-10T09:00:00+02:00", "2026-04-10T11:00:00+02:00", Place("Example Central", country = "FR"), Place("Exampleville Gare", country = "FR")),
                seg("21", "inn", SegmentType.LODGING, "2026-04-10T15:00:00+02:00", "2026-04-12T11:00:00+02:00", destination = Place("Example Inn", country = "FR")),
            ),
        )
        tripRows(listOf(inn), periods, TODAY).single().cities shouldBe listOf("Exampleville Gare")
        placeRows(listOf(inn), periods, TODAY).map { it.city } shouldBe listOf("Exampleville Gare", "")
    }

    @Test
    fun `lists no trip of nothing but events and tickets`() {
        val dinner = TripWithSegments(
            Trip("din", "Dinner", "2026-03-01", "2026-03-01", "u1"),
            listOf(seg("12", "din", SegmentType.ACTIVITY, "2026-03-01T19:00:00+00:00", destination = Place("Restaurant", city = "Brighton", country = "GB"))),
        )
        tripRows(listOf(dinner), periods, TODAY) shouldBe emptyList()
    }

    @Test
    fun `takes a town's local and English names as one town`() {
        val gothenburg = TripWithSegments(
            Trip("got", "Gothenburg", "2026-09-01", "2026-09-04", "u1"),
            listOf(
                seg("13", "got", SegmentType.FLIGHT, "2026-09-01T09:00:00+01:00", "2026-09-01T12:00:00+02:00", london, Place("Landvetter", city = "Gothenburg", country = "SE")),
                seg("14", "got", SegmentType.LODGING, "2026-09-01T15:00:00+02:00", "2026-09-04T11:00:00+02:00", destination = Place("Hotel", city = "Göteborg", country = "SE")),
            ),
        )
        placeRows(listOf(gothenburg), periods, TODAY) shouldBe listOf(PlaceRow("Gothenburg", "Sweden", "2026-09-01", "2026-09-04", "Gothenburg"))
    }

    @Test
    fun `takes a place's country from any of its bookings`() {
        val stay = TripWithSegments(
            Trip("lv", "Liverpool", "2026-05-23", "2026-05-25", "u1"),
            listOf(
                seg("15", "lv", SegmentType.TRAIN, "2026-05-23T12:00:00+01:00", "2026-05-23T14:15:00+01:00", Place("Euston", city = "London", country = "GB"), Place("Lime Street", city = "Liverpool")),
                seg("16", "lv", SegmentType.LODGING, "2026-05-23T15:00:00+01:00", "2026-05-25T11:00:00+01:00", destination = Place("Hotel", city = "Liverpool", country = "GB")),
            ),
        )
        placeRows(listOf(stay), periods, TODAY) shouldBe listOf(PlaceRow("Liverpool", "United Kingdom", "2026-05-23", "2026-05-25", "Liverpool"))
        placeRows(listOf(stay), periods, TODAY, international = true) shouldBe emptyList()
        tripRows(listOf(stay), periods, TODAY).map { it.countries } shouldBe listOf(listOf("United Kingdom"))
        tripRows(listOf(stay), periods, TODAY, international = true) shouldBe emptyList()
    }

    @Test
    fun `does not read a ticket's validity as its arrival`() {
        val express = TripWithSegments(
            Trip("ex", "Stockholm", "2026-08-15", "2026-08-17", "u1"),
            listOf(
                seg("17", "ex", SegmentType.TRAIN, "2026-08-15T13:00:00+02:00", "2026-11-13T23:59:00+01:00", Place("Arlanda", city = "Stockholm", country = "SE"), Place("Stockholm C", city = "Stockholm", country = "SE")),
                seg("18", "ex", SegmentType.LODGING, "2026-08-15T15:00:00+02:00", "2026-08-17T11:00:00+02:00", destination = Place("Hotel", city = "Solna", country = "SE")),
            ),
        )
        // Read as arriving in November, the train would come after the hotel and stretch it to then.
        placeRows(listOf(express), periods, TODAY) shouldBe listOf(
            PlaceRow("Stockholm", "Sweden", "2026-08-15", "2026-08-15", "Stockholm"),
            PlaceRow("Solna", "Sweden", "2026-08-15", "2026-08-17", "Stockholm"),
        )
    }

    @Test
    fun `tells a London abroad from London at home by the airport's country`() {
        val lookup = { code: String -> if (code == "YXU") AirportPlace("CA", 43.04, -81.15) else null }
        val ontario = TripWithSegments(
            Trip("on", "Ontario", "2026-07-01", "2026-07-05", "u1"),
            listOf(seg("19", "on", SegmentType.FLIGHT, "2026-07-01T10:00:00-04:00", "2026-07-01T11:00:00-04:00", Place("Toronto", code = "YYZ", city = "Toronto"), Place("London", code = "YXU", city = "London"))),
        )
        tripRows(listOf(ontario), periods, TODAY, lookup = lookup).map { it.countries } shouldBe listOf(listOf("Canada"))
        placeRows(listOf(ontario), periods, TODAY, lookup = lookup).map { "${it.city}, ${it.country}" } shouldBe listOf("London, Canada")
        // A later booking that names the country does the same for a stop that had none.
        val withHotel = ontario.copy(
            segments = listOf(
                seg("20", "on", SegmentType.TRAIN, "2026-07-01T10:00:00-04:00", "2026-07-01T12:00:00-04:00", Place("Union", city = "Toronto"), Place("London station", city = "London")),
                seg("21", "on", SegmentType.LODGING, "2026-07-01T15:00:00-04:00", "2026-07-05T11:00:00-04:00", destination = Place("Inn", city = "London", country = "CA")),
            ),
        )
        placeRows(listOf(withHotel), periods, TODAY).map { "${it.city}, ${it.country}, ${it.start}–${it.end}" } shouldBe listOf("London, Canada, 2026-07-01–2026-07-05")
    }

    private companion object {
        const val TODAY = "2026-11-24"
    }
}
