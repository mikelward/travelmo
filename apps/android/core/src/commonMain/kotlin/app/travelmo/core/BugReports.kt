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
