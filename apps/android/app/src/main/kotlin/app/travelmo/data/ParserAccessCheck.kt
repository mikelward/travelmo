package app.travelmo.data

import app.travelmo.core.ACCESS_CHECK_PATH
import app.travelmo.core.AccountAccess
import app.travelmo.core.accessCheckAnswer
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

/**
 * `POST /access/check` on the parser, with the user's Firebase ID token as
 * [ParserAccountDeletion] sends it. It lets in an account from before
 * approvals that the rules cannot tell is one (an Android-only owner has no
 * user document), and answers where the account stands. Failures are
 * logged and answer null: the app carries on as the rules allow.
 */
class ParserAccessCheck(
    private val baseUrl: String,
    private val idToken: suspend () -> String? = { FirebaseAuth.getInstance().currentUser?.getIdToken(false)?.await()?.token },
) : AccessCheck {
    override suspend fun check(): AccountAccess? {
        val endpoint = parserEndpoint(baseUrl, ACCESS_CHECK_PATH) ?: return null
        return try {
            val token = idToken() ?: run {
                TravelmoLog.warning("Checking access skipped: no ID token")
                return null
            }
            val (status, body) = post(endpoint, token)
            if (status !in 200..299) {
                TravelmoLog.warning("Checking access failed: HTTP %s", safe(status.toString()))
                return null
            }
            accessCheckAnswer(body).also {
                if (it == null) TravelmoLog.warning("Checking access answered something unreadable") else TravelmoLog.info("Access is %s", safe(it.wire))
            }
        } catch (e: CancellationException) {
            throw e
        } catch (e: IOException) {
            TravelmoLog.warning("Checking access failed: the parser could not be reached (%s)", safe(e.javaClass.simpleName))
            null
        } catch (e: Exception) {
            TravelmoLog.failure(e, "Checking access failed")
            null
        }
    }

    private suspend fun post(endpoint: String, token: String): Pair<Int, String> = withContext(Dispatchers.IO) {
        val connection = URL(endpoint).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = TIMEOUT_MS
            connection.readTimeout = TIMEOUT_MS
            connection.doOutput = true
            connection.setRequestProperty("Authorization", "Bearer $token")
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write("{}".toByteArray()) }
            val status = connection.responseCode
            val body = if (status in 200..299) connection.inputStream.bufferedReader().use { it.readText() } else ""
            status to body
        } finally {
            connection.disconnect()
        }
    }

    private companion object {
        const val TIMEOUT_MS = 15_000
    }
}
