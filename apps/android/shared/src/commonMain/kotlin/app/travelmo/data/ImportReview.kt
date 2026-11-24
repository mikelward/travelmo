package app.travelmo.data



/** Import review's "Import anyway"; the parser in the app, a fake in tests. */
interface ImportReview {
    /** False on a build with no parser address. */
    val available: Boolean

    /** Reads one Gmail, Fastmail or IMAP message again with the pre-filter skipped (the parser tells them apart by id); what came of it. Throws [TripActionFailed]. */
    suspend fun reimport(messageId: String): Reimported
}

/** What Import anyway did, in words, and the parser's report of it to copy (what was read, what the model said), when it gave one. */
data class Reimported(val said: String, val report: String? = null)

object NoImportReview : ImportReview {
    override val available = false
    override suspend fun reimport(messageId: String): Reimported = throw TripActionFailed("Use Import review on the web for this.")
}
