package app.travelmo.log

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.net.Uri
import android.os.Build
import androidx.core.content.FileProvider
import app.travelmo.BuildConfig
import com.mikelward.androidlog.android.CollectedReport
import com.mikelward.androidlog.android.DebugFileSink
import com.mikelward.androidlog.android.DebugReport
import com.mikelward.androidlog.android.LogcatSink
import com.mikelward.androidlog.android.ProcessExits
import com.mikelward.androidlog.android.ReportScreenshot
import com.mikelward.androidlog.android.ShareOutcome
import com.mikelward.androidlog.safe
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import java.io.File
import java.util.concurrent.Executors

/**
 * Where [TravelmoLog] goes and how it reaches the user: logcat and the
 * library's persisted file on the device, recording on unless Settings
 * turned it off, and a bug report shared from Settings that carries this
 * run and the earlier ones the file kept. After a crash in an earlier run,
 * [unacknowledgedCrash] raises the crash banner until a report lands or the
 * user dismisses it.
 */
object DebugLogging {
    private const val PREFS = "debug_log"
    private const val KEY_ENABLED = "enabled"
    private const val KEY_REPORT_CONSENT_SKIPPED = "report_consent_skipped"

    /** Under the cache, and the only directory the FileProvider serves (`@xml/file_paths`). */
    private const val SCREENSHOT_DIR = "bug-reports"

    @Volatile
    private var sink: DebugFileSink? = null

    private val crashState = MutableStateFlow(false)

    /**
     * Whether an earlier run ended in a crash the user has neither shared nor
     * dismissed: the crash banner's state. The library derives it on its own
     * worker and reports it through a listener; this mirrors it as a flow so
     * every banner reads one answer.
     */
    val unacknowledgedCrash: StateFlow<Boolean> = crashState.asStateFlow()

    /** Call once from `Application.onCreate`; the setting is applied before any sink writes. */
    fun install(context: Context) {
        val app = context.applicationContext
        TravelmoLog.setRecording(isEnabled(app))
        TravelmoLog.addSink(LogcatSink("Travelmo"))
        val fileSink = DebugFileSink(TravelmoLog, app)
        fileSink.start()
        TravelmoLog.addSink(fileSink)
        fileSink.addCrashListener { crashState.value = it }
        sink = fileSink
        TravelmoLog.pinnedEvent("Travelmo %s starting on Android %s", safeVersion(), Build.VERSION.SDK_INT)
        // Why the last processes ended is two binder calls, so it is read off the main thread.
        Executors.newSingleThreadExecutor { Thread(it, "travelmo-process-exits").apply { isDaemon = true } }.execute {
            runCatching { ProcessExits.logRecent(app, TravelmoLog) }
                .onFailure { TravelmoLog.failure(it, "Reading why earlier processes ended failed") }
        }
    }

    /** Re-derives [unacknowledgedCrash] from the files on disk; call it when a banner's screen comes forward. */
    fun refreshCrash() {
        sink?.requestCrashRecompute()
    }

    /** Lowers the crash banner without sharing. The crashed run stays on disk, still shareable from Settings. */
    fun dismissCrash() {
        TravelmoLog.event("Crash banner dismissed")
        sink?.acknowledgeCrashBanner()
    }

    /** Whether Report a bug says what it shares first: until the user ticks "Don't show again". */
    fun reportConsentNeeded(context: Context): Boolean = !prefs(context).getBoolean(KEY_REPORT_CONSENT_SKIPPED, false)

    /** Stops Report a bug asking first; the dialog shows again next time if the choice could not be stored. */
    fun skipReportConsent(context: Context) {
        val stored = prefs(context).edit().putBoolean(KEY_REPORT_CONSENT_SKIPPED, true).commit()
        if (!stored) TravelmoLog.warning("Couldn't store skipping the bug report's consent dialog")
    }

    fun isEnabled(context: Context): Boolean = prefs(context).getBoolean(KEY_ENABLED, true)

    /** Turns recording on or off, which also empties what was collected; false when the choice could not be stored. */
    fun setEnabled(context: Context, enabled: Boolean): Boolean {
        val stored = prefs(context).edit().putBoolean(KEY_ENABLED, enabled).commit()
        TravelmoLog.setRecording(enabled)
        return stored
    }

    /**
     * Builds the report off the main thread and hands it to the share sheet
     * on it (the clipboard copy needs the main thread). The app's own section
     * names the build and the device and nothing of the user's; the lines
     * that follow are the log's, as the floor rendered them.
     *
     * With [screenshot], the screen [context]'s activity shows goes with the
     * text, as a picture (Report a bug, from the screen the bug is on). It is
     * an extra: the text is the whole report either way, and a capture that
     * fails, or a context with no activity, shares the text alone.
     */
    suspend fun share(
        context: Context,
        signedIn: Boolean,
        screenshot: Boolean = false,
        /** The screenshot; a test hands in its own, as there is no window to copy. */
        capture: suspend (Activity) -> Uri? = ::captureScreenshot,
        /** The share sheet and clipboard; a test hands in its own to see the report and to make delivery fail. */
        deliver: (Context, CollectedReport, Uri?) -> ShareOutcome = ::deliverReport,
    ): ShareOutcome {
        val app = context.applicationContext
        // First, while the screen is still the one the report was asked from.
        val shot = if (screenshot) screenshotOf(context, capture) else null
        val report = withContext(Dispatchers.IO) {
            runCatching {
                DebugReport.collect(TravelmoLog, sink) { payload(signedIn) }
            }.getOrElse { failure ->
                TravelmoLog.failure(failure, "Building the debug report failed; sharing a minimal one")
                DebugReport.collect(TravelmoLog, null) { payload(signedIn) }
            }
        }
        return withContext(Dispatchers.Main) {
            runCatching { deliver(app, report, shot) }.getOrElse { failure ->
                TravelmoLog.failure(failure, "Delivering the debug report failed")
                ShareOutcome.FAILED
            }
        }
    }

    /** The screenshot's URI, or null (and why, in the log) for a report that goes as text alone. */
    private suspend fun screenshotOf(context: Context, capture: suspend (Activity) -> Uri?): Uri? {
        val activity = context.findActivity()
        if (activity == null) {
            TravelmoLog.warning("No activity to take the report's screenshot from; sharing text alone")
            return null
        }
        return try {
            capture(activity).also { if (it == null) TravelmoLog.warning("No screenshot for the report; sharing text alone") }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            TravelmoLog.failure(e, "Taking the report's screenshot failed; sharing text alone")
            null
        }
    }

    /**
     * The shared library copies the window to a PNG under the cache (off the
     * main thread: it blocks on the copy, and prunes old ones by age); the
     * app's own FileProvider serves it to the app the user picks.
     */
    private suspend fun captureScreenshot(activity: Activity): Uri? = withContext(Dispatchers.IO) {
        val file = ReportScreenshot.capture(activity, File(activity.cacheDir, SCREENSHOT_DIR), TravelmoLog) ?: return@withContext null
        screenshotUri(file) { FileProvider.getUriForFile(activity, "${activity.packageName}.fileprovider", it) }
    }

    /**
     * A `content://` URI for the screenshot [file] from [mint], or null when
     * minting fails (a provider misconfigured, a path outside it): the report
     * then goes as text, and the PNG nobody can share is deleted.
     * Cancellation is not a failure, and passes through.
     */
    internal fun screenshotUri(file: File, mint: (File) -> Uri): Uri? = try {
        mint(file)
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        TravelmoLog.warning("Couldn't make a URI for the report's screenshot: %s", safe(e.javaClass.simpleName))
        if (!file.delete()) TravelmoLog.warning("Couldn't delete the unshared screenshot; the age-based prune will")
        null
    }

    private fun deliverReport(context: Context, report: CollectedReport, screenshot: Uri?): ShareOutcome = DebugReport.deliver(
        context = context,
        log = TravelmoLog,
        report = report,
        subject = "Travelmo debug log — ${safeVersion()}",
        chooserTitle = "Share the debug log",
        clipboardLabel = "Travelmo debug log",
        screenshot = screenshot,
    )

    private fun payload(signedIn: Boolean): String = buildString {
        appendLine("Travelmo ${safeVersion()} (${BuildConfig.APPLICATION_ID})")
        appendLine("Android ${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT}), ${Build.MANUFACTURER} ${Build.MODEL}")
        appendLine("Signed in: $signedIn")
        appendLine()
        appendLine("--- this run ---")
        for (line in DebugReport.logLines(TravelmoLog)) appendLine(line)
    }

    private fun safeVersion() = "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})"

    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}

/** The activity behind a composition's context, through any wrappers; null for one with none. */
private fun Context.findActivity(): Activity? {
    var context: Context? = this
    while (context is ContextWrapper) {
        if (context is Activity) return context
        context = context.baseContext
    }
    return null
}
