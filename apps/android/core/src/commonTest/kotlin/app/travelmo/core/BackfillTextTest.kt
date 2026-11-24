package app.travelmo.core

import io.kotest.matchers.shouldBe
import kotlin.time.Instant
import kotlin.test.Test

// Matching packages/core/src/backfillText.test.ts.
class BackfillTextTest {
    private val now = Instant.parse("2026-11-22T12:00:00Z").toEpochMilliseconds()
    private fun ago(ms: Long) = Instant.fromEpochMilliseconds(now - ms).toString()

    @Test
    fun `follows the reading the parser runs until it stops finishes or stalls`() {
        val running = BackfillShown(scanned = 300, imported = 1, done = false, running = true, updatedAt = ago(60_000))
        isReading(running, now) shouldBe true
        isReading(running.copy(running = false), now) shouldBe false
        isReading(running.copy(done = true), now) shouldBe false
        isReading(null, now) shouldBe false
        isReading(running.copy(updatedAt = ago(STALLED_AFTER_MS)), now) shouldBe false
        isReading(running.copy(updatedAt = ago(STALLED_AFTER_MS), leaseUntil = ago(-60_000)), now) shouldBe true
        isReading(running.copy(updatedAt = ago(STALLED_AFTER_MS * 2), retryAfter = ago(-60 * 60_000)), now) shouldBe true
        isReading(running.copy(updatedAt = ago(STALLED_AFTER_MS * 4), retryAfter = ago(STALLED_AFTER_MS)), now) shouldBe false
    }

    @Test
    fun `says how far it got while running stopped and done`() {
        val at = ago(0)
        describeBackfill(BackfillShown(600, 1, false, at), true) shouldBe "Reading your mailbox… 600 booking-like emails read, 1 booking imported so far. You can close this page."
        describeBackfill(BackfillShown(600, 2, false, at), false) shouldBe "Stopped part way: 600 booking-like emails read, 2 bookings imported. Continue to read the rest."
        describeBackfill(BackfillShown(1234, 12, true, at), false) shouldBe "Whole mailbox read: 1,234 booking-like emails read, 12 bookings imported."
    }

    @Test
    fun `says what happens to emails that failed asking nothing until both tries are spent`() {
        val at = ago(0)
        describeBackfill(BackfillShown(600, 2, false, at, failed = 6), true) shouldBe
            "Reading your mailbox… 600 booking-like emails read, 2 bookings imported so far. 6 emails couldn't be read yet; they're tried again at the end. You can close this page."
        describeBackfill(BackfillShown(900, 3, false, at, failed = 6, retrying = 6), true) shouldBe
            "Trying 6 emails that failed again… 900 booking-like emails read, 3 bookings imported so far. You can close this page."
        describeBackfill(BackfillShown(1234, 12, true, at, failed = 1), false) shouldBe
            "Whole mailbox read: 1,234 booking-like emails read, 12 bookings imported. 1 email couldn't be read, even on a second try. Read again from the start to try it once more."
    }

    @Test
    fun `says why a reading stopped after repeated errors and nothing otherwise`() {
        val stopped = BackfillShown(600, 0, false, ago(0), failures = 6)
        pausedReason(stopped, false) shouldBe
            "Reading stopped after repeated errors. Continue to try again; if it stops again, disconnect the mailbox and connect it again."
        pausedReason(null, false) shouldBe null
        pausedReason(stopped.copy(failures = 0), false) shouldBe null
        pausedReason(stopped.copy(running = true), false) shouldBe null
        pausedReason(stopped, true) shouldBe null
        pausedReason(stopped.copy(done = true), false) shouldBe null
    }
}
