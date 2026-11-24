package app.travelmo.core

import kotlin.time.Instant

// What Settings says about "Import past bookings", as packages/core's
// backfillText.ts says it on the web, and the parser's paths for it.

const val GMAIL_CONNECT_PATH = "/gmail/connect"
const val GMAIL_DISCONNECT_PATH = "/gmail/disconnect"
const val BACKFILL_START_PATH = "/gmail/backfill"
const val BACKFILL_STOP_PATH = "/gmail/backfill/stop"
const val FASTMAIL_CONNECT_PATH = "/fastmail/connect"

/** The parser routes that issue and stop the forwarding address, as forward.ts. */
const val FORWARD_ISSUE_PATH = "/forward/issue"
const val FORWARD_STOP_PATH = "/forward/stop"
const val FASTMAIL_DISCONNECT_PATH = "/fastmail/disconnect"
const val FASTMAIL_BACKFILL_START_PATH = "/fastmail/backfill"
const val FASTMAIL_BACKFILL_STOP_PATH = "/fastmail/backfill/stop"
const val IMAP_CONNECT_PATH = "/imap/connect"
const val IMAP_DISCONNECT_PATH = "/imap/disconnect"
const val IMAP_BACKFILL_START_PATH = "/imap/backfill"
const val IMAP_BACKFILL_STOP_PATH = "/imap/backfill/stop"

/** How far the last reading of the mailbox got (`gmail.backfill`, `fastmail.backfill` or an `imaps` entry's on the user document). */
data class BackfillShown(
    val scanned: Int,
    val imported: Int,
    val done: Boolean,
    val updatedAt: String,
    val failed: Int = 0,
    val running: Boolean = false,
    val leaseUntil: String? = null,
    /** No batch reads before then: a pause the reading set itself (a rate limit, failed emails, a failed batch). */
    val retryAfter: String? = null,
    /** Batches in a row that failed; set on a reading that stopped after them. */
    val failures: Int = 0,
    /** Emails that failed, being tried again now that the rest are read. */
    val retrying: Int = 0,
)

/** A reading that has saved nothing for this long has stalled, so Settings offers to continue it. */
const val STALLED_AFTER_MS = 30L * 60 * 1000

private fun millis(at: String?): Long = at?.let { runCatching { Instant.parse(it).toEpochMilliseconds() }.getOrNull() } ?: 0L

fun isReading(progress: BackfillShown?, nowMs: Long): Boolean {
    if (progress == null || !progress.running || progress.done) return false
    // Waiting out a pause it set itself, up to two hours, is still reading.
    return nowMs - maxOf(millis(progress.updatedAt), millis(progress.leaseUntil), millis(progress.retryAfter)) < STALLED_AFTER_MS
}

private fun n(x: Int) = groupThousands(x.toLong())

private fun emails(x: Int) = if (x == 1) "1 email" else "${n(x)} emails"

/**
 * The reading goes on by itself past emails that fail to import (the model was down, say) and
 * tries them again once the rest are read, so the count says what happens to them rather than
 * asking anything of the user.
 */
fun describeBackfill(progress: BackfillShown, reading: Boolean): String {
    val read = "${n(progress.scanned)} booking-like emails read, ${n(progress.imported)} ${if (progress.imported == 1) "booking" else "bookings"} imported"
    val failed = progress.failed
    if (progress.done) {
        val left = if (failed > 0) " ${emails(failed)} couldn't be read, even on a second try. Read again from the start to try ${if (failed == 1) "it" else "them"} once more." else ""
        return "Whole mailbox read: $read.$left"
    }
    if (reading && progress.retrying > 0) return "Trying ${emails(progress.retrying)} that failed again… $read so far. You can close this page."
    val later = if (failed > 0) " ${emails(failed)} couldn't be read yet; ${if (failed == 1) "it's" else "they're"} tried again at the end." else ""
    return if (reading) "Reading your mailbox… $read so far.$later You can close this page." else "Stopped part way: $read.$later Continue to read the rest."
}

/** Why a reading stopped on its own, if it did: batch after batch failed for hours (a revoked grant, say). */
fun pausedReason(progress: BackfillShown?, reading: Boolean): String? {
    if (progress == null || progress.failures == 0 || progress.running || reading || progress.done) return null
    return "Reading stopped after repeated errors. Continue to try again; if it stops again, disconnect the mailbox and connect it again."
}
