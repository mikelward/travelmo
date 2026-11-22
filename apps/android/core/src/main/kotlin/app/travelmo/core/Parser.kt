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
 * What Settings says when deleting the account did not go through: by the
 * parser's status, or with none when the parser could not be reached. A
 * retry finishes whatever an interrupted deletion left.
 */
fun accountDeletionFailure(status: Int?): String = when (status) {
    null -> "Couldn't reach Travelmo. Check your connection and try again."
    401, 403 -> "Couldn't confirm it's you. Sign out, sign in again and try again."
    else -> "Couldn't delete your account (error $status). Try again."
}
