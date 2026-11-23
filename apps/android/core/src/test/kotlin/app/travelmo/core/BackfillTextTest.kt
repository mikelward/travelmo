package app.travelmo.core

import io.kotest.matchers.shouldBe
import java.time.Instant
import org.junit.jupiter.api.Test

// Matching packages/core/src/backfillText.test.ts.
class BackfillTextTest {
    private val now = Instant.parse("2026-11-22T12:00:00Z").toEpochMilli()
    private fun ago(ms: Long) = Instant.ofEpochMilli(now - ms).toString()

    @Test
    fun `follows the reading the parser runs, until it stops, finishes or stalls`() {
        val running = BackfillShown(scanned = 300, imported = 1, done = false, running = true, updatedAt = ago(60_000))
        isReading(running, now) shouldBe true
        isReading(running.copy(running = false), now) shouldBe false
        isReading(running.copy(done = true), now) shouldBe false
        isReading(null, now) shouldBe false
        isReading(running.copy(updatedAt = ago(STALLED_AFTER_MS)), now) shouldBe false
        isReading(running.copy(updatedAt = ago(STALLED_AFTER_MS), leaseUntil = ago(-60_000)), now) shouldBe true
    }

    @Test
    fun `says how far it got, while running, stopped and done`() {
        val at = ago(0)
        describeBackfill(BackfillShown(600, 1, false, at), true) shouldBe "Reading your mailbox… 600 booking-like emails read, 1 booking imported so far. You can close this page."
        describeBackfill(BackfillShown(600, 2, false, at), false) shouldBe "Stopped part way: 600 booking-like emails read, 2 bookings imported. Continue to read the rest."
        describeBackfill(BackfillShown(1234, 12, true, at), false) shouldBe "Whole mailbox read: 1,234 booking-like emails read, 12 bookings imported."
        describeBackfill(BackfillShown(1234, 12, true, at, failed = 3), false) shouldBe
            "Whole mailbox read: 1,234 booking-like emails read, 12 bookings imported, 3 failed. Read again from the start to try the failed ones again."
    }

    @Test
    fun `says why a batch with failed imports paused the reading, and nothing otherwise`() {
        val paused = BackfillShown(600, 0, false, ago(0), failed = 2, lastFailed = 2)
        pausedReason(paused, false) shouldBe
            "Reading paused: 2 emails in the last batch could not be imported. Continue when ready; failed emails are tried again when you read from the start."
        pausedReason(null, false) shouldBe null
        pausedReason(paused.copy(lastFailed = 0), false) shouldBe null
        pausedReason(paused, true) shouldBe null
        pausedReason(paused.copy(done = true), false) shouldBe null
    }
}
