package app.travelmo.data



/** Import review's "Import anyway"; the parser in the app, a fake in tests. */
interface ImportReview {
    /** False on a build with no parser address. */
    val available: Boolean

    /** Reads one Gmail, Fastmail or IMAP message again with the pre-filter skipped (the parser tells them apart by id); what came of it, in words. Throws [TripActionFailed]. */
    suspend fun reimport(messageId: String): String
}

object NoImportReview : ImportReview {
    override val available = false
    override suspend fun reimport(messageId: String): String = throw TripActionFailed("Use Import review on the web for this.")
}
