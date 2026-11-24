package app.travelmo.core

// What Settings' trip actions did, in a line, as packages/core's
// tripActions.ts says it on the web (SPEC "Home": regrouping; "Deleting all
// trips").

/** The parser's paths for them. */
const val REGROUP_PATH = "/trips/regroup"
const val DELETE_ALL_TRIPS_PATH = "/trips/delete-all"

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
