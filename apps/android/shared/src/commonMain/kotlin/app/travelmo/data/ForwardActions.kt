package app.travelmo.data



/**
 * Settings' "Forward by email": the user's own address to forward bookings
 * to, issued and turned off by the parser (SPEC "Forward to import"); the
 * parser in the app, a fake in tests.
 */
interface ForwardActions {
    /** False on a build with no parser address. */
    val available: Boolean

    /** Issues a new address, replacing any old one, which bounces from then on. Throws [TripActionFailed]. */
    suspend fun issue()

    /** Turns the address off; mail to it bounces from then on. Throws [TripActionFailed]. */
    suspend fun stop()
}

object NoForwardActions : ForwardActions {
    override val available = false
    override suspend fun issue(): Unit = throw TripActionFailed("Use Settings on the web for this.")
    override suspend fun stop(): Unit = throw TripActionFailed("Use Settings on the web for this.")
}
