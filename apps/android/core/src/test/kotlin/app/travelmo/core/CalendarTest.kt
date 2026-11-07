package app.travelmo.core

import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test

private fun trip(id: String, start: String, end: String) = Trip(id, id, start, end, "u")

class CalendarTest {
    @Test
    fun `steps across years and names a month`() {
        addMonths("2026-11", 1) shouldBe "2026-12"
        addMonths("2026-12", 1) shouldBe "2027-01"
        addMonths("2026-01", -1) shouldBe "2025-12"
        addMonths("2026-03", -15) shouldBe "2024-12"
        monthOf("2026-11-07") shouldBe "2026-11"
        monthLabel("2026-11") shouldBe "November 2026"
    }

    @Test
    fun `starts each week on Monday and pads with the months around`() {
        // 1 November 2026 is a Sunday.
        val weeks = monthWeeks("2026-11")
        weeks.size shouldBe 6
        weeks[0] shouldBe listOf("2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01")
        weeks[5][0] shouldBe "2026-11-30"
        weeks[5][6] shouldBe "2026-12-06"
        // February 2027 starts on a Monday and has 28 days.
        val february = monthWeeks("2027-02")
        february.size shouldBe 4
        february[0][0] shouldBe "2027-02-01"
        february[3][6] shouldBe "2027-02-28"
    }

    @Test
    fun `clips a trip to the week, says which way it carries on, and stacks lanes`() {
        val week = monthWeeks("2026-12")[2] // 14–20 December 2026
        weekBars(week, listOf(trip("long", "2026-12-10", "2026-12-25"), trip("short", "2026-12-16", "2026-12-17")))
            .map { listOf(it.trip.id, it.from, it.to, it.continuesBefore, it.continuesAfter, it.lane) } shouldBe
            listOf(listOf("long", 0, 6, true, true, 0), listOf("short", 2, 3, false, false, 1))
        weekBars(
            week,
            listOf(trip("a", "2026-12-14", "2026-12-15"), trip("b", "2026-12-15", "2026-12-16"), trip("c", "2026-12-17", "2026-12-18"), trip("elsewhere", "2026-12-21", "2026-12-22")),
        ).map { it.trip.id to it.lane } shouldBe listOf("a" to 0, "b" to 1, "c" to 0)
        weekBars(week, listOf(trip("one day", "2026-12-15", "2026-12-15"), trip("two days", "2026-12-15", "2026-12-16"))).map { it.trip.id } shouldBe
            listOf("two days", "one day")
    }

    @Test
    fun `lists every month a trip touches, once, in order`() {
        tripMonths(listOf(trip("a", "2026-12-28", "2027-01-03"), trip("b", "2025-06-10", "2025-06-14"), trip("c", "2026-12-01", "2026-12-02"))) shouldBe
            listOf("2025-06", "2026-12", "2027-01")
    }
}
