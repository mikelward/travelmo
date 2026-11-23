package app.travelmo.core

import io.kotest.matchers.shouldBe
import kotlin.test.Test

// Mirrors packages/core/src/calendarExportLinks.test.ts.
class ExportLinksTest {
    @Test
    fun `gives the link to copy and to open in a calendar app and to add to Google Calendar`() {
        exportLinks("abc", "https://parser.example/") shouldBe ExportLinks(
            https = "https://parser.example/cal/abc.ics",
            webcal = "webcal://parser.example/cal/abc.ics",
            google = "https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Fparser.example%2Fcal%2Fabc.ics",
        )
    }
}
