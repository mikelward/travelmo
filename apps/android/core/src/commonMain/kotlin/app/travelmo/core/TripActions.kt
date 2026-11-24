package app.travelmo.core

// What Settings' trip actions did, in a line, as packages/core's
// tripActions.ts says it on the web (SPEC "Home": regrouping; "Refresh from
// email"; "Deleting all trips").

/** The parser's paths for them. */
const val REGROUP_PATH = "/trips/regroup"
const val DELETE_ALL_TRIPS_PATH = "/trips/delete-all"
const val REFRESH_PATH = "/trips/refresh"
const val REFRESH_STOP_PATH = "/trips/refresh/stop"

private fun count(n: Int, what: String) = "$n $what${if (n == 1) "" else "s"}"

private fun trips(n: Int) = count(n, "trip")

/** What regrouping did: [changed] trips rebuilt, [deleted] merged away, [placed] bookings given a place from the tables first. */
fun describeRegroup(changed: Int, deleted: Int, placed: Int = 0): String {
    if (changed == 0 && deleted == 0 && placed == 0) return "Your trips were already grouped this way."
    val parts = listOfNotNull(
        if (changed > 0) "${trips(changed)} rebuilt" else null,
        if (deleted > 0) "${trips(deleted)} merged away" else null,
        if (placed > 0) "${count(placed, "booking")} placed" else null,
    )
    return "Done: ${parts.joinToString(", ")}."
}

/** What deleting all trips did, with the next step. */
fun describeDeletedTrips(trips: Int): String =
    if (trips == 0) "You had no trips to delete." else "Deleted ${trips(trips)}. Import past bookings to start again."

/**
 * What a trip action says when it did not go through: by the parser's
 * status, or with none when the parser could not be reached.
 */
fun tripActionFailure(status: Int?): String = when (status) {
    null -> "Couldn't reach Travelmo. Check your connection and try again."
    401, 403 -> "Couldn't confirm it's you. Sign out, sign in again and try again."
    else -> "That didn't work (error $status). Try again."
}

/** What Refresh from email does, under its button. */
const val REFRESH_BLURB = "Reads the emails your bookings came from again and updates those bookings. Bookings you edited stay as you left them."

/**
 * How far the last Refresh from email got (refresh on the user document):
 * emails read of [total], and what it did to the bookings.
 */
data class RefreshShown(
    val scanned: Int,
    val done: Boolean,
    val updatedAt: String,
    val total: Int? = null,
    val updated: Int = 0,
    val added: Int = 0,
    val removed: Int = 0,
    val merged: Int = 0,
    val kept: Int = 0,
    val missing: Int = 0,
    val failed: Int = 0,
    val running: Boolean = false,
    val leaseUntil: String? = null,
    /** The emails that failed again on a second try, the first up to the parser's limit. */
    val failedIds: List<String> = emptyList(),
    /** While the failed emails are being read again: those still to try. */
    val retrying: List<String> = emptyList(),
) {
    /** Whether the parser is refreshing now, judged as a mailbox reading is ([isReading]). */
    fun reading(nowMs: Long): Boolean =
        isReading(BackfillShown(scanned, 0, done, updatedAt, running = running, leaseUntil = leaseUntil), nowMs)
}

private fun count(x: Int) = groupThousands(x.toLong())

private fun plural(x: Int, one: String, many: String) = "${count(x)} ${if (x == 1) one else many}"

/** The refresh's button while none is running: start one, or carry on with one that stopped part way. */
fun refreshButton(progress: RefreshShown?): String =
    if (progress != null && !progress.done) "Continue refreshing" else "Refresh from email"

/** How far a refresh has got, or what it did once done. */
fun describeRefresh(progress: RefreshShown, reading: Boolean): String {
    val read = progress.total?.let { "${count(progress.scanned)} of ${plural(it, "email", "emails")}" } ?: plural(progress.scanned, "email", "emails")
    if (!progress.done) {
        val again = progress.retrying.size
        if (again > 0) {
            val these = plural(again, "email that couldn't be read", "emails that couldn't be read")
            return if (reading) "Refreshing your bookings… trying $these again. You can close this page."
            else "Stopped part way: $these still to try again. Continue to try ${if (again == 1) "it" else "them"}."
        }
        return if (reading) "Refreshing your bookings… $read read so far. You can close this page." else "Stopped part way: $read read. Continue to refresh the rest."
    }
    val changes = listOfNotNull(
        if (progress.updated > 0) "${plural(progress.updated, "booking", "bookings")} updated" else null,
        if (progress.added > 0) "${count(progress.added)} added" else null,
        if (progress.merged > 0) "${plural(progress.merged, "duplicate", "duplicates")} merged" else null,
        if (progress.removed > 0) "${count(progress.removed)} removed" else null,
    )
    val lines = mutableListOf(
        "Refreshed ${plural(progress.scanned, "email", "emails")}: " + if (changes.isEmpty()) "your bookings were already up to date." else "${changes.joinToString(", ")}.",
    )
    if (progress.kept > 0) lines += "${plural(progress.kept, "booking you edited was", "bookings you edited were")} left as you left ${if (progress.kept == 1) "it" else "them"}."
    if (progress.missing > 0) lines += "${plural(progress.missing, "email is", "emails are")} no longer in a connected mailbox."
    if (progress.failed > 0) lines += "${plural(progress.failed, "email", "emails")} couldn't be read, even on a second try:"
    return lines.joinToString(" ")
}

/** How many of the emails a finished refresh couldn't read Settings lists under what it did. */
const val FAILED_EMAILS_SHOWN = 10

/** The first of those emails' ids, once the refresh is done. */
fun failedEmailIds(progress: RefreshShown?): List<String> =
    if (progress?.done == true) progress.failedIds.take(FAILED_EMAILS_SHOWN) else emptyList()

/** How many more couldn't be read than the list shows. */
fun moreFailedEmails(progress: RefreshShown): String? {
    val more = progress.failed - failedEmailIds(progress).size
    return if (more > 0) "and ${count(more)} more" else null
}

/** One email in that list, by what its import record kept of it. */
fun failedEmailLine(record: ParsedRecord?): String {
    val subject = record?.subject?.trim()?.takeIf { it.isNotEmpty() } ?: "(no subject)"
    return record?.from?.let { "$subject · $it" } ?: subject
}

/** The bug report Report a problem starts from: what happened and the emails' ids, which the maintainer finds them by in the logs. */
fun failedEmailsReport(progress: RefreshShown): String {
    val total = if (progress.failed > 0) progress.failed else progress.failedIds.size
    return "\"Refresh from email\" couldn't read ${plural(total, "email", "emails")}: ${progress.failedIds.take(50).joinToString(", ")}"
}
