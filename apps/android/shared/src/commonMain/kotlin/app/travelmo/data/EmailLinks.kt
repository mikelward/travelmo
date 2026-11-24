package app.travelmo.data



/**
 * Linking another email address to the account (SPEC "Linked email
 * addresses"): the parser mails a confirmation link, which opens on the web;
 * the parser in the app, a fake in tests.
 */
interface EmailLinks {
    /** False on a build with no parser address, where Settings lists the addresses but cannot change them. */
    val available: Boolean

    /** Mails a confirmation link to [email]; throws [EmailLinkFailed] with what to tell the user. */
    suspend fun add(email: String)

    /** Unlinks a confirmed address, or withdraws a pending one. */
    suspend fun remove(email: String)
}

/** A change that did not go through, with the words Settings shows. */
class EmailLinkFailed(message: String, cause: Throwable? = null) : Exception(message, cause)

const val CHANGE_ON_WEB = "Change your email addresses from Settings on the web."
const val TRY_AGAIN = "Couldn't reach Travelmo. Try again."

/** A build with no parser behind it. */
object NoEmailLinks : EmailLinks {
    override val available = false

    override suspend fun add(email: String) {
        throw EmailLinkFailed(CHANGE_ON_WEB)
    }

    override suspend fun remove(email: String) {
        throw EmailLinkFailed(CHANGE_ON_WEB)
    }
}
