package app.travelmo.data

import app.travelmo.core.JourneyGap
import app.travelmo.core.LookResult



/** Settings' "Regroup trips", "Refresh from email" and "Delete all trips"; the parser in the app, a fake in tests. */
interface TripActions {
    /** False on a build with no parser address, where Settings sends the user to the web. */
    val available: Boolean

    /** Files every booking again; what it did, in a line. Throws [TripActionFailed]. */
    suspend fun regroup(): String

    /**
     * "Delete everything and start over" (SPEC "Starting over"): every trip the user owns with its bookings, what
     * imports put on the travel profile, then every mailbox read again; what it did, in a line. Throws [TripActionFailed].
     */
    suspend fun startOver(): String

    /**
     * Starts Refresh from email on the parser, from the first email again with [restart], or only the emails the
     * last one couldn't read with [retryFailed]; it runs there, and its progress shows on the user document. Throws
     * [TripActionFailed].
     */
    suspend fun refresh(restart: Boolean, retryFailed: Boolean = false)

    /** Stops the refresh under way; the batch reading saves its place. Throws [TripActionFailed]. */
    suspend fun stopRefresh()

    /** Searches the user's Gmail for a missing journey's emails and reads a few, from [next] on. Throws [TripActionFailed]. */
    suspend fun lookForJourney(gap: JourneyGap, next: Int?): LookResult
}

/** A trip action that did not go through, with the words Settings shows. */
class TripActionFailed(message: String, cause: Throwable? = null) : Exception(message, cause)

/** A build with no parser behind it. */
object NoTripActions : TripActions {
    override val available = false
    override suspend fun regroup(): String = throw TripActionFailed(ON_WEB)
    override suspend fun startOver(): String = throw TripActionFailed(ON_WEB)
    override suspend fun refresh(restart: Boolean, retryFailed: Boolean): Unit = throw TripActionFailed(ON_WEB)
    override suspend fun stopRefresh(): Unit = throw TripActionFailed(ON_WEB)
    override suspend fun lookForJourney(gap: JourneyGap, next: Int?): LookResult = throw TripActionFailed(ON_WEB)
}

private const val ON_WEB = "Use Settings on the web for this."
