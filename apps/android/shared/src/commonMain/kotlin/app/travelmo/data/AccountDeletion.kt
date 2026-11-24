package app.travelmo.data



/** Deletes the signed-in user's account; the parser in the app, a fake in tests. */
interface AccountDeletion {
    /** False on a build with no parser address, where Settings sends the user to the web. */
    val available: Boolean

    /** Deletes the account and everything in it; throws [AccountDeletionFailed] with what to tell the user. */
    suspend fun deleteAccount()
}

/** A deletion that did not go through, with the words Settings shows. A retry finishes the job. */
class AccountDeletionFailed(message: String, cause: Throwable? = null) : Exception(message, cause)

const val DELETE_ON_WEB = "Delete your account from Settings on the web."

/** A build with no parser behind it. */
object NoAccountDeletion : AccountDeletion {
    override val available = false

    override suspend fun deleteAccount() {
        throw AccountDeletionFailed(DELETE_ON_WEB)
    }
}
