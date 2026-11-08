package app.travelmo.log

import android.content.Context
import android.os.Build
import app.travelmo.BuildConfig
import com.mikelward.androidlog.android.CollectedReport
import com.mikelward.androidlog.android.DebugFileSink
import com.mikelward.androidlog.android.DebugReport
import com.mikelward.androidlog.android.LogcatSink
import com.mikelward.androidlog.android.ProcessExits
import com.mikelward.androidlog.android.ShareOutcome
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.Executors

/**
 * Where [TravelmoLog] goes and how it reaches the user: logcat and the
 * library's persisted file on the device, recording on unless Settings
 * turned it off, and a bug report shared from Settings that carries this
 * run and the earlier ones the file kept.
 */
object DebugLogging {
    private const val PREFS = "debug_log"
    private const val KEY_ENABLED = "enabled"

    @Volatile
    private var sink: DebugFileSink? = null

    /** Call once from `Application.onCreate`; the setting is applied before any sink writes. */
    fun install(context: Context) {
        val app = context.applicationContext
        TravelmoLog.setRecording(isEnabled(app))
        TravelmoLog.addSink(LogcatSink("Travelmo"))
        val fileSink = DebugFileSink(TravelmoLog, app)
        fileSink.start()
        TravelmoLog.addSink(fileSink)
        sink = fileSink
        TravelmoLog.pinnedEvent("Travelmo %s starting on Android %s", safeVersion(), Build.VERSION.SDK_INT)
        // Why the last processes ended is two binder calls, so it is read off the main thread.
        Executors.newSingleThreadExecutor { Thread(it, "travelmo-process-exits").apply { isDaemon = true } }.execute {
            runCatching { ProcessExits.logRecent(app, TravelmoLog) }
                .onFailure { TravelmoLog.failure(it, "Reading why earlier processes ended failed") }
        }
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
     */
    suspend fun share(
        context: Context,
        signedIn: Boolean,
        /** The share sheet and clipboard; a test hands in its own to see the report and to make delivery fail. */
        deliver: (Context, CollectedReport) -> ShareOutcome = ::deliverReport,
    ): ShareOutcome {
        val app = context.applicationContext
        val report = withContext(Dispatchers.IO) {
            runCatching {
                DebugReport.collect(TravelmoLog, sink) { payload(signedIn) }
            }.getOrElse { failure ->
                TravelmoLog.failure(failure, "Building the debug report failed; sharing a minimal one")
                DebugReport.collect(TravelmoLog, null) { payload(signedIn) }
            }
        }
        return withContext(Dispatchers.Main) {
            runCatching { deliver(app, report) }.getOrElse { failure ->
                TravelmoLog.failure(failure, "Delivering the debug report failed")
                ShareOutcome.FAILED
            }
        }
    }

    private fun deliverReport(context: Context, report: CollectedReport): ShareOutcome = DebugReport.deliver(
        context = context,
        log = TravelmoLog,
        report = report,
        subject = "Travelmo debug log — ${safeVersion()}",
        chooserTitle = "Share the debug log",
        clipboardLabel = "Travelmo debug log",
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
