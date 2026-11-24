package app.travelmo.data



/** Has an open trip's flights looked at now; the parser in the app, a fake in tests. */
fun interface FlightRefresh {
    /** Asks; a failure is logged, never thrown, since the scheduled looks go on regardless. */
    suspend fun refresh(tripId: String)
}

/** A build with no parser behind it: the scheduled looks alone. */
val NoFlightRefresh = FlightRefresh { }
