package app.travelmo.log

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.ComponentActivity
import androidx.core.content.FileProvider
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.BuildConfig
import com.mikelward.androidlog.android.CollectedReport
import com.mikelward.androidlog.android.ShareOutcome
import io.kotest.matchers.booleans.shouldBeFalse
import io.kotest.matchers.booleans.shouldBeTrue
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.nulls.shouldNotBeNull
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.io.File

/** The debug log's controls, over the real recorder and sinks that the test application installed. */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36])
class DebugLoggingTest {
    private val context: Context get() = ApplicationProvider.getApplicationContext()

    @Before
    fun main() = Dispatchers.setMain(UnconfinedTestDispatcher())

    // FileProvider keeps each authority's roots in a static cache, which
    // would hold the first test's data directory; Robolectric gives each
    // test a new one, so the cache is emptied first.
    @Before
    fun forgetFileProviderRoots() {
        val cache = FileProvider::class.java.getDeclaredField("sCache").apply { isAccessible = true }
        synchronized(cache.get(null)!!) { (cache.get(null) as MutableMap<*, *>).clear() }
    }

    @After
    fun reset() {
        Dispatchers.resetMain()
        DebugLogging.setEnabled(context, true)
    }

    @Test
    fun `the recording choice is stored, applied to the log, and read back`() {
        DebugLogging.isEnabled(context).shouldBeTrue()
        DebugLogging.setEnabled(context, false).shouldBeTrue()
        DebugLogging.isEnabled(context).shouldBeFalse()
        TravelmoLog.isRecording.shouldBeFalse()
        // Off empties what was collected: a line recorded while off is not kept.
        TravelmoLog.event("recorded while off")
        TravelmoLog.snapshot().joinToString("\n") shouldNotContain "recorded while off"
        DebugLogging.setEnabled(context, true).shouldBeTrue()
        DebugLogging.isEnabled(context).shouldBeTrue()
        TravelmoLog.isRecording.shouldBeTrue()
    }

    @Test
    fun `a share delivers a report naming the build and carrying this run's lines`() = runBlocking<Unit> {
        TravelmoLog.event("share test marker %s", 42)
        var delivered: CollectedReport? = null
        val outcome = DebugLogging.share(context, signedIn = true) { _, report, _ ->
            delivered = report
            ShareOutcome.SHARED
        }
        outcome shouldBe ShareOutcome.SHARED
        val text = delivered!!.text
        text shouldContain "Travelmo ${BuildConfig.VERSION_NAME}"
        text shouldContain "Signed in: true"
        text shouldContain "share test marker 42"
    }

    @Test
    fun `a delivery that throws is a failed share, and the failure is logged`() = runBlocking<Unit> {
        val outcome = DebugLogging.share(context, signedIn = false) { _, _, _ -> throw IllegalStateException("no share sheet") }
        outcome shouldBe ShareOutcome.FAILED
        TravelmoLog.snapshot().joinToString("\n") shouldContain "Delivering the debug report failed"
    }

    // The screenshot (Report a bug): an extra beside a complete text report.

    private val shot: Uri = Uri.parse("content://app.travelmo.test/screenshot.png")

    private fun activity(): ComponentActivity = Robolectric.buildActivity(ComponentActivity::class.java).setup().get()

    private class Delivery {
        var report: CollectedReport? = null
        var screenshot: Uri? = null
        val deliver: (Context, CollectedReport, Uri?) -> ShareOutcome = { _, report, screenshot ->
            this.report = report
            this.screenshot = screenshot
            ShareOutcome.SHARED
        }
    }

    @Test
    fun `report a bug attaches the screenshot of its activity beside the whole text`() = runBlocking<Unit> {
        val delivery = Delivery()
        var capturedFrom: Any? = null
        val activity = activity()
        DebugLogging.share(activity, signedIn = true, screenshot = true, capture = { capturedFrom = it; shot }, deliver = delivery.deliver)
        capturedFrom shouldBe activity
        delivery.screenshot shouldBe shot
        delivery.report!!.text shouldContain "Signed in: true"
    }

    @Test
    fun `a share without a screenshot takes none`() = runBlocking<Unit> {
        val delivery = Delivery()
        var captures = 0
        DebugLogging.share(activity(), signedIn = true, capture = { captures++; shot }, deliver = delivery.deliver)
        captures shouldBe 0
        delivery.screenshot.shouldBeNull()
    }

    @Test
    fun `a capture that comes back empty shares the text alone and says why`() = runBlocking<Unit> {
        val delivery = Delivery()
        val outcome = DebugLogging.share(activity(), signedIn = true, screenshot = true, capture = { null }, deliver = delivery.deliver)
        outcome shouldBe ShareOutcome.SHARED
        delivery.screenshot.shouldBeNull()
        delivery.report!!.text shouldContain "Signed in: true"
        TravelmoLog.snapshot().joinToString("\n") shouldContain "No screenshot for the report; sharing text alone"
    }

    @Test
    fun `a capture that throws shares the text alone and logs the failure`() = runBlocking<Unit> {
        val delivery = Delivery()
        val outcome = DebugLogging.share(activity(), signedIn = true, screenshot = true, capture = { throw IllegalStateException("no window") }, deliver = delivery.deliver)
        outcome shouldBe ShareOutcome.SHARED
        delivery.screenshot.shouldBeNull()
        delivery.report.shouldNotBeNull()
        TravelmoLog.snapshot().joinToString("\n") shouldContain "Taking the report's screenshot failed"
    }

    @Test
    fun `a context with no activity shares the text alone`() = runBlocking<Unit> {
        val delivery = Delivery()
        var captures = 0
        DebugLogging.share(context, signedIn = false, screenshot = true, capture = { captures++; shot }, deliver = delivery.deliver)
        captures shouldBe 0
        delivery.screenshot.shouldBeNull()
        delivery.report.shouldNotBeNull()
        TravelmoLog.snapshot().joinToString("\n") shouldContain "No activity to take the report's screenshot from"
    }

    // The app's FileProvider (manifest and @xml/file_paths) and its guard.

    private fun screenshotFile(dir: File) = File(dir, "screenshot-1.png").apply {
        parentFile!!.mkdirs()
        writeBytes(byteArrayOf(1))
    }

    private fun mint(file: File): Uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)

    @Test
    fun `the provider serves a screenshot from the bug-reports directory`() {
        val file = screenshotFile(File(context.cacheDir, "bug-reports"))
        val uri = DebugLogging.screenshotUri(file, ::mint).shouldNotBeNull()
        uri.scheme shouldBe "content"
        uri.authority shouldBe "${context.packageName}.fileprovider"
        file.exists().shouldBeTrue()
    }

    @Test
    fun `a screenshot elsewhere in the cache gets no URI and is deleted`() {
        val file = screenshotFile(File(context.cacheDir, "elsewhere"))
        DebugLogging.screenshotUri(file, ::mint).shouldBeNull()
        file.exists().shouldBeFalse()
        TravelmoLog.snapshot().joinToString("\n") shouldContain "Couldn't make a URI for the report's screenshot"
    }

    @Test
    fun `cancellation while minting passes through`() {
        val file = screenshotFile(File(context.cacheDir, "bug-reports"))
        assertThrows(CancellationException::class.java) {
            DebugLogging.screenshotUri(file) { throw CancellationException("cancelled") }
        }
    }

    @Test
    fun `the share sheet gets the screenshot with a read grant`() = runBlocking<Unit> {
        val file = screenshotFile(File(context.cacheDir, "bug-reports"))
        val uri = mint(file)
        DebugLogging.share(activity(), signedIn = true, screenshot = true, capture = { uri })
        val chooser = shadowOf(context as android.app.Application).nextStartedActivity.shouldNotBeNull()
        chooser.action shouldBe Intent.ACTION_CHOOSER
        val send = chooser.getParcelableExtra(Intent.EXTRA_INTENT, Intent::class.java).shouldNotBeNull()
        send.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java) shouldBe uri
        send.type shouldBe "image/png"
        (send.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0).shouldBeTrue()
        send.getStringExtra(Intent.EXTRA_TEXT).shouldNotBeNull() shouldContain "Signed in: true"
    }
}
