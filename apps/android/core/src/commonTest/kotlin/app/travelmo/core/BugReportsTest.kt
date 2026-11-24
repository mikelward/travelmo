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
}
