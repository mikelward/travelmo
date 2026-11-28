package app.travelmo.data

import app.travelmo.core.ACCOUNT_DELETE_PATH
import app.travelmo.core.accountDeletionFailure
import app.travelmo.core.parserEndpoint
import app.travelmo.log.TravelmoLog
import com.google.firebase.auth.FirebaseAuth
import com.mikelward.androidlog.safe
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.tasks.await

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
    // Deleting years of trips takes the parser a while.
    private val client = ParserClient(baseUrl, idToken, readTimeoutMs = READ_TIMEOUT_MS, connectTimeoutMs = CONNECT_TIMEOUT_MS)

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
            client.postWithToken(endpoint, token).status
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

    private companion object {
        const val CONNECT_TIMEOUT_MS = 15_000
        const val READ_TIMEOUT_MS = 120_000
    }
}
