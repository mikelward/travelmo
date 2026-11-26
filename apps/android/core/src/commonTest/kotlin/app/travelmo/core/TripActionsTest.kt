package app.travelmo.core

import io.kotest.matchers.shouldBe
import kotlin.test.Test

// Matching packages/core/src/tripActions.test.ts.
class TripActionsTest {
    @Test
    fun `says what regrouping changed or that nothing needed changing`() {
        describeRegroup(3, 0) shouldBe "Done: 3 trips rebuilt."
        describeRegroup(1, 1) shouldBe "Done: 1 trip rebuilt, 1 trip merged away."
        describeRegroup(0, 0) shouldBe "Your trips were already grouped this way."
        describeRegroup(0, 0, 2) shouldBe "Done: 2 bookings placed."
        describeRegroup(1, 0, 1) shouldBe "Done: 1 trip rebuilt, 1 booking placed."
    }

    @Test
    fun `says how many trips went and what to do next`() {
        describeDeletedTrips(12) shouldBe "Deleted 12 trips. Import past bookings to start again."
        describeDeletedTrips(1) shouldBe "Deleted 1 trip. Import past bookings to start again."
        describeDeletedTrips(0) shouldBe "You had no trips to delete."
    }

    @Test
    fun `says what starting over did`() {
        describeStartOver(12, 2) shouldBe "Deleted 12 trips. Reading your email again from the start."
        describeStartOver(0, 1) shouldBe "You had no trips to delete. Reading your email again from the start."
        describeStartOver(1, 0) shouldBe "Deleted 1 trip. Connect a mailbox, or import past bookings, to start again."
    }

    @Test
    fun `says why an action failed`() {
        tripActionFailure(null) shouldBe "Couldn't reach Travelmo. Check your connection and try again."
        tripActionFailure(401) shouldBe "Couldn't confirm it's you. Sign out, sign in again and try again."
        tripActionFailure(500) shouldBe "That didn't work (error 500). Try again."
    }

    @Test
    fun `says how far a refresh has got`() {
        val base = RefreshShown(scanned = 120, done = false, updatedAt = "2027-02-01T12:00:00Z", total = 340)
        describeRefresh(base, true) shouldBe "Refreshing your bookings… 120 of 340 emails read so far. You can close this page."
        describeRefresh(base, false) shouldBe "Stopped part way: 120 of 340 emails read. Continue to refresh the rest."
        describeRefresh(base.copy(scanned = 1, total = null), false) shouldBe "Stopped part way: 1 email read. Continue to refresh the rest."
    }

    @Test
    fun `says what a refresh changed once done`() {
        val at = "2027-02-01T12:00:00Z"
        describeRefresh(RefreshShown(340, true, at, total = 340, updated = 12, added = 2, merged = 3, removed = 1, kept = 4, missing = 2, failed = 1), false) shouldBe
            "Refreshed 340 emails: 12 bookings updated, 2 added, 3 duplicates merged, 1 removed. 4 bookings you edited were left as you left them. " +
            "2 emails are no longer in a connected mailbox. 1 email couldn't be read, even on a second try. Refresh again to see which."
        describeRefresh(RefreshShown(340, true, at, failed = 1, failedIds = listOf("m1")), false) shouldBe
            "Refreshed 340 emails: your bookings were already up to date. 1 email couldn't be read, even on a second try:"
        describeRefresh(RefreshShown(1, true, at, updated = 1, merged = 1, kept = 1, missing = 1), false) shouldBe
            "Refreshed 1 email: 1 booking updated, 1 duplicate merged. 1 booking you edited was left as you left it. 1 email is no longer in a connected mailbox."
        describeRefresh(RefreshShown(2400, true, at), false) shouldBe "Refreshed 2,400 emails: your bookings were already up to date."
    }

    @Test
    fun `offers to start or continue a refresh`() {
        val stopped = RefreshShown(3, false, "2027-02-01T12:00:00Z")
        refreshButton(null) shouldBe "Refresh from email"
        refreshButton(stopped.copy(done = true)) shouldBe "Refresh from email"
        refreshButton(stopped) shouldBe "Continue refreshing"
    }

    @Test
    fun `says it is trying the failed emails again`() {
        val at = "2027-02-01T12:00:00Z"
        describeRefresh(RefreshShown(340, false, at, total = 340, retrying = listOf("a", "b")), true) shouldBe
            "Refreshing your bookings… trying 2 emails that couldn't be read again. You can close this page."
        describeRefresh(RefreshShown(340, false, at, total = 340, retrying = listOf("a")), false) shouldBe
            "Stopped part way: 1 email that couldn't be read still to try again. Continue to try it."
    }

    @Test
    fun `lists the emails a finished refresh could not read and counts the rest`() {
        val ids = List(12) { "m$it" }
        val done = RefreshShown(340, true, "2027-02-01T12:00:00Z", failed = 14, failedIds = ids)
        failedEmailIds(done) shouldBe ids.take(FAILED_EMAILS_SHOWN)
        moreFailedEmails(done) shouldBe "and 4 more"
        failedEmailIds(done.copy(done = false)) shouldBe emptyList()
        moreFailedEmails(done.copy(failed = 1, failedIds = listOf("m0"))) shouldBe null
        failedEmailLine(ParsedRecord("m0", "imported", "2027-02-01T12:00:00Z", subject = "Your booking", from = "Example Air <hi@example.com>")) shouldBe
            "Your booking · Example Air <hi@example.com>"
        failedEmailLine(ParsedRecord("m0", "imported", "2027-02-01T12:00:00Z", subject = "  ")) shouldBe "(no subject)"
        failedEmailLine(null) shouldBe "(no subject)"
        failedEmailsReport(done.copy(failed = 2, failedIds = listOf("m1", "m2"))) shouldBe "\"Refresh from email\" couldn't read 2 emails: m1, m2"
    }

    @Test
    fun `a refresh reads as running until it stalls`() {
        val running = RefreshShown(3, false, "2027-02-01T12:00:00Z", running = true)
        val at = kotlin.time.Instant.parse("2027-02-01T12:10:00Z").toEpochMilliseconds()
        running.reading(at) shouldBe true
        running.reading(at + STALLED_AFTER_MS) shouldBe false
        running.copy(running = false).reading(at) shouldBe false
    }
}
