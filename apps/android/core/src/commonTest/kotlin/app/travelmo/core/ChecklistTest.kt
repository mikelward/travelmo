package app.travelmo.core

import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import kotlin.test.Test

// Mirrors packages/core/src/checklist.test.ts.
private val lhr = Place("London Heathrow", code = "LHR", city = "London", country = "GB")
private val lis = Place("Lisbon", code = "LIS", city = "Lisbon", country = "PT")
private val man = Place("Manchester", code = "MAN", city = "Manchester", country = "GB")
private val lhrBare = Place("London Heathrow", code = "LHR", city = "London")
private val lisBare = Place("Lisbon", code = "LIS")
private val lookup: (String) -> AirportPlace? = { code -> mapOf("LHR" to AirportPlace("GB", 51.47, -0.45), "LIS" to AirportPlace("PT", 38.77, -9.13))[code] }
private val noLookup: (String) -> AirportPlace? = { null }

private fun seg(id: String, type: SegmentType, start: String, end: String?, origin: Place? = null, destination: Place? = null, cancelledAt: String? = null) =
    Segment(id, "t", type, id, start, end = end, origin = origin, destination = destination, cancelledAt = cancelledAt)

private val trip = Trip("lisbon", "Lisbon", "2026-12-12", "2026-12-19", "u")
private val out = seg("out", SegmentType.FLIGHT, "2026-12-12T08:00:00+00:00", "2026-12-12T10:45:00+00:00", lhr, lis)
private val back = seg("back", SegmentType.FLIGHT, "2026-12-19T12:30:00+00:00", "2026-12-19T15:10:00+00:00", lis, lhr)
private val visa = Reminder("s0", "visa", "Apply for a visa", Lead(30, LeadUnit.DAYS))
private val meds = Reminder("s1", "meds", "Request prescriptions", Lead(2, LeadUnit.WEEKS))
private val adapter = Reminder("a0", "adapter", "Pack the adapter", date = "2026-12-10")

class ChecklistTest {
    @Test
    fun `counts days weeks and calendar months back from the trip's first day`() {
        reminderDue("2026-12-12", Lead(30, LeadUnit.DAYS)) shouldBe "2026-11-12"
        reminderDue("2026-12-12", Lead(2, LeadUnit.WEEKS)) shouldBe "2026-11-28"
        reminderDue("2026-03-31", Lead(1, LeadUnit.MONTHS)) shouldBe "2026-02-28"
        reminderDue("2026-12-12", Lead(0, LeadUnit.DAYS)) shouldBe "2026-12-12"
        reminderDue("2026-12-12", adapter) shouldBe "2026-12-10"
    }

    @Test
    fun `says how long before in words`() {
        leadText(Lead(30, LeadUnit.DAYS)) shouldBe "30 days before"
        leadText(Lead(1, LeadUnit.WEEKS)) shouldBe "1 week before"
        leadText(Lead(2, LeadUnit.MONTHS)) shouldBe "2 months before"
        leadText(Lead(0, LeadUnit.DAYS)) shouldBe "The day it starts"
    }

    @Test
    fun `is international when a booking is in another country than home where the trip's round trip starts`() {
        homeCountry(listOf(out, back), emptyList(), trip.start, noLookup) shouldBe "GB"
        isInternational(trip, listOf(out, back), emptyList(), noLookup) shouldBe true
    }

    @Test
    fun `is not for a trip within the home country`() {
        val north = seg("north", SegmentType.TRAIN, "2026-12-12T08:00:00+00:00", "2026-12-12T10:00:00+00:00", lhr, man)
        val south = seg("south", SegmentType.TRAIN, "2026-12-14T08:00:00+00:00", "2026-12-14T10:00:00+00:00", man, lhr)
        isInternational(trip, listOf(north, south), emptyList(), noLookup) shouldBe false
    }

    @Test
    fun `finds home's country from the airport table when the bookings name none`() {
        val o = seg("out", SegmentType.FLIGHT, "2026-12-12T08:00:00+00:00", "2026-12-12T10:45:00+00:00", lhrBare, lisBare)
        val b = seg("back", SegmentType.FLIGHT, "2026-12-19T12:30:00+00:00", "2026-12-19T15:10:00+00:00", lisBare, lhrBare)
        isInternational(trip, listOf(o, b), emptyList(), noLookup) shouldBe false
        homeCountry(listOf(o, b), emptyList(), trip.start, lookup) shouldBe "GB"
        isInternational(trip, listOf(o, b), emptyList(), lookup) shouldBe true
    }

    @Test
    fun `is not without a known home until Profile says where home is`() {
        isInternational(trip, listOf(out), emptyList(), noLookup) shouldBe false
        isInternational(trip, listOf(out), listOf(HomeCorrection("London", "GB", "2020-01-01")), noLookup) shouldBe true
        val stay = seg("stay", SegmentType.LODGING, "2026-12-12T15:00:00+00:00", "2026-12-19T11:00:00+00:00", null, lis)
        isInternational(trip, listOf(stay), listOf(HomeCorrection("Lisbon", "PT", "2026-01-01")), noLookup) shouldBe false
    }

    @Test
    fun `is not when no booking says where it is or every booking was cancelled`() {
        isInternational(trip, emptyList(), listOf(HomeCorrection("London", "GB", "2020-01-01")), noLookup) shouldBe false
        val c = "2026-11-01T00:00:00Z"
        isInternational(trip, listOf(out.copy(cancelledAt = c), back.copy(cancelledAt = c)), emptyList(), noLookup) shouldBe false
    }

    @Test
    fun `lists the standing reminders for an international trip and its one-offs soonest first ticked ones marked`() {
        tripChecklist(trip, listOf(meds, visa), listOf("meds"), listOf(adapter), international = true) shouldBe listOf(
            ChecklistEntry("visa", "Apply for a visa", "2026-11-12", done = false, oneOff = false, slot = "s0"),
            ChecklistEntry("meds", "Request prescriptions", "2026-11-28", done = true, oneOff = false, slot = "s1"),
            ChecklistEntry("adapter", "Pack the adapter", "2026-12-10", done = false, oneOff = true, slot = "a0"),
        )
    }

    @Test
    fun `leaves out the standing reminders for a trip at home keeping its one-offs`() {
        tripChecklist(trip, listOf(visa), emptyList(), listOf(adapter), international = false).map { it.id } shouldBe listOf("adapter")
    }

    @Test
    fun `dates from when the person travels not the trip's own dates`() {
        val moved = trip.copy(liveStart = "2026-12-14", liveEnd = "2026-12-19")
        tripChecklist(moved, listOf(visa), emptyList(), emptyList(), international = true).single().due shouldBe "2026-11-14"
    }

    @Test
    fun `sends what is due and not ticked off at once for a trip booked late and nothing once it started`() {
        val list = tripChecklist(trip, listOf(meds, visa), listOf("meds"), listOf(adapter), international = true)
        dueEntries(trip, list, "2026-11-11") shouldBe emptyList()
        dueEntries(trip, list, "2026-11-12").map { it.id } shouldBe listOf("visa")
        dueEntries(trip, list, "2026-12-01").map { it.id } shouldBe listOf("visa")
        dueEntries(trip, list, "2026-12-12").map { it.id } shouldBe listOf("visa", "adapter")
        dueEntries(trip, list, "2026-12-13") shouldBe emptyList()
    }

    @Test
    fun `says the day it is due`() {
        dueText("2026-11-12", "2026-11-01") shouldBe "By Thu 12 Nov"
        dueText("2026-11-12", "2026-11-12") shouldBe "Today"
    }

    @Test
    fun `puts a new reminder in the first free slot and none once all are taken`() {
        freeSlot(emptyList(), "s", 20) shouldBe "s0"
        freeSlot(listOf("s0", "s2"), "s", 20) shouldBe "s1"
        freeSlot(listOf("a0", "a1"), "a", 2).shouldBeNull()
        listOf("s10", "s2").sortedBy(::slotNumber) shouldBe listOf("s2", "s10")
    }

    @Test
    fun `ticks and unticks keeping the newest when full`() {
        withDone(listOf("a"), "b", true) shouldBe listOf("a", "b")
        withDone(listOf("a", "b"), "a", false) shouldBe listOf("b")
        withDone(listOf("a"), "a", true) shouldBe listOf("a")
        val full = (0 until MAX_DONE_REMINDERS).map { "r$it" }
        withDone(full, "new", true) shouldBe full.drop(1) + "new"
    }

    @Test
    fun `takes a reminder with text a lead time and a short id as the web's schema does`() {
        reminderOrNull("s0", "r1", " Apply for a visa ", 30L, "days", null, dated = false) shouldBe Reminder("s0", "r1", "Apply for a visa", Lead(30, LeadUnit.DAYS))
        reminderOrNull("s0", "r1", "", 30L, "days", null, dated = false).shouldBeNull()
        reminderOrNull("s0", "r1", "x".repeat(201), 30L, "days", null, dated = false).shouldBeNull()
        reminderOrNull("s0", "r1", "x", 13L, "months", null, dated = false).shouldBeNull()
        reminderOrNull("s0", "r1", "x", 1.5, "days", null, dated = false).shouldBeNull()
        reminderOrNull("s0", "a/b", "x", 1L, "days", null, dated = false).shouldBeNull()
        reminderOrNull("a0", "r1", "Pack", null, null, "2026-12-01", dated = true) shouldBe Reminder("a0", "r1", "Pack", date = "2026-12-01")
        reminderOrNull("s0", "r1", "Pack", null, null, "2026-12-01", dated = false).shouldBeNull()
        reminderOrNull("a0", "r1", "Pack", null, null, "soon", dated = true).shouldBeNull()
    }
}
