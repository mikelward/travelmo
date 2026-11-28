package app.travelmo.data

import app.travelmo.core.parserEndpoint
import app.travelmo.core.tripActionFailure
import app.travelmo.log.TravelmoLog
import com.mikelward.androidlog.safe
import java.io.EOFException
import java.io.IOException
import java.net.BindException
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.NoRouteToHostException
import java.net.SocketException
import java.net.URL
import javax.net.ssl.SSLException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import com.google.firebase.auth.FirebaseAuth

/** A parser reply: its status, and its body when it sent one. */
data class ParserReply(val status: Int, val body: String)

/**
 * Posts JSON to the parser (apps/parser) with the signed-in user's Firebase
 * ID token, as the web's api.ts sends them. Null from [post] when this build has
 * no parser address or nobody is signed in; an IOException when the parser
 * can't be reached.
 */
class ParserClient(
    private val baseUrl: String,
    private val idToken: suspend () -> String? = { FirebaseAuth.getInstance().currentUser?.getIdToken(false)?.await()?.token },
    private val readTimeoutMs: Int = 120_000,
    private val connectTimeoutMs: Int = 15_000,
) {
    /** Whether this build has a parser to post to. */
    val available: Boolean
        get() = parserEndpoint(baseUrl, "/") != null

    /**
     * Posts [json] to [path] on a fresh connection (`Connection: close`) so
     * Android's `HttpURLConnection` pool does not reuse an idle socket the
     * network or proxy has already dropped. When [retryOnDrop] is true
     * (idempotent actions), a connection aborted or closed mid-flight is tried
     * once more on a new socket.
     */
    suspend fun post(path: String, json: String = "{}", retryOnDrop: Boolean = false): ParserReply? {
        val endpoint = parserEndpoint(baseUrl, path) ?: return null
        val token = idToken() ?: return null
        return postWithToken(endpoint, token, json, retryOnDrop)
    }

    internal suspend fun postWithToken(
        endpoint: String,
        token: String,
        json: String = "{}",
        retryOnDrop: Boolean = false,
    ): ParserReply = withContext(Dispatchers.IO) {
        try {
            send(endpoint, token, json)
        } catch (e: IOException) {
            if (!retryOnDrop || !isDroppedConnection(e)) throw e
            TravelmoLog.warning("Parser connection dropped (%s); retrying once", safe(e.javaClass.simpleName))
            send(endpoint, token, json)
        }
    }

    private fun send(endpoint: String, token: String, json: String): ParserReply {
        val connection = URL(endpoint).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = connectTimeoutMs
            connection.readTimeout = readTimeoutMs
            connection.doOutput = true
            connection.setRequestProperty("Authorization", "Bearer $token")
            connection.setRequestProperty("Content-Type", "application/json")
            // Android's HttpURLConnection pools idle sockets for minutes; after
            // a network switch, NAT timeout or proxy close, reusing one fails
            // with Software caused connection abort.
            connection.setRequestProperty("Connection", "close")
            val bytes = json.toByteArray()
            connection.setFixedLengthStreamingMode(bytes.size)
            connection.outputStream.use { it.write(bytes) }
            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            return ParserReply(status, stream?.bufferedReader()?.use { it.readText() }.orEmpty())
        } finally {
            connection.disconnect()
        }
    }
}

private fun isDroppedConnection(e: Throwable): Boolean = when (e) {
    is ConnectException, is NoRouteToHostException, is BindException -> false
    is SocketException, is EOFException -> true
    is SSLException -> e.cause?.let(::isDroppedConnection) ?: false
    else -> false
}

/**
 * Posts [json] to [path] for a Settings action and returns the reply's body,
 * or throws [TripActionFailed] with what to tell the user: the parser's own
 * words for a status in [explained] (a refusal it phrases for people), else
 * the usual failure. [what] is fixed wording for the log, never the body,
 * which may hold an address or a private link.
 */
suspend fun ParserClient.postAction(path: String, what: String, json: String = "{}", explained: Set<Int> = emptySet()): String {
    TravelmoLog.info("%s", safe(what))
    val reply = try {
        post(path, json) ?: throw TripActionFailed(tripActionFailure(401))
    } catch (e: CancellationException) {
        throw e
    } catch (e: IOException) {
        TravelmoLog.failure(e, "$what failed: the parser could not be reached")
        throw TripActionFailed(tripActionFailure(null), e)
    }
    if (reply.status !in 200..299) {
        TravelmoLog.warning("%s failed: HTTP %s", safe(what), safe(reply.status.toString()))
        val reason = reply.body.trim().takeIf { reply.status in explained && it.isNotEmpty() && it.length < 200 }
        throw TripActionFailed(reason?.let { if (it.endsWith(".")) it else "$it." } ?: tripActionFailure(reply.status))
    }
    TravelmoLog.info("%s done", safe(what))
    return reply.body
}
