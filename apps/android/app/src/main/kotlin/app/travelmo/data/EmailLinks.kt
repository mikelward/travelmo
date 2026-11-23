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

private const val CHANGE_ON_WEB = "Change your email addresses from Settings on the web."
private const val TRY_AGAIN = "Couldn't reach Travelmo. Try again."

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
