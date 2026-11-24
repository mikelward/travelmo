package app.travelmo.data

import app.travelmo.core.FLIGHTS_REFRESH_PATH
import app.travelmo.core.parserEndpoint
import app.travelmo.log.TravelmoLog
import com.google.firebase.auth.FirebaseAuth
import com.mikelward.androidlog.safe
import com.mikelward.androidlog.sensitive
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * `POST /flights/refresh` on the parser (apps/parser), as the web's api.ts
 * sends it. The parser decides which flights are due, at most once a
 * minute each, so asking more often costs nothing.
 */
class ParserFlightRefresh(
    private val baseUrl: String,
    private val idToken: suspend () -> String? = { FirebaseAuth.getInstance().currentUser?.getIdToken(false)?.await()?.token },
) : FlightRefresh {
    override suspend fun refresh(tripId: String) {
        val endpoint = parserEndpoint(baseUrl, FLIGHTS_REFRESH_PATH) ?: return
        try {
            val token = idToken() ?: return
            val status = post(endpoint, token, JSONObject().put("tripId", tripId).toString())
            if (status !in 200..299) TravelmoLog.warning("Refreshing the flights of trip %s failed: HTTP %s", sensitive(tripId), safe(status.toString()))
        } catch (e: CancellationException) {
            throw e
        } catch (e: IOException) {
            TravelmoLog.warning("Refreshing the flights of trip %s failed: %s", sensitive(tripId), safe(e.javaClass.simpleName))
        } catch (e: Exception) {
            TravelmoLog.failure(e, "Refreshing the flights of a trip failed")
        }
    }

    private suspend fun post(endpoint: String, token: String, body: String): Int = withContext(Dispatchers.IO) {
        val connection = URL(endpoint).openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = TIMEOUT_MS
            connection.readTimeout = TIMEOUT_MS
            connection.doOutput = true
            connection.setRequestProperty("Authorization", "Bearer $token")
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(body.toByteArray()) }
            connection.responseCode
        } finally {
            connection.disconnect()
        }
    }

    private companion object {
        const val TIMEOUT_MS = 15_000
    }
}
