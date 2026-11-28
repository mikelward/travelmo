package app.travelmo.data

import app.travelmo.core.ADD_EMAIL_PATH
import app.travelmo.core.REMOVE_EMAIL_PATH
import app.travelmo.core.parserEndpoint
import app.travelmo.core.refusalOf
import app.travelmo.log.TravelmoLog
import com.google.firebase.auth.FirebaseAuth
import com.mikelward.androidlog.safe
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.tasks.await
import org.json.JSONObject

/** `POST /emails/add` and `/emails/remove` on the parser, with the user's Firebase ID token, as the web's api.ts sends them. */
class ParserEmailLinks(
    private val baseUrl: String,
    private val idToken: suspend () -> String? = { FirebaseAuth.getInstance().currentUser?.getIdToken(false)?.await()?.token },
) : EmailLinks {
    private val client = ParserClient(baseUrl, idToken, readTimeoutMs = TIMEOUT_MS, connectTimeoutMs = TIMEOUT_MS)

    override val available: Boolean
        get() = parserEndpoint(baseUrl, ADD_EMAIL_PATH) != null

    override suspend fun add(email: String) = call(ADD_EMAIL_PATH, "Adding an email address", email)

    override suspend fun remove(email: String) = call(REMOVE_EMAIL_PATH, "Removing an email address", email)

    private suspend fun call(path: String, what: String, email: String) {
        val endpoint = parserEndpoint(baseUrl, path) ?: throw EmailLinkFailed(CHANGE_ON_WEB)
        val token = try {
            idToken()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            TravelmoLog.failure(e, "%s failed: no ID token", safe(what))
            throw EmailLinkFailed(TRY_AGAIN, e)
        } ?: throw EmailLinkFailed(TRY_AGAIN)
        val (status, body) = try {
            client.postWithToken(endpoint, token, JSONObject().put("email", email).toString())
        } catch (e: IOException) {
            TravelmoLog.failure(e, "%s failed: the parser could not be reached", safe(what))
            throw EmailLinkFailed(TRY_AGAIN, e)
        }
        if (status !in 200..299) {
            val refusal = refusalOf(body)
            TravelmoLog.warning("%s failed: HTTP %s %s", safe(what), safe(status.toString()), safe(refusal?.wire ?: "-"))
            throw EmailLinkFailed(refusal?.text ?: TRY_AGAIN)
        }
        TravelmoLog.info("%s done", safe(what))
    }

    private companion object {
        const val TIMEOUT_MS = 30_000
    }
}
