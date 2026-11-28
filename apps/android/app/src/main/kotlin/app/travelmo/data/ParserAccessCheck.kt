package app.travelmo.data

import app.travelmo.core.ACCESS_CHECK_PATH
import app.travelmo.core.AccountAccess
import app.travelmo.core.accessCheckAnswer
import app.travelmo.core.isDeletionUnfinished
import app.travelmo.core.parserEndpoint
import app.travelmo.log.TravelmoLog
import com.google.firebase.auth.FirebaseAuth
import com.mikelward.androidlog.safe
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.tasks.await

/**
 * `POST /access/check` on the parser, with the user's Firebase ID token as
 * [ParserAccountDeletion] sends it. It lets in an account from before
 * approvals that the rules cannot tell is one (an Android-only owner has no
 * user document), and answers where the account stands. Failures are
 * logged and answer null: the app carries on as the rules allow. A deletion
 * that stopped part way is thrown as [AccountDeletionUnfinished].
 */
class ParserAccessCheck(
    private val baseUrl: String,
    private val idToken: suspend () -> String? = { FirebaseAuth.getInstance().currentUser?.getIdToken(false)?.await()?.token },
) : AccessCheck {
    private val client = ParserClient(baseUrl, idToken, readTimeoutMs = TIMEOUT_MS, connectTimeoutMs = TIMEOUT_MS)

    override suspend fun check(): AccountAccess? {
        val endpoint = parserEndpoint(baseUrl, ACCESS_CHECK_PATH) ?: return null
        return try {
            val token = idToken() ?: run {
                TravelmoLog.warning("Checking access skipped: no ID token")
                return null
            }
            val (status, body) = client.postWithToken(endpoint, token, retryOnDrop = true)
            if (isDeletionUnfinished(status, body)) {
                TravelmoLog.warning("Checking access found the account's deletion unfinished")
                throw AccountDeletionUnfinished()
            }
            if (status !in 200..299) {
                TravelmoLog.warning("Checking access failed: HTTP %s", safe(status.toString()))
                return null
            }
            accessCheckAnswer(body).also {
                if (it == null) TravelmoLog.warning("Checking access answered something unreadable") else TravelmoLog.info("Access is %s", safe(it.wire))
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: AccountDeletionUnfinished) {
            throw e
        } catch (e: IOException) {
            TravelmoLog.warning("Checking access failed: the parser could not be reached (%s)", safe(e.javaClass.simpleName))
            null
        } catch (e: Exception) {
            TravelmoLog.failure(e, "Checking access failed")
            null
        }
    }

    private companion object {
        const val TIMEOUT_MS = 15_000
    }
}
