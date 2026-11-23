package app.travelmo.data

import app.travelmo.core.parserEndpoint
import com.google.firebase.auth.FirebaseAuth
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext

/** A parser reply: its status, and its body when it sent one. */
data class ParserReply(val status: Int, val body: String)

/**
 * Posts JSON to the parser (apps/parser) with the signed-in user's Firebase
 * ID token, as the web's api.ts does. Null from [post] when this build has
 * no parser address or nobody is signed in; an IOException when the parser
 * can't be reached.
 */
class ParserClient(
    private val baseUrl: String,
    private val idToken: suspend () -> String? = { FirebaseAuth.getInstance().currentUser?.getIdToken(false)?.await()?.token },
    private val readTimeoutMs: Int = 120_000,
) {
    /** Whether this build has a parser to post to. */
    val available: Boolean
        get() = parserEndpoint(baseUrl, "/") != null

    suspend fun post(path: String, json: String = "{}"): ParserReply? {
        val endpoint = parserEndpoint(baseUrl, path) ?: return null
        val token = idToken() ?: return null
        return withContext(Dispatchers.IO) {
            val connection = URL(endpoint).openConnection() as HttpURLConnection
            try {
                connection.requestMethod = "POST"
                connection.connectTimeout = 15_000
                connection.readTimeout = readTimeoutMs
                connection.doOutput = true
                connection.setRequestProperty("Authorization", "Bearer $token")
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(json.toByteArray()) }
                val status = connection.responseCode
                val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                ParserReply(status, stream?.bufferedReader()?.use { it.readText() }.orEmpty())
            } finally {
                connection.disconnect()
            }
        }
    }
}
