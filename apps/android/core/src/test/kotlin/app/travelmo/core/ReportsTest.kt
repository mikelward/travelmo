package app.travelmo.core

import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test

class ReportsTest {
    private fun flight(from: String, to: String, start: String, end: String, id: String = "$from-$to") =
        Segment(id, "t", SegmentType.FLIGHT, "$from to $to", start, end, origin = Place(from, code = from), destination = Place(to, code = to))

    private fun stay(name: String, country: String, start: String, end: String) =
        Segment(name, "t", SegmentType.LODGING, name, start, end, destination = Place(name, country = country))

    private fun train(from: Place, to: Place, start: String, end: String) =
        Segment("$start-train", "t", SegmentType.TRAIN, "${from.name} to ${to.name}", start, end, origin = from, destination = to)

    private fun trip(id: String, start: String, end: String) = Trip(id, id, start, end, "u")

    // An invented week in Paris with a day trip by train to Brussels.
    private val parisNord = Place("Paris Nord", country = "FR")
    private val bruxelles = Place("Bruxelles-Midi", country = "BE")
    private val paris = TripWithSegments(
        trip("paris", "2025-05-01", "2025-05-07"),
        listOf(
            flight("JFK", "CDG", "2025-05-01T18:00:00-04:00", "2025-05-02T07:30:00+02:00"),
            stay("Hotel Example", "FR", "2025-05-02T15:00:00+02:00", "2025-05-07T11:00:00+02:00"),
            train(parisNord, bruxelles, "2025-05-04T08:00:00+02:00", "2025-05-04T09:30:00+02:00"),
            train(bruxelles, parisNord, "2025-05-04T19:00:00+02:00", "2025-05-04T20:30:00+02:00"),
            flight("CDG", "JFK", "2025-05-07T13:00:00+02:00", "2025-05-07T15:30:00-04:00"),
        ),
    )
    private val tokyo = TripWithSegments(trip("tokyo", "2024-12-30", "2025-01-02"), listOf(stay("Ryokan Example", "JP", "2024-12-30T15:00:00+09:00", "2025-01-02T10:00:00+09:00")))
    private val later = TripWithSegments(trip("later", "2026-03-01", "2026-03-05"), emptyList())

    private fun countriesOf(days: Map<String, Set<String>>) = days.mapValues { it.value.sorted() }

    @Test
    fun `counts a travel day for both ends and a day in the air for neither`() {
        countriesOf(tripDays(paris.trip, paris.segments, "2025-12-31")) shouldBe mapOf(
            "2025-05-01" to listOf("US"),
            "2025-05-02" to listOf("FR"),
            "2025-05-03" to listOf("FR"),
            "2025-05-04" to listOf("BE", "FR"),
            "2025-05-05" to listOf("FR"),
            "2025-05-06" to listOf("FR"),
            "2025-05-07" to listOf("FR", "US"),
        )
        tripDays(paris.trip, paris.segments, "2025-05-03").keys.toList() shouldBe listOf("2025-05-01", "2025-05-02", "2025-05-03")
    }

    @Test
    fun `keeps where the traveler is across the date line, and leaves unplaced days without a country`() {
        // Leaves Tokyo early on 2 May and lands in Los Angeles on the evening of 1 May.
        val days = tripDays(
            trip("t", "2025-05-01", "2025-05-03"),
            listOf(stay("Tokyo Example Hotel", "JP", "2025-04-28T15:00:00+09:00", "2025-05-01T10:00:00+09:00"), flight("HND", "LAX", "2025-05-02T01:00:00+09:00", "2025-05-01T19:00:00-07:00")),
            "2026-01-01",
        )
        countriesOf(days) shouldBe mapOf("2025-05-01" to listOf("JP", "US"), "2025-05-02" to listOf("JP", "US"), "2025-05-03" to listOf("US"))
        val unplaced = tripDays(trip("t", "2025-06-01", "2025-06-03"), listOf(stay("Inn", "IT", "2025-06-02T15:00:00+02:00", "2025-06-03T10:00:00+02:00")), "2026-01-01")
        countriesOf(unplaced) shouldBe mapOf("2025-06-01" to emptyList(), "2025-06-02" to listOf("IT"), "2025-06-03" to listOf("IT"))
    }

    @Test
    fun `counts days per country, trips per year and the airports flown`() {
        val report = travelReport(listOf(paris, tokyo, later, paris), "2025-11-01")
        report.trips shouldBe 2
        report.upcoming shouldBe 1
        report.days shouldBe 11
        report.countries shouldBe listOf(CountryReport("FR", 6, 1), CountryReport("JP", 4, 1), CountryReport("US", 2, 1), CountryReport("BE", 1, 1))
        report.years shouldBe listOf(YearReport("2025", 1, 9, 4), YearReport("2024", 1, 2, 1))
        report.airports.map { it.code to it.country } shouldBe listOf("CDG" to "FR", "JFK" to "US")
        report.places shouldBe emptyList()
        report.unknownDays shouldBe 0
        report.unplaced shouldBe 0
    }

    @Test
    fun `lists the places that know their spot once each, for the map`() {
        val hotel = Place("Hotel Example", city = "Exampleville", country = "FR", lat = 48.8567, lon = 2.3508)
        val station = Place("Exampleville Nord", country = "FR", lat = 48.8809, lon = 2.3553)
        val spots = TripWithSegments(
            trip("spots", "2025-05-01", "2025-05-03"),
            listOf(
                Segment("h", "t", SegmentType.LODGING, "Hotel Example", "2025-05-01T15:00:00+02:00", "2025-05-03T11:00:00+02:00", destination = hotel),
                // The same hotel named by its street, a few meters away: one dot.
                Segment("d", "t", SegmentType.ACTIVITY, "Dinner", "2025-05-02T20:00:00+02:00", destination = hotel.copy(name = "1 Rue Exemple", lat = 48.8569)),
                Segment("o", "t", SegmentType.TRAIN, "Out", "2025-05-03T12:00:00+02:00", "2025-05-03T14:00:00+02:00", origin = station, destination = Place("Elsewhere", country = "BE")),
                // A flight whose airport the table does not know but whose source placed it.
                Segment("f", "t", SegmentType.FLIGHT, "XX 9", "2025-05-03T16:00:00+02:00", origin = Place("Example Field", code = "ZZZ", country = "BE", lat = 50.9, lon = 4.5), destination = Place("Home", code = "JFK")),
            ),
        )
        val report = travelReport(listOf(spots), "2025-11-01")
        report.places shouldBe listOf(
            PlaceVisit("Example Field", null, "BE", 50.9, 4.5),
            PlaceVisit("Exampleville Nord", null, "FR", 48.8809, 2.3553),
            PlaceVisit("Hotel Example", "Exampleville", "FR", 48.8567, 2.3508),
        )
        report.airports.map { it.code } shouldBe listOf("JFK")
        // Narrowed to a year without the trip, the map is empty.
        travelReport(listOf(spots), "2025-11-01", year = "2024").places shouldBe emptyList()
    }

    @Test
    fun `keeps a stay's place on the map for every day of the stay`() {
        val ryokan = Place("Ryokan Example", country = "JP", lat = 35.0, lon = 135.8)
        val newYear = TripWithSegments(trip("ny", "2024-12-30", "2025-01-02"), listOf(Segment("r", "t", SegmentType.LODGING, "Ryokan Example", "2024-12-30T15:00:00+09:00", "2025-01-02T10:00:00+09:00", destination = ryokan)))
        fun names(today: String, year: String? = null) = travelReport(listOf(newYear), today, year).places.map { it.name }
        names("2025-11-01", "2024") shouldBe listOf("Ryokan Example")
        names("2025-11-01", "2025") shouldBe listOf("Ryokan Example")
        names("2024-12-31") shouldBe listOf("Ryokan Example")
        names("2024-12-31", "2025") shouldBe emptyList()
        names("2024-12-29") shouldBe emptyList()
    }

    @Test
    fun `narrows to one year by the days spent in it, and marks each airport in the year the traveler was there`() {
        val report = travelReport(listOf(paris, tokyo), "2025-11-01", year = "2024")
        report.trips shouldBe 1
        report.days shouldBe 2
        report.countries shouldBe listOf(CountryReport("JP", 2, 1))
        report.airports shouldBe emptyList()
        report.years.size shouldBe 2
        val newYear = TripWithSegments(trip("ny", "2024-12-31", "2025-01-01"), listOf(flight("JFK", "CDG", "2024-12-31T22:00:00-05:00", "2025-01-01T11:30:00+01:00")))
        fun codes(year: String) = travelReport(listOf(newYear), "2025-11-01", year).airports.map { it.code }
        codes("2024") shouldBe listOf("JFK")
        codes("2025") shouldBe listOf("CDG")
        travelReport(listOf(newYear), "2024-12-31").airports.map { it.code } shouldBe listOf("JFK")
    }

    @Test
    fun `counts a day two trips share once, and says how many bookings and days it could not place`() {
        val a = TripWithSegments(trip("a", "2025-02-01", "2025-02-02"), listOf(stay("A", "ES", "2025-02-01T15:00:00+01:00", "2025-02-02T10:00:00+01:00")))
        val b = TripWithSegments(trip("b", "2025-02-02", "2025-02-03"), listOf(stay("B", "PT", "2025-02-02T15:00:00+00:00", "2025-02-03T10:00:00+00:00")))
        val shared = travelReport(listOf(a, b), "2025-12-01")
        shared.days shouldBe 3
        shared.countries.map { it.country to it.days } shouldBe listOf("ES" to 2, "PT" to 2)
        val vague = TripWithSegments(trip("vague", "2025-03-01", "2025-03-02"), listOf(Segment("m", "t", SegmentType.ACTIVITY, "Museum", "2025-03-01T10:00:00+01:00", destination = Place("Museum"))))
        val report = travelReport(listOf(vague), "2025-12-01")
        report.unplaced shouldBe 1
        report.unknownDays shouldBe 2
        report.countries shouldBe emptyList()
        val bare = TripWithSegments(trip("bare", "2025-03-05", "2025-03-05"), listOf(Segment("b", "t", SegmentType.ACTIVITY, "Tour", "2025-03-05T10:00:00+01:00")))
        travelReport(listOf(bare), "2025-12-01").unplaced shouldBe 1
    }
}
