package app.travelmo.core

import io.kotest.matchers.shouldBe
import kotlin.test.Test

// Matching packages/core/src/bugReports.test.ts.
class BugReportsTest {
    @Test
    fun `says why a report did not go`() {
        bugReportFailure(null) shouldBe "Couldn't reach Travelmo. Check your connection and try again."
        bugReportFailure(401) shouldBe "Couldn't confirm it's you. Sign out, sign in again and try again."
        bugReportFailure(413) shouldBe "The report is too large to send."
        bugReportFailure(429) shouldBe "You've sent the most reports for today. Try again tomorrow."
        bugReportFailure(503) shouldBe "Sending reports isn't set up yet."
        bugReportFailure(500) shouldBe "That didn't work (error 500). Try again."
    }

    @Test
    fun `holds a report to the parser's limits`() {
        BUG_REPORT_PATH shouldBe "/reports"
        BUG_REPORT_TEXT_MAX shouldBe 5_000
        BUG_REPORT_LOG_MAX shouldBe 200_000
        BUG_REPORT_SCREENSHOT_MAX_BYTES shouldBe 2_097_152
        BUG_REPORT_BOOKINGS_MAX shouldBe 100
    }

    @Test
    fun `a shared report leads with what was written then the trip's bookings as a sent one's email does`() {
        val trip = Trip("t1", "Liverpool", "2026-12-12", "2026-12-14", ownerUid = "u")
        val stay = Segment(
            "s1", "t1", SegmentType.LODGING, "Cove Liverpool", "2026-12-12T15:00:00+00:00", "2026-12-14T11:00:00+00:00",
            provider = "Cove", confirmation = "CV-1", destination = Place("Cove Liverpool", city = "Liverpool", country = "GB"),
            sources = listOf(SourceRef(SourceKind.GMAIL, "m1", label = "Your stay", at = "2026-11-01T00:00:00Z")),
        )
        sharedReportPreamble("  Wrong hotel ", trip, listOf(stay)) shouldBe listOf(
            "Wrong hotel",
            "",
            "--- Trip: Liverpool (t1), 1 booking ---",
            "",
            "1. lodging: Cove Liverpool",
            "   When: 2026-12-12T15:00:00+00:00 to 2026-12-14T11:00:00+00:00",
            "   Destination: Cove Liverpool · Liverpool, GB",
            "   Provider: Cove",
            "   Confirmation: CV-1",
            "   Sources: Your stay (gmail)",
        ).joinToString("\n")
        sharedReportPreamble("", null, null) shouldBe null
        sharedReportPreamble("", trip, emptyList()) shouldBe "--- Trip: Liverpool (t1), 0 bookings ---"
    }
}
