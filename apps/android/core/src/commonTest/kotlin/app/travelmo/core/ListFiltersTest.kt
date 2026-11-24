package app.travelmo.core

import io.kotest.matchers.shouldBe
import kotlin.test.Test

// Invented bookings, as in listFilters.test.ts: a show and a meal in town, a
// hire car returned where it was picked up, a car to the airport, a flight
// and a stay.
private val show = Segment("show", "t", SegmentType.ACTIVITY, "Example Theatre", "2026-12-12T19:30:00+00:00", destination = Place("Example Theatre", city = "London", country = "GB"))
private val dinner = Segment("dinner", "t", SegmentType.OTHER, "Example Bistro", "2026-12-12T18:00:00+00:00", destination = Place("Example Bistro", city = "London"))
private val hire = Segment("hire", "t", SegmentType.CAR_RENTAL, "Example Cars", "2026-12-13T09:00:00+00:00", origin = Place("Example Cars Camden"), destination = Place("Example Cars Camden"))
private val transfer = Segment("transfer", "t", SegmentType.CAR_RENTAL, "Example Cars", "2026-12-13T09:00:00+00:00", origin = Place("Example Cars Camden"), destination = Place("Heathrow", code = "LHR"))
private val flight = Segment("flight", "t", SegmentType.FLIGHT, "XX 1 LHR to DUB", "2026-12-13T09:00:00+00:00", origin = Place("Heathrow", code = "LHR"), destination = Place("Dublin", code = "DUB"))
private val stay = Segment("stay", "t", SegmentType.LODGING, "Example Hotel", "2026-12-13T15:00:00+00:00", destination = Place("Example Hotel", city = "Bath"))
private fun cancelled(s: Segment) = s.copy(cancelledAt = "2026-11-01T00:00:00Z")

class ListFiltersTest {
    private val trip = Trip("t", "Out", "2026-12-12", "2026-12-13", "u")
    private val off = trip.copy(cancelledAt = "2026-11-01T00:00:00Z")

    @Test
    fun `a trip of shows and meals and a car returned where it was hired is local`() {
        localOnly(listOf(show, dinner, hire)) shouldBe true
    }

    @Test
    fun `a trip with any journey or stay or ride somewhere else is not local`() {
        localOnly(listOf(show, flight)) shouldBe false
        localOnly(listOf(show, stay)) shouldBe false
        localOnly(listOf(show, transfer)) shouldBe false
    }

    @Test
    fun `local goes by what is still booked and a trip with nothing booked is not`() {
        localOnly(listOf(show, cancelled(flight))) shouldBe true
        localOnly(listOf(cancelled(show))) shouldBe false
        localOnly(emptyList()) shouldBe false
    }

    @Test
    fun `nothing is hidden by default`() {
        hiddenFromList(off, listOf(show), ListFilters()) shouldBe false
        hiddenFromList(trip, listOf(cancelled(flight)), ListFilters()) shouldBe false
    }

    @Test
    fun `hiding cancelled hides a trip its owner cancelled before its bookings are read and one whose every booking was`() {
        val filters = ListFilters(hideCancelled = true)
        hiddenFromList(off, null, filters) shouldBe true
        hiddenFromList(trip, listOf(cancelled(flight)), filters) shouldBe true
        hiddenFromList(trip, listOf(cancelled(flight), stay), filters) shouldBe false
        hiddenFromList(trip, null, filters) shouldBe false
        hiddenFromList(trip, emptyList(), filters) shouldBe false
    }

    @Test
    fun `hiding local events hides them once the bookings are read`() {
        val filters = ListFilters(hideLocal = true)
        hiddenFromList(trip, listOf(show, dinner), filters) shouldBe true
        hiddenFromList(trip, null, filters) shouldBe false
        hiddenFromList(trip, listOf(show, flight), filters) shouldBe false
        // A cancelled night out is cancelled, not local.
        hiddenFromList(trip, listOf(cancelled(show)), filters) shouldBe false
    }

    @Test
    fun `the filters go by the trip's own flags without its bookings`() {
        val both = ListFilters(hideCancelled = true, hideLocal = true)
        hiddenFromList(trip.copy(allCancelled = true, localOnly = false), null, both) shouldBe true
        hiddenFromList(trip.copy(allCancelled = false, localOnly = true), null, both) shouldBe true
        hiddenFromList(trip.copy(allCancelled = false, localOnly = false), null, both) shouldBe false
    }

    @Test
    fun `the flags are unknown until both are kept and written only when the bookings disagree`() {
        flagsUnknown(trip) shouldBe true
        flagsUnknown(trip.copy(allCancelled = false)) shouldBe true
        flagsUnknown(trip.copy(allCancelled = false, localOnly = false)) shouldBe false
        tripFlagsToWrite(trip, listOf(show)) shouldBe TripFlags(allCancelled = false, localOnly = true)
        tripFlagsToWrite(trip.copy(allCancelled = false, localOnly = true), listOf(show)) shouldBe null
        tripFlagsToWrite(trip.copy(allCancelled = false, localOnly = true), listOf(cancelled(show))) shouldBe TripFlags(allCancelled = true, localOnly = false)
    }
}
