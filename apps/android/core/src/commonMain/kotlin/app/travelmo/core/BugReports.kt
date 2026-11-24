package app.travelmo.core

// Bug reports sent from inside the app (SPEC "Bug reports"), as
// packages/core's bugReports.ts has them: the parser's route, the limits it
// holds a report to, and what the app says when one did not go.

const val BUG_REPORT_PATH = "/reports"

/** Characters the user may type. */
const val BUG_REPORT_TEXT_MAX = 5_000

/** Characters of debug log. */
const val BUG_REPORT_LOG_MAX = 200_000

/** Bytes of PNG, once decoded from base64. */
const val BUG_REPORT_SCREENSHOT_MAX_BYTES = 2 * 1024 * 1024

/** Bookings of the trip a report is sent from. */
const val BUG_REPORT_BOOKINGS_MAX = 100

/** What the app says when a report did not go: by the parser's status, or with none when it could not be reached. */
fun bugReportFailure(status: Int?): String = when (status) {
    null -> "Couldn't reach Travelmo. Check your connection and try again."
    401, 403 -> "Couldn't confirm it's you. Sign out, sign in again and try again."
    413 -> "The report is too large to send."
    429 -> "You've sent the most reports for today. Try again tomorrow."
    503 -> "Sending reports isn't set up yet."
    else -> "That didn't work (error $status). Try again."
}

/** A place in full, as bugReports.ts's reportedPlaceText: name and address, city and country, code, and its point. */
fun reportedPlaceText(place: Place?): String? {
    if (place == null) return null
    val parts = listOf(
        listOfNotNull(place.name, place.address).joinToString(", "),
        listOfNotNull(place.city, place.country).joinToString(", "),
        place.code.orEmpty(),
        if (place.lat != null && place.lon != null) "${place.lat},${place.lon}" else "",
    ).filter { it.isNotEmpty() }
    return parts.takeIf { it.isNotEmpty() }?.joinToString(" · ")
}

/** The trip's bookings as lines a person reads, as bugReports.ts's reportedTripText. */
fun reportedTripText(trip: Trip, bookings: List<Segment>): String = buildList {
    add("--- Trip: ${trip.title} (${trip.id}), ${bookings.size} booking${if (bookings.size == 1) "" else "s"} ---")
    bookings.forEachIndexed { i, b ->
        add("")
        add("${i + 1}. ${b.type.wire}: ${b.title}${if (b.cancelledAt != null) " (cancelled)" else ""}")
        val start = b.start
        val whenText = listOfNotNull(start, b.end).joinToString(" to ")
        if (whenText.isNotEmpty()) add("   When: $whenText")
        reportedPlaceText(b.origin)?.let { add("   Origin: $it") }
        reportedPlaceText(b.destination)?.let { add("   Destination: $it") }
        b.provider?.let { add("   Provider: $it") }
        b.confirmation?.let { add("   Confirmation: $it") }
        b.notes?.let { add("   Notes: ${it.replace("\n", " ")}") }
        val sources = b.sources.map { "${it.label ?: "(no label)"} (${it.kind.wire})" }
        if (sources.isNotEmpty()) add("   Sources: ${sources.joinToString("; ")}")
    }
}.joinToString("\n")

/**
 * What a shared report (Share instead) leads with, as a sent one does: what
 * the user wrote, then on a trip's screen its bookings; null when neither.
 */
fun sharedReportPreamble(text: String, trip: Trip?, bookings: List<Segment>?): String? {
    val parts = listOfNotNull(
        text.trim().takeIf { it.isNotEmpty() },
        if (trip != null && bookings != null) reportedTripText(trip, bookings) else null,
    )
    return parts.takeIf { it.isNotEmpty() }?.joinToString("\n\n")
}
