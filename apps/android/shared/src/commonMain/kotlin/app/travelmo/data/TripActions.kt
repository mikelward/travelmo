package app.travelmo.data



/** Settings' "Regroup trips" and "Delete all trips"; the parser in the app, a fake in tests. */
interface TripActions {
    /** False on a build with no parser address, where Settings sends the user to the web. */
    val available: Boolean

    /** Files every booking again; what it did, in a line. Throws [TripActionFailed]. */
    suspend fun regroup(): String

    /** Deletes every trip the user owns, with its bookings; what it did, in a line. Throws [TripActionFailed]. */
    suspend fun deleteAll(): String
}

/** A trip action that did not go through, with the words Settings shows. */
class TripActionFailed(message: String, cause: Throwable? = null) : Exception(message, cause)

/** A build with no parser behind it. */
object NoTripActions : TripActions {
    override val available = false
    override suspend fun regroup(): String = throw TripActionFailed(ON_WEB)
    override suspend fun deleteAll(): String = throw TripActionFailed(ON_WEB)
}

private const val ON_WEB = "Use Settings on the web for this."
