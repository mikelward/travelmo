package app.travelmo.ui

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.core.Place
import app.travelmo.core.Segment
import app.travelmo.core.SegmentType
import app.travelmo.core.SourceKind
import app.travelmo.core.SourceRef
import app.travelmo.core.Trip
import app.travelmo.core.TripWithSegments
import app.travelmo.data.OutgoingBugReport
import app.travelmo.data.TripActionFailed
import app.travelmo.data.bugReportJson
import app.travelmo.log.ReportForSending
import io.kotest.matchers.shouldBe
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import java.util.Base64

/** Sending a bug report: the dialog's states, what the app's sender puts together, and the body the parser gets. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36])
class BugReportTest {
    private val context: Context get() = ApplicationProvider.getApplicationContext()

    @Test
    fun `a sent report says so and can't go twice`() = runTest {
        val sent = mutableListOf<String>()
        val form = BugReportForm { sent += it }
        form.state.value shouldBe SendState.Idle
        form.send("  The map is blank \n")
        form.state.value shouldBe SendState.Sent
        form.send("Again")
        sent shouldBe listOf("The map is blank")
    }

    @Test
    fun `a refusal says why and send tries again`() = runTest {
        var refuse = true
        val form = BugReportForm { if (refuse) throw TripActionFailed("You've sent the most reports for today. Try again tomorrow.") }
        form.send("")
        form.state.value shouldBe SendState.Failed("You've sent the most reports for today. Try again tomorrow.")
        refuse = false
        form.send("")
        form.state.value shouldBe SendState.Sent
    }

    @Test
    fun `an unexpected failure is put in plain words`() = runTest {
        val form = BugReportForm { throw IllegalStateException("socket closed") }
        form.send("x")
        form.state.value shouldBe SendState.Failed("Couldn't reach Travelmo. Check your connection and try again.")
    }

    @Test
    fun `one send at a time`() = runTest {
        val release = CompletableDeferred<Unit>()
        var sends = 0
        val form = BugReportForm { sends++; release.await() }
        val first = launch { form.send("x") }
        testScheduler.runCurrent()
        form.state.value shouldBe SendState.Sending
        form.send("x")
        release.complete(Unit)
        first.join()
        sends shouldBe 1
        form.state.value shouldBe SendState.Sent
    }

    private val trip = Trip("liverpool", "Liverpool", "2027-01-08", "2027-01-10", "owner")
    private val stay = Segment(
        id = "s1",
        tripId = "liverpool",
        type = SegmentType.LODGING,
        title = "Cove Paradise Street",
        start = "2027-01-08T15:00:00+00:00",
        end = "2027-01-10T11:00:00+00:00",
        confirmation = "CV123",
        destination = Place("Cove Paradise Street", city = "Liverpool", country = "GB", address = "39 Paradise Street, Liverpool L1 3ED", lat = 53.4, lon = -2.98),
        notes = "Late check-in",
        sources = listOf(SourceRef(SourceKind.GMAIL, "m1", "Your stay", at = "2026-11-01T10:00:00Z")),
        cancelledAt = "2026-12-01T10:00:00Z",
    )

    @Test
    fun `the sender sends what was written with the log and screenshot and the screen's trip`() = runTest {
        var delivered: OutgoingBugReport? = null
        val sender = CollectingBugReportSender(
            version = "1.0 (40)",
            collect = { ReportForSending("Travelmo 1.0 (40)\nline", byteArrayOf(1, 2, 3)) },
            deliver = { delivered = it },
        )
        sender.send(context, "Wrong city", ReportScreen("Trip") { TripWithSegments(trip, listOf(stay)) })
        val report = delivered!!
        report.text shouldBe "Wrong city"
        report.page shouldBe "Trip"
        report.version shouldBe "1.0 (40)"
        report.log shouldBe "Travelmo 1.0 (40)\nline"
        report.screenshot!!.toList() shouldBe listOf<Byte>(1, 2, 3)
        report.trip shouldBe TripWithSegments(trip, listOf(stay))
    }

    @Test
    fun `off a trip's screens no bookings go`() = runTest {
        var delivered: OutgoingBugReport? = null
        val sender = CollectingBugReportSender("1.0 (40)", { ReportForSending("log", null) }, { delivered = it })
        sender.send(context, "", ReportScreen("Settings"))
        delivered!!.trip shouldBe null
        delivered!!.screenshot shouldBe null
    }

    @Test
    fun `a trip that never loads leaves the report without it`() = runTest {
        var delivered: OutgoingBugReport? = null
        val sender = CollectingBugReportSender("1.0 (40)", { ReportForSending("log", null) }, { delivered = it }, tripWaitMs = 1_000)
        sender.send(context, "x", ReportScreen("Trip") { awaitCancellation() })
        delivered!!.page shouldBe "Trip"
        delivered!!.trip shouldBe null
    }

    @Test
    fun `the body carries every booking with its places in full`() {
        val json = JSONObject(
            bugReportJson(OutgoingBugReport("Wrong city", "Trip", "1.0 (40)", "log", byteArrayOf(1, 2, 3), TripWithSegments(trip, listOf(stay)))),
        )
        json.getString("text") shouldBe "Wrong city"
        json.getString("page") shouldBe "Trip"
        json.getString("app") shouldBe "android"
        json.getString("version") shouldBe "1.0 (40)"
        json.getString("log") shouldBe "log"
        Base64.getDecoder().decode(json.getString("screenshot")).toList() shouldBe listOf<Byte>(1, 2, 3)
        val sent = json.getJSONObject("trip")
        sent.getString("id") shouldBe "liverpool"
        sent.getString("title") shouldBe "Liverpool"
        val booking = sent.getJSONArray("bookings").getJSONObject(0)
        booking.getString("type") shouldBe "lodging"
        booking.getString("confirmation") shouldBe "CV123"
        booking.getString("cancelledAt") shouldBe "2026-12-01T10:00:00Z"
        booking.getJSONArray("sources").getJSONObject(0).getString("label") shouldBe "Your stay"
        val place = booking.getJSONObject("destination")
        place.getString("name") shouldBe "Cove Paradise Street"
        place.getString("address") shouldBe "39 Paradise Street, Liverpool L1 3ED"
        place.getString("city") shouldBe "Liverpool"
        place.getString("country") shouldBe "GB"
        place.getDouble("lat") shouldBe 53.4
        place.getDouble("lon") shouldBe -2.98
        booking.has("origin") shouldBe false
    }

    @Test
    fun `a report with no screenshot or trip sends neither`() {
        val json = JSONObject(bugReportJson(OutgoingBugReport("", "Trips", "1.0 (40)", "log", null, null)))
        json.has("screenshot") shouldBe false
        json.has("trip") shouldBe false
        json.getString("text") shouldBe ""
    }
}
