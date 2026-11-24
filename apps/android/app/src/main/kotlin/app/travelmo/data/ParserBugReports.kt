package app.travelmo.data

import app.travelmo.core.BUG_REPORT_PATH
import app.travelmo.core.Place
import app.travelmo.core.Segment
import app.travelmo.core.TripWithSegments
import app.travelmo.core.bugReportFailure
import app.travelmo.log.TravelmoLog
import com.mikelward.androidlog.safe
import java.io.IOException
import java.util.Base64
import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject

/**
 * A bug report on its way to Travelmo (SPEC "Bug reports"): what the user
 * wrote (maybe nothing), the screen it was sent from, the build, the debug
 * log, the screenshot, and on a trip's screens that trip with every booking.
 */
class OutgoingBugReport(
    val text: String,
    val page: String,
    val version: String,
    val log: String,
    val screenshot: ByteArray?,
    val trip: TripWithSegments?,
)

/** `POST /reports` on the parser, which emails the report to the maintainer. */
class ParserBugReports(private val client: ParserClient) {
    /** False on a build with no parser address. */
    val available: Boolean
        get() = client.available

    /** Sends [report]; throws [TripActionFailed] with what to tell the user. Logs sizes only, never the report. */
    suspend fun send(report: OutgoingBugReport) {
        TravelmoLog.info(
            "Sending a bug report: %s characters written, %s of log, screenshot %s, %s bookings",
            report.text.length,
            report.log.length,
            report.screenshot != null,
            report.trip?.segments?.size ?: 0,
        )
        val reply = try {
            client.post(BUG_REPORT_PATH, bugReportJson(report)) ?: throw TripActionFailed(bugReportFailure(401))
        } catch (e: CancellationException) {
            throw e
        } catch (e: IOException) {
            TravelmoLog.failure(e, "Sending the bug report failed: the parser could not be reached")
            throw TripActionFailed(bugReportFailure(null), e)
        }
        if (reply.status !in 200..299) {
            TravelmoLog.warning("Sending the bug report failed: HTTP %s", safe(reply.status.toString()))
            throw TripActionFailed(bugReportFailure(reply.status))
        }
        TravelmoLog.info("Sent the bug report")
    }
}

/** The request body, as packages/core's checkBugReport reads it. */
internal fun bugReportJson(report: OutgoingBugReport): String = JSONObject().apply {
    put("text", report.text)
    put("page", report.page)
    put("app", "android")
    put("version", report.version)
    put("log", report.log)
    report.screenshot?.let { put("screenshot", Base64.getEncoder().encodeToString(it)) }
    report.trip?.let { (trip, segments) ->
        put(
            "trip",
            JSONObject()
                .put("id", trip.id)
                .put("title", trip.title)
                .put("bookings", JSONArray(segments.map(::bookingJson))),
        )
    }
}.toString()

/** A booking as the trip screen has it, each place in full. */
private fun bookingJson(segment: Segment): JSONObject = JSONObject().apply {
    put("id", segment.id)
    put("tripId", segment.tripId)
    put("type", segment.type.wire)
    put("title", segment.title)
    put("start", segment.start)
    putOpt("end", segment.end)
    putOpt("provider", segment.provider)
    putOpt("confirmation", segment.confirmation)
    segment.origin?.let { put("origin", placeJson(it)) }
    segment.destination?.let { put("destination", placeJson(it)) }
    putOpt("notes", segment.notes)
    putOpt("sender", segment.sender)
    putOpt("rating", segment.rating)
    if (segment.favorite) put("favorite", true)
    if (segment.sources.isNotEmpty()) {
        put(
            "sources",
            JSONArray(
                segment.sources.map { source ->
                    JSONObject().put("kind", source.kind.wire).put("id", source.id).putOpt("label", source.label).putOpt("uid", source.uid).put("at", source.at)
                },
            ),
        )
    }
    putOpt("cancelledAt", segment.cancelledAt)
    putOpt("cancelledBy", segment.cancelledBy)
}

private fun placeJson(place: Place): JSONObject = JSONObject().apply {
    put("name", place.name)
    putOpt("code", place.code)
    putOpt("city", place.city)
    putOpt("country", place.country)
    putOpt("address", place.address)
    putOpt("lat", place.lat)
    putOpt("lon", place.lon)
}
