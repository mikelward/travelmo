package app.travelmo.data



/**
 * Settings' "Calendar feeds": subscribing to a calendar link, which the
 * parser reads at once and every day after, and dropping one (SPEC
 * "Calendar feeds"); the parser in the app, a fake in tests.
 */
interface FeedActions {
    /** False on a build with no parser address. */
    val available: Boolean

    /** Subscribes to [url] and reads it; says what the first read did. Throws [TripActionFailed]. */
    suspend fun add(url: String): String

    /** Drops the feed [id]; its bookings stay. Throws [TripActionFailed]. */
    suspend fun remove(id: String)
}

object NoFeedActions : FeedActions {
    override val available = false
    override suspend fun add(url: String): String = throw TripActionFailed("Use Settings on the web for this.")
    override suspend fun remove(id: String): Unit = throw TripActionFailed("Use Settings on the web for this.")
}
