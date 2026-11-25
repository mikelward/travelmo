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
    fun `the flags are unknown until all are kept and written only when the bookings disagree`() {
        flagsUnknown(trip) shouldBe true
        flagsUnknown(trip.copy(allCancelled = false)) shouldBe true
        flagsUnknown(trip.copy(allCancelled = false, localOnly = false)) shouldBe true
        flagsUnknown(trip.copy(allCancelled = false, localOnly = false, travelers = emptyList())) shouldBe true
        tripFlagsToWrite(trip, listOf(show)) shouldBe TripFlags(allCancelled = false, localOnly = true, travelers = emptyList(), setting = "city")
        val kept = trip.copy(allCancelled = false, localOnly = true, travelers = emptyList(), setting = "city")
        flagsUnknown(kept) shouldBe false
        tripFlagsToWrite(kept, listOf(show)) shouldBe null
        tripFlagsToWrite(kept, listOf(cancelled(show))) shouldBe TripFlags(allCancelled = true, localOnly = false, travelers = emptyList(), setting = "city")
        tripFlagsToWrite(kept, listOf(show.copy(travelers = listOf("Sam Example")))) shouldBe
            TripFlags(allCancelled = false, localOnly = true, travelers = listOf("Sam Example"), setting = "city")
        // A trip from before its setting was kept gets it, though its filters are known.
        tripFlagsToWrite(kept.copy(setting = null), listOf(show)) shouldBe TripFlags(allCancelled = false, localOnly = true, travelers = emptyList(), setting = "city")
    }

    // Invented people, as in listFilters.test.ts: the user, whom mail sent straight to them names most, and their mum.
    private val sam = Person("sam", "Sam Example", listOf("EXAMPLE/SAM MR"), bookings = 5, direct = 5)
    private val pat = Person("pat", "Pat Example", bookings = 2)

    @Test
    fun `a trip's travelers are everyone its bookings name each once going by what is still booked`() {
        tripTravelers(listOf(flight.copy(travelers = listOf("Sam Example", "Pat Example")), stay.copy(travelers = listOf("EXAMPLE/SAM MR")))) shouldBe listOf("Sam Example", "Pat Example")
        tripTravelers(listOf(cancelled(flight.copy(travelers = listOf("Pat Example"))), stay.copy(travelers = listOf("Sam Example")))) shouldBe listOf("Sam Example")
        tripTravelers(listOf(cancelled(flight.copy(travelers = listOf("Pat Example"))))) shouldBe listOf("Pat Example")
        tripTravelers(listOf(flight)) shouldBe emptyList()
        // Each spelling once, but two that may be two people both kept: the user's people tell them apart.
        val smiths = listOf(flight.copy(travelers = listOf("John Smith")), stay.copy(travelers = listOf("J Smith")))
        tripTravelers(smiths) shouldBe listOf("John Smith", "J Smith")
        watching(tripTravelers(smiths), listOf(Person("me", "J Smith", listOf("Jane Smith"), bookings = 3, direct = 3), Person("john", "John Smith", bookings = 1))) shouldBe false
    }

    @Test
    fun `a trip keeps a group's hundred and more than that as none never dropping the user's name for want of room`() {
        fun group(n: Int) = (0 until n).map { "Person${'A' + it % 26}${'A' + it / 26} Example" }
        val twenty = tripTravelers(listOf(flight.copy(travelers = group(20)), stay.copy(travelers = listOf("Sam Example"))))
        twenty.size shouldBe 21
        ("Sam Example" in twenty) shouldBe true
        tripTravelers(listOf(flight.copy(travelers = group(100)), stay.copy(travelers = listOf("Sam Example")))) shouldBe emptyList()
    }

    @Test
    fun `watching is a trip whose bookings name travelers none of them the user`() {
        watching(listOf("Pat Example"), listOf(sam, pat)) shouldBe true
        watching(listOf("Pat Example", "SAM EXAMPLE"), listOf(sam, pat)) shouldBe false
        watching(listOf("Alex Other"), listOf(sam, pat)) shouldBe true
        watching(listOf("Pat Example"), emptyList()) shouldBe false
        watching(emptyList(), listOf(sam, pat)) shouldBe false
        watching(null, listOf(sam, pat)) shouldBe false
        watching(listOf("Pat Example"), listOf(sam, pat.copy(me = true))) shouldBe false
        watching(listOf("Sam Example"), listOf(sam, pat.copy(me = true))) shouldBe true
    }

    @Test
    fun `hiding trips the user is not on goes by the trip's flag or its bookings`() {
        val filters = ListFilters(hideWatching = true)
        hiddenFromList(trip.copy(travelers = listOf("Pat Example")), null, filters, listOf(sam, pat)) shouldBe true
        hiddenFromList(trip.copy(travelers = listOf("Pat Example")), null, ListFilters(), listOf(sam, pat)) shouldBe false
        hiddenFromList(trip, listOf(flight.copy(travelers = listOf("Pat Example"))), filters, listOf(sam, pat)) shouldBe true
        hiddenFromList(trip, listOf(flight.copy(travelers = listOf("Sam Example"))), filters, listOf(sam, pat)) shouldBe false
        hiddenFromList(trip, null, filters, listOf(sam, pat)) shouldBe false
    }

    @Test
    fun `a watched trip goes by its bookings once read else by what the trip keeps`() {
        watchedTrip(trip.copy(travelers = listOf("Sam Example")), listOf(flight.copy(travelers = listOf("Pat Example"))), listOf(sam, pat)) shouldBe true
        watchedTrip(trip.copy(travelers = listOf("Pat Example")), null, listOf(sam, pat)) shouldBe true
        watchedTrip(trip.copy(travelers = listOf("Pat Example")), listOf(flight.copy(travelers = listOf("Sam Example"))), listOf(sam, pat)) shouldBe false
        watchedTrip(trip, null, listOf(sam, pat)) shouldBe false
    }
}
