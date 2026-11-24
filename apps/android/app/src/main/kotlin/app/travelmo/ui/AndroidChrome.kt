package app.travelmo.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import app.travelmo.BuildConfig
import app.travelmo.log.TravelmoLog
import com.mikelward.androidlog.safe
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Android's pieces of the shared screens (AppChrome): the ⋮ menu with
 * Report a bug, About, Access and the update dot; the crash report banner;
 * links opened through an Intent, with a toast when no app takes one; the
 * clipboard; and files saved through the system's file picker.
 */
class AndroidChrome(private val context: Context) : AppChrome {
    @Composable
    override fun Menu(modifier: Modifier, items: @Composable (close: () -> Unit) -> Unit) = AndroidAppMenu(modifier, items)

    @Composable
    override fun crashPending(): Boolean = androidCrashPending()

    @Composable
    override fun CrashBanner(modifier: Modifier) = AndroidLastCrashBanner(modifier)

    override fun openLink(url: String, what: String) = openLink(context, url, what)

    override fun openGmailSearch(search: String, url: String) = openGmailSearch(context, search, url)

    override fun copyToClipboard(label: String, text: String) {
        val clipboard = context.getSystemService(ClipboardManager::class.java)
        if (clipboard == null) {
            TravelmoLog.warning("No clipboard to copy to")
            return
        }
        clipboard.setPrimaryClip(ClipData.newPlainText(label, text))
    }

    @Composable
    override fun rememberTextSaver(mimeType: String, text: () -> String, onSaved: (Boolean) -> Unit): (suggestedName: String) -> Unit {
        val scope = rememberCoroutineScope()
        val currentText = rememberUpdatedState(text)
        val currentOnSaved = rememberUpdatedState(onSaved)
        val launcher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument(mimeType)) { uri ->
            if (uri == null) return@rememberLauncherForActivityResult
            val body = currentText.value()
            scope.launch {
                val saved = try {
                    withContext(Dispatchers.IO) {
                        context.contentResolver.openOutputStream(uri)?.use { it.write(body.toByteArray()) } ?: throw IOException("No stream to write to")
                    }
                    TravelmoLog.info("Saved a %s file", safe(mimeType))
                    true
                } catch (e: IOException) {
                    TravelmoLog.failure(e, "Saving a %s file failed", safe(mimeType))
                    false
                }
                currentOnSaved.value(saved)
            }
        }
        return { name -> launcher.launch(name) }
    }

    override val versionName: String = BuildConfig.VERSION_NAME

    @Composable
    override fun PushSettings(viewModel: TripsViewModel) = PushSwitch(viewModel)

    @Composable
    override fun DeviceSettings() {
        TextSizeSection()
        DebugLogSection(signedIn = true)
    }
}
