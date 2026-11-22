package app.travelmo.data

import app.travelmo.core.ACCOUNT_DELETE_PATH
import app.travelmo.core.accountDeletionFailure
import app.travelmo.core.parserEndpoint
import app.travelmo.log.TravelmoLog
import com.google.firebase.auth.FirebaseAuth
import com.mikelward.androidlog.safe
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext

/** Deletes the signed-in user's account; the parser in the app, a fake in tests. */
interface AccountDeletion {
    /** False on a build with no parser address, where Settings sends the user to the web. */
    val available: Boolean

    /** Deletes the account and everything in it; throws [AccountDeletionFailed] with what to tell the user. */
    suspend fun deleteAccount()
}

/** A deletion that did not go through, with the words Settings shows. A retry finishes the job. */
class AccountDeletionFailed(message: String, cause: Throwable? = null) : Exception(message, cause)

private const val DELETE_ON_WEB = "Delete your account from Settings on the web."

/** A build with no parser behind it. */
object NoAccountDeletion : AccountDeletion {
    override val available = false

    override suspend fun deleteAccount() {
        throw AccountDeletionFailed(DELETE_ON_WEB)
    }
}

/**
 * `POST /account/delete` on the parser (apps/parser), with the user's
 * Firebase ID token as the web's api.ts sends it. The parser does the work
 * with the Admin SDK: the rules let no client delete other people's records
 * of the user, nor the sign-in.
 */
class ParserAccountDeletion(
    private val baseUrl: String,
    private val idToken: suspend () -> String? = { FirebaseAuth.getInstance().currentUser?.getIdToken(false)?.await()?.token },
) : AccountDeletion {
    override val available: Boolean
        get() = parserEndpoint(baseUrl, ACCOUNT_DELETE_PATH) != null

    override suspend fun deleteAccount() {
        val endpoint = parserEndpoint(baseUrl, ACCOUNT_DELETE_PATH) ?: throw AccountDeletionFailed(DELETE_ON_WEB)
        val token = try {
            idToken()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            TravelmoLog.failure(e, "Getting an ID token to delete the account failed")
            throw AccountDeletionFailed(accountDeletionFailure(null), e)
        } ?: throw AccountDeletionFailed(accountDeletionFailure(401))
        TravelmoLog.info("Deleting the account")
        val status = try {
            post(endpoint, token)
        } catch (e: IOException) {
            TravelmoLog.failure(e, "Deleting the account failed: the parser could not be reached")
            throw AccountDeletionFailed(accountDeletionFailure(null), e)
        }
        if (status !in 200..299) {
            TravelmoLog.warning("Deleting the account failed: HTTP %s", safe(status.toString()))
            throw AccountDeletionFailed(accountDeletionFailure(status))
        }
        TravelmoLog.info("Deleted the account")
    }

    private suspend fun post(endpoint: String, token: String): Int = withContext(Dispatchers.IO) {
        val connection = URL(endpoint).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = CONNECT_TIMEOUT_MS
            // Deleting years of trips takes the parser a while.
            connection.readTimeout = READ_TIMEOUT_MS
            connection.doOutput = true
            connection.setRequestProperty("Authorization", "Bearer $token")
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write("{}".toByteArray()) }
            connection.responseCode
        } finally {
            connection.disconnect()
        }
    }

    private companion object {
        const val CONNECT_TIMEOUT_MS = 15_000
        const val READ_TIMEOUT_MS = 120_000
    }
}
