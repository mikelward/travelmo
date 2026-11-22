package app.travelmo.ui

import android.annotation.SuppressLint
import android.content.Context
import androidx.annotation.VisibleForTesting
import androidx.compose.material3.AlertDialog
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import app.travelmo.log.TravelmoLog
import com.mikelward.androidzoom.FontSizeSettings
import com.mikelward.androidzoom.clampFontScale
import com.mikelward.androidzoom.compose.FontSizeState
import com.mikelward.androidzoom.compose.FontSizeWindow
import com.mikelward.androidzoom.compose.pinchFontSizeHost
import com.mikelward.androidzoom.compose.rememberFontSizeState
import java.util.concurrent.Executors
import kotlin.math.roundToInt

/**
 * Travelmo's starting text size: the system's own, so the app looks like the
 * rest of the phone until the user says otherwise. (androidzoom's default is
 * a notch above, for the siblings' short screens.) Only the start: anything
 * stored is read back as it is.
 */
const val DEFAULT_TEXT_SCALE = 1f

/** The settings before anything is chosen: the system's size, pinch on. */
val DEFAULT_TEXT_SIZE = FontSizeSettings(scale = DEFAULT_TEXT_SCALE, pinchEnabled = true)

/**
 * Where the text size is kept: its own SharedPreferences file on this phone,
 * like the debug log's switch. A display preference, not synced: one number
 * and one boolean about how the app draws itself, nothing of the user's.
 * Clamped on read, so a value from a build with a wider range can't size a
 * screen past what this one lays out.
 */
internal class TextSizeStore(context: Context) {
    private val prefs = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    fun read(): FontSizeSettings = FontSizeSettings(
        scale = clampFontScale(prefs.getFloat(KEY_SCALE, DEFAULT_TEXT_SCALE), DEFAULT_TEXT_SCALE),
        pinchEnabled = prefs.getBoolean(KEY_PINCH, true),
    )

    /** False when storage refused the write. */
    // Not KTX's edit { }, which returns nothing: commit()'s answer is what Settings reports.
    @SuppressLint("UseKtx")
    fun write(settings: FontSizeSettings): Boolean =
        prefs.edit().putFloat(KEY_SCALE, settings.scale).putBoolean(KEY_PINCH, settings.pinchEnabled).commit()

    private companion object {
        const val FILE = "text_size"
        const val KEY_SCALE = "scale"
        const val KEY_PINCH = "pinch"
    }
}

/**
 * The text size in force for every screen in the process (SPEC "Text size"):
 * a pinch resizes the app, not the page it happened on, so it lives here
 * rather than on a screen. Compose state, so a change recomposes whatever is
 * on screen.
 *
 * Writes run in order on one background thread, so the newest choice is the
 * one stored; a refused one stays in force until a restart and Settings says
 * it wasn't saved.
 */
internal object TextSizeSetting {
    private val worker = Executors.newSingleThreadExecutor { Thread(it, "travelmo-text-size").apply { isDaemon = true } }

    /** Runs a read or a write in order off the main thread; a test runs them in place. */
    @VisibleForTesting
    internal var dispatch: (Runnable) -> Unit = { worker.execute(it) }

    /** Where the value is kept; a test hands in one whose writes fail. */
    @VisibleForTesting
    internal var storeFor: (Context) -> (FontSizeSettings) -> Boolean = { context -> TextSizeStore(context)::write }

    @VisibleForTesting
    internal var readerFor: (Context) -> () -> FontSizeSettings = { context -> TextSizeStore(context)::read }

    /**
     * What the app is drawn at. The system's size until [warm] has read the
     * stored one, since there is no "not read yet" way to draw text.
     */
    var current: FontSizeSettings by mutableStateOf(DEFAULT_TEXT_SIZE)
        private set

    /** Whether the last write was refused, for Settings to say so. */
    var saveFailed: Boolean by mutableStateOf(false)
        private set

    // Guards [current] and [chosen] between the warm read and a choice made at the same moment.
    private val lock = Any()

    // Whether something was chosen in this process, so a warm read landing late can't undo it.
    private var chosen = false

    /**
     * Reads the stored size into [current], off the main thread, from
     * `Application.onCreate`, so the first frame is normally the user's size;
     * a screen composed before the read lands resizes a frame later rather
     * than waiting on the disk.
     */
    fun warm(context: Context) {
        val read = readerFor(context.applicationContext)
        dispatch {
            val stored = try {
                read()
            } catch (e: RuntimeException) {
                TravelmoLog.failure(e, "Reading the text size failed; using the system's")
                return@dispatch
            }
            synchronized(lock) { if (!chosen) current = stored }
        }
    }

    /** A drag, a pinch or a step settled on [scale]: in force at once, stored in the background. */
    fun setScale(context: Context, scale: Float) = choose(context) { it.copy(scale = clampFontScale(scale, DEFAULT_TEXT_SCALE)) }

    /** The "Pinch to resize" switch. */
    fun setPinchEnabled(context: Context, enabled: Boolean) = choose(context) { it.copy(pinchEnabled = enabled) }

    private fun choose(context: Context, change: (FontSizeSettings) -> FontSizeSettings) {
        val write = storeFor(context.applicationContext)
        val wanted = synchronized(lock) {
            chosen = true
            change(current).also { current = it }
        }
        dispatch {
            val stored = try {
                write(wanted)
            } catch (e: RuntimeException) {
                TravelmoLog.failure(e, "Storing the text size failed")
                false
            }
            if (!stored) TravelmoLog.warning("The text size wasn't stored")
            saveFailed = !stored
        }
    }

    /** Back to before [warm], with writes run in place, for a test. */
    @VisibleForTesting
    internal fun resetForTest() {
        synchronized(lock) {
            current = DEFAULT_TEXT_SIZE
            chosen = false
        }
        saveFailed = false
        dispatch = { it.run() }
        storeFor = { context -> TextSizeStore(context)::write }
        readerFor = { context -> TextSizeStore(context)::read }
    }
}

/**
 * The text size for this composition, wired to [TextSizeSetting]: seeded from
 * memory, never the disk, and written once when a drag or pinch ends.
 */
@Composable
fun rememberAppFontSizeState(): FontSizeState {
    val context = LocalContext.current.applicationContext
    return rememberFontSizeState(
        persisted = TextSizeSetting.current,
        onScaleSettled = { TextSizeSetting.setScale(context, it) },
        onPinchEnabledChange = { TextSizeSetting.setPinchEnabled(context, it) },
        defaultScale = DEFAULT_TEXT_SCALE,
    )
}

/**
 * [scale] moved by [deltaPercent] whole points of the percentage Settings
 * shows, for its − and + buttons: rounded to the shown percent first, so a
 * size a drag left at 115.3% steps to 116%, not 116.3%. Clamped to the range.
 */
internal fun stepTextScale(scale: Float, deltaPercent: Int): Float {
    val percent = (clampFontScale(scale, DEFAULT_TEXT_SCALE) * 100).roundToInt()
    return clampFontScale((percent + deltaPercent) / 100f, DEFAULT_TEXT_SCALE)
}

/**
 * An [AlertDialog] at the chosen text size, answering a pinch. A dialog is a
 * window of its own, which neither the size nor the gesture crosses into, so
 * each slot re-applies the size and the surface hosts the pinch (as stopdash's
 * dialogs do).
 */
@Composable
fun AppAlertDialog(
    onDismissRequest: () -> Unit,
    confirmButton: @Composable () -> Unit,
    modifier: Modifier = Modifier,
    dismissButton: (@Composable () -> Unit)? = null,
    title: (@Composable () -> Unit)? = null,
    text: (@Composable () -> Unit)? = null,
) {
    AlertDialog(
        onDismissRequest = onDismissRequest,
        confirmButton = { FontSizeWindow(confirmButton) },
        modifier = modifier.pinchFontSizeHost(),
        dismissButton = dismissButton?.let { { FontSizeWindow(it) } },
        title = title?.let { { FontSizeWindow(it) } },
        text = text?.let { { FontSizeWindow(it) } },
    )
}
