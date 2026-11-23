package app.travelmo.core

import java.time.Instant
import java.text.NumberFormat
import java.util.Locale

// What Settings says about "Import past bookings", as packages/core's
// backfillText.ts says it on the web, and the parser's paths for it.

const val GMAIL_CONNECT_PATH = "/gmail/connect"
const val GMAIL_DISCONNECT_PATH = "/gmail/disconnect"
const val BACKFILL_START_PATH = "/gmail/backfill"
const val BACKFILL_STOP_PATH = "/gmail/backfill/stop"

/** How far the last reading of the mailbox got (`gmail.backfill` on the user document). */
data class BackfillShown(
    val scanned: Int,
    val imported: Int,
    val done: Boolean,
    val updatedAt: String,
    val failed: Int = 0,
    val running: Boolean = false,
    val leaseUntil: String? = null,
    val lastFailed: Int = 0,
)

/** A reading that has saved nothing for this long has stalled, so Settings offers to continue it. */
const val STALLED_AFTER_MS = 30L * 60 * 1000

private fun millis(at: String?): Long = at?.let { runCatching { Instant.parse(it).toEpochMilli() }.getOrNull() } ?: 0L

fun isReading(progress: BackfillShown?, nowMs: Long): Boolean {
    if (progress == null || !progress.running || progress.done) return false
    return nowMs - maxOf(millis(progress.updatedAt), millis(progress.leaseUntil)) < STALLED_AFTER_MS
}

private fun n(x: Int) = NumberFormat.getIntegerInstance(Locale.US).format(x)

fun describeBackfill(progress: BackfillShown, reading: Boolean): String {
    val failed = if (progress.failed > 0) ", ${n(progress.failed)} failed" else ""
    val read = "${n(progress.scanned)} booking-like emails read, ${n(progress.imported)} ${if (progress.imported == 1) "booking" else "bookings"} imported$failed"
    if (progress.done) return "Whole mailbox read: $read.${if (progress.failed > 0) " Read again from the start to try the failed ones again." else ""}"
    return if (reading) "Reading your mailbox… $read so far. You can close this page." else "Stopped part way: $read. Continue to read the rest."
}

/** Why a reading paused on its own, if it did. */
fun pausedReason(progress: BackfillShown?, reading: Boolean): String? {
    if (progress == null || progress.lastFailed == 0 || reading || progress.done) return null
    val what = if (progress.lastFailed == 1) "1 email" else "${n(progress.lastFailed)} emails"
    return "Reading paused: $what in the last batch could not be imported. Continue when ready; failed emails are tried again when you read from the start."
}
