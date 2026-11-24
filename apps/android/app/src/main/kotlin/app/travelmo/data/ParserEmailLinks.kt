package app.travelmo.data

import app.travelmo.core.ADD_EMAIL_PATH
import app.travelmo.core.REMOVE_EMAIL_PATH
import app.travelmo.core.parserEndpoint
import app.travelmo.core.refusalOf
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
import org.json.JSONObject

/** `POST /emails/add` and `/emails/remove` on the parser, with the user's Firebase ID token, as the web's api.ts sends them. */
class ParserEmailLinks(
    private val baseUrl: String,
    private val idToken: suspend () -> String? = { FirebaseAuth.getInstance().currentUser?.getIdToken(false)?.await()?.token },
) : EmailLinks {
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
            post(endpoint, token, JSONObject().put("email", email).toString())
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

    private suspend fun post(endpoint: String, token: String, json: String): Pair<Int, String> = withContext(Dispatchers.IO) {
        val connection = URL(endpoint).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = TIMEOUT_MS
            connection.readTimeout = TIMEOUT_MS
            connection.doOutput = true
            connection.setRequestProperty("Authorization", "Bearer $token")
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(json.toByteArray()) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            status to (stream?.bufferedReader()?.use { it.readText() } ?: "")
        } finally {
            connection.disconnect()
        }
    }

    private companion object {
        const val TIMEOUT_MS = 30_000
    }
}
