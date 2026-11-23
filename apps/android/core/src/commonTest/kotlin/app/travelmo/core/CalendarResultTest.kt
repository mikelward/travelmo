package app.travelmo.core

import io.kotest.matchers.shouldBe
import kotlin.test.Test

// Mirrors packages/core/src/calendarResult.test.ts.
class CalendarResultTest {
    @Test
    fun `says what happened and whether to upload again`() {
        describeCalendarResult(CalendarResult(filtered = 3, notBooking = 1, imported = 2, recurring = 1)) shouldBe
            "2 events imported, 1 not bookings, 3 skipped as not travel."
        describeCalendarResult(CalendarResult(skipped = 5, imported = 1, failed = 1, remaining = 40)) shouldBe
            "1 event imported, 5 read before, 1 failed. 40 events are left: import the file again to continue."
        describeCalendarResult(CalendarResult(imported = 1, updated = 1)) shouldBe "1 event imported, 1 read again after changing."
    }
}
