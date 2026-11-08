package app.travelmo.log

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.BuildConfig
import com.mikelward.androidlog.android.CollectedReport
import com.mikelward.androidlog.android.ShareOutcome
import io.kotest.matchers.booleans.shouldBeFalse
import io.kotest.matchers.booleans.shouldBeTrue
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** The debug log's controls, over the real recorder and sinks that the test application installed. */
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36])
class DebugLoggingTest {
    private val context: Context get() = ApplicationProvider.getApplicationContext()

    @Before
    fun main() = Dispatchers.setMain(UnconfinedTestDispatcher())

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
        val outcome = DebugLogging.share(context, signedIn = true) { _, report ->
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
        val outcome = DebugLogging.share(context, signedIn = false) { _, _ -> throw IllegalStateException("no share sheet") }
        outcome shouldBe ShareOutcome.FAILED
        TravelmoLog.snapshot().joinToString("\n") shouldContain "Delivering the debug report failed"
    }
}
