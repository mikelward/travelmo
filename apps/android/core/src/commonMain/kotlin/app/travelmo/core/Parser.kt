package app.travelmo.core

/**
 * The parser's (apps/parser) address for [path], as the web's api.ts joins
 * them: one slash between, whatever either side carries. Null when the
 * build has no parser address (README "Android").
 */
fun parserEndpoint(baseUrl: String?, path: String): String? {
    val base = baseUrl?.trim()?.trimEnd('/')?.takeIf { it.isNotEmpty() } ?: return null
    return "$base/${path.trimStart('/')}"
}

/** The account deletion endpoint (SPEC "Deleting an account"). */
const val ACCOUNT_DELETE_PATH = "/account/delete"

/**
 * The parser's answer (410) to a request from an account whose deletion
 * stopped part way: the sign-in, which goes last, is still there. The app
 * offers to finish deleting it (packages/core/src/accountDeletion.ts).
 */
const val DELETION_UNFINISHED_TEXT = "Deleting your account didn't finish."

fun isDeletionUnfinished(status: Int, body: String): Boolean = status == 410 && body.trim() == DELETION_UNFINISHED_TEXT

/**
 * What Settings says when deleting the account did not go through: by the
 * parser's status, or with none when the parser could not be reached. A
 * retry finishes whatever an interrupted deletion left.
 */
fun accountDeletionFailure(status: Int?): String = when (status) {
    null -> "Couldn't reach Travelmo. Check your connection and try again."
    401, 403 -> "Couldn't confirm it's you. Sign out, sign in again and try again."
    else -> "Couldn't delete your account (error $status). Try again."
}

/** Has an open trip's flights looked at now (SPEC "Live flight status"). */
const val FLIGHTS_REFRESH_PATH = "/flights/refresh"
