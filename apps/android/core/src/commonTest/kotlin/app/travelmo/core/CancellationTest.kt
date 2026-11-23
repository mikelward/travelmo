package app.travelmo.core

import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import kotlin.test.Test

// An invented Stockholm stay, cancelled by email, beside a flight that stands.
private val flight = Segment(
    "f", "t", SegmentType.FLIGHT, "SK 1530 LHR to ARN", "2026-06-10T08:00:00+01:00", "2026-06-10T11:30:00+02:00",
    origin = Place("Heathrow", code = "LHR"), destination = Place("Arlanda", code = "ARN"),
)
private val cancelled = Segment(
    "s", "t", SegmentType.LODGING, "Example Hotel Gamla Stan", "2026-06-10T15:00:00+02:00", "2026-06-20T11:00:00+02:00",
    destination = Place("Example Hotel Gamla Stan", country = "SE"), cancelledAt = "2026-05-01T09:00:00Z",
)

class CancellationTest {
    @Test
    fun `a cancelled booking is left out of the live ones`() {
        cancelled.isCancelled shouldBe true
        flight.isCancelled shouldBe false
        liveSegments(listOf(flight, cancelled)) shouldBe listOf(flight)
    }

    @Test
    fun `a cancelled booking doesn't count for the trip's dates`() {
        segmentDateRange(listOf(flight, cancelled)) shouldBe ("2026-06-10" to "2026-06-10")
        segmentDateRange(listOf(cancelled)).shouldBeNull()
    }

    @Test
    fun `a cancelled booking isn't what's next the current stay or a check-in`() {
        val now = "2026-06-11T12:00:00+02:00"
        nextEvent(listOf(cancelled), now).shouldBeNull()
        currentStay(listOf(cancelled), now).shouldBeNull()
        flightCheckIn(listOf(flight.copy(cancelledAt = "2026-05-01T09:00:00Z")), "2026-06-09T12:00:00+01:00").shouldBeNull()
    }

    @Test
    fun `a cancelled booking leaves the trip's places`() {
        tripPlaces(listOf(cancelled)) shouldBe TripPlaces(emptySet(), false)
    }

    @Test
    fun `days away count only what the bookings still booked span`() {
        val london = Segment(
            "l", "t", SegmentType.LODGING, "Example Hotel London", "2026-06-01T15:00:00+01:00", "2026-06-03T11:00:00+01:00",
            destination = Place("Example Hotel London", city = "London", country = "GB"),
        )
        val paris = Segment(
            "p", "t", SegmentType.LODGING, "Example Hotel Paris", "2026-06-04T15:00:00+02:00", "2026-06-20T11:00:00+02:00",
            destination = Place("Example Hotel Paris", city = "Paris", country = "FR"), cancelledAt = "2026-05-01T09:00:00Z",
        )
        val trip = Trip("t", "London", "2026-06-01", "2026-06-20", "u")
        tripDays(trip, listOf(london, paris), "2026-07-01").keys.toList() shouldBe listOf("2026-06-01", "2026-06-02", "2026-06-03")
        tripDays(trip, listOf(paris), "2026-07-01").size shouldBe 0
        tripDays(trip, emptyList(), "2026-07-01").size shouldBe 20
    }

    @Test
    fun `the trip is dated by what is still booked ahead until then and in the year it falls`() {
        val newYear = Segment(
            "p", "w", SegmentType.LODGING, "Example Hotel Paris", "2025-12-20T15:00:00+01:00", "2026-01-02T11:00:00+01:00",
            destination = Place("Example Hotel Paris", city = "Paris", country = "FR"), cancelledAt = "2025-12-01T09:00:00Z",
        )
        val january = Segment(
            "l", "w", SegmentType.LODGING, "Example Hotel London", "2026-01-10T15:00:00+00:00", "2026-01-12T11:00:00+00:00",
            destination = Place("Example Hotel London", city = "London", country = "GB"),
        )
        val winter = Trip("w", "Winter", "2025-12-20", "2026-01-12", "u")
        val fifth = travelReport(listOf(TripWithSegments(winter, listOf(newYear, january))), "2026-01-05")
        fifth.upcoming shouldBe 1
        fifth.trips shouldBe 0
        val fifteenth = travelReport(listOf(TripWithSegments(winter, listOf(newYear, january))), "2026-01-15", year = "2026")
        fifteenth.trips shouldBe 1
        fifteenth.days shouldBe 3
        fifteenth.years shouldBe listOf(YearReport("2026", trips = 1, days = 3, countries = 1))
    }

    @Test
    fun `a trip whose every booking was cancelled is told apart from one with a live booking and from one with none`() {
        allCancelled(listOf(cancelled)) shouldBe true
        allCancelled(listOf(cancelled, flight)) shouldBe false
        allCancelled(emptyList()) shouldBe false
    }

    @Test
    fun `a trip whose every booking was cancelled isn't counted in the reports done or ahead`() {
        val trip = Trip("t", "Stockholm", "2026-06-10", "2026-06-13", "u")
        val past = travelReport(listOf(TripWithSegments(trip, listOf(cancelled))), "2026-07-01")
        past.trips shouldBe 0
        past.years shouldBe emptyList()
        travelReport(listOf(TripWithSegments(trip, listOf(cancelled))), "2026-05-01").upcoming shouldBe 0
        travelReport(listOf(TripWithSegments(trip, emptyList())), "2026-05-01").upcoming shouldBe 1
        travelReport(listOf(TripWithSegments(trip, emptyList())), "2026-07-01").trips shouldBe 1
    }

    // London 1-3 June still booked; the Paris stay that ran to 20 June cancelled.
    private val narrowed = Trip("t", "London and Paris", "2026-06-01", "2026-06-20", "u", liveStart = "2026-06-01", liveEnd = "2026-06-03")

    @Test
    fun `a trip some of whose bookings were cancelled shows when the person now travels`() {
        displayBounds(narrowed) shouldBe ("2026-06-01" to "2026-06-03")
        displayBounds(narrowed.copy(liveStart = null, liveEnd = null)) shouldBe ("2026-06-01" to "2026-06-20")
        displayTitles(listOf(narrowed, narrowed.copy(id = "u")))["t"] shouldBe "London and Paris (1–3 Jun 2026)"
    }

    @Test
    fun `such a trip is past once those dates are and spans only them in the calendar`() {
        groupTrips(listOf(narrowed), "2026-06-10").past shouldBe listOf(narrowed)
        val week = listOf("2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05", "2026-06-06", "2026-06-07")
        val bar = weekBars(week, listOf(narrowed)).single()
        bar.from shouldBe 0
        bar.to shouldBe 2
        bar.continuesAfter shouldBe false
        weekBars(listOf("2026-06-08", "2026-06-09", "2026-06-10", "2026-06-11", "2026-06-12", "2026-06-13", "2026-06-14"), listOf(narrowed)) shouldBe emptyList()
        tripMonths(listOf(narrowed)) shouldBe listOf("2026-06")
    }

    @Test
    fun `such a trip warns about documents for those dates`() {
        val passport = TravelDocument("Passport", DocumentKind.PASSPORT, "2026-06-10", "GB")
        documentWarnings(listOf(passport), narrowed, "2026-05-01").single().`when` shouldBe WarningWhen.SOON
        documentWarnings(listOf(passport), narrowed.copy(liveStart = null, liveEnd = null), "2026-05-01").single().`when` shouldBe WarningWhen.BEFORE
    }

    @Test
    fun `a booking restored or added widens the dates a trip is shown with which go once they are its own`() {
        val june5 = "2026-06-05" to "2026-06-06"
        widenedFor(narrowed, june5, june5) shouldBe narrowed.copy(liveEnd = "2026-06-06")
        val rest = "2026-06-04" to "2026-06-20"
        widenedFor(narrowed, rest, rest) shouldBe narrowed.copy(liveStart = null, liveEnd = null)
        val later = "2026-06-21" to "2026-06-22"
        widenedFor(narrowed.copy(liveStart = null, liveEnd = null), later, later) shouldBe narrowed.copy(end = "2026-06-22", liveStart = null, liveEnd = null)
    }

    @Test
    fun `a cancelled booking widens only a trip's own dates`() {
        val plain = narrowed.copy(liveStart = null, liveEnd = null)
        widenedFor(plain, "2026-06-21" to "2026-06-22", null) shouldBe plain.copy(end = "2026-06-22", liveStart = "2026-06-01", liveEnd = "2026-06-20")
        widenedFor(narrowed, "2026-06-21" to "2026-06-22", null) shouldBe narrowed.copy(end = "2026-06-22")
    }

    @Test
    fun `a trip's own dates cover every booking shown by what is still booked`() {
        bookedDateRange(listOf(flight, cancelled)) shouldBe ("2026-06-10" to "2026-06-20")
        liveBounds("2026-06-10" to "2026-06-20", listOf(flight, cancelled)) shouldBe ("2026-06-10" to "2026-06-10")
        liveBounds("2026-06-10" to "2026-06-25", listOf(flight, cancelled)).shouldBeNull()
        liveBounds("2026-06-10" to "2026-06-20", listOf(cancelled)).shouldBeNull()
        liveBounds("2026-06-10" to "2026-06-20", listOf(flight)).shouldBeNull()
        val trip = Trip("t", "Stockholm", "2026-06-10", "2026-06-10", "u")
        fittedRange(trip, listOf(flight, cancelled)) shouldBe ("2026-06-10" to "2026-06-20")
        fittedRange(trip.copy(end = "2026-06-20"), listOf(flight, cancelled)).shouldBeNull()
    }
}
