package app.travelmo.ui

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import app.travelmo.BuildConfig
import app.travelmo.R
import app.travelmo.log.DebugLogging
import app.travelmo.log.TravelmoLog
import com.mikelward.androidlog.android.ShareOutcome
import com.mikelward.androidlog.safe
import com.mikelward.androidzoom.compose.pinchFontSizeHost
import kotlinx.coroutines.launch

/**
 * What Report a bug shares. The activity provides it once, knowing whether
 * someone is signed in, so a screen several layers down offers the same
 * report without each layer passing it on; a test hands in its own.
 */
val LocalReportBug = staticCompositionLocalOf<suspend (Context) -> ShareOutcome> { { DebugLogging.share(it, signedIn = false) } }

/**
 * Whether Google Play has a newer version (PlayUpdateChecker). The activity
 * provides it once and rechecks on each foreground; false (a test, a
 * preview) shows no dot.
 */
val LocalUpdateAvailable = compositionLocalOf { false }

/**
 * The overflow every screen's top bar ends with, as in the sibling apps
 * (stopdash's AppMenuOverflow, clothescast's BugReportOverflowMenu): Report a
 * bug, which shares the debug log as Settings does, and About, which leads
 * to the open-source licenses. [items] are a screen's own, first, each given
 * a `close` to call as it acts. While Play has a newer version
 * ([LocalUpdateAvailable]) the button carries a red dot and "Update
 * available", last, opens the Play listing.
 */
@Composable
fun AppMenu(modifier: Modifier = Modifier, items: @Composable (close: () -> Unit) -> Unit = {}) {
    val context = LocalContext.current
    val reportBug = LocalReportBug.current
    val updateAvailable = LocalUpdateAvailable.current
    val scope = rememberCoroutineScope()
    var expanded by rememberSaveable { mutableStateOf(false) }
    var showAbout by rememberSaveable { mutableStateOf(false) }
    var sharing by remember { mutableStateOf(false) }
    // Button and menu in one Box, so the menu drops from the button rather than the row slot.
    Box(modifier) {
        IconButton(onClick = { expanded = true }) {
            Box {
                Icon(Icons.Filled.MoreVert, contentDescription = stringResource(R.string.more_options))
                if (updateAvailable) {
                    val updateDescription = stringResource(R.string.update_available)
                    Box(
                        Modifier
                            .align(Alignment.TopEnd)
                            // Seats the dot on the icon's top-right corner, where a badge goes.
                            .offset(x = 2.dp, y = (-2).dp)
                            .size(8.dp)
                            .background(MaterialTheme.colorScheme.error, CircleShape)
                            .semantics { contentDescription = updateDescription },
                    )
                }
            }
        }
        // A popup inherits the text size but not the pinch, which is a
        // window's own; pinchFontSizeHost brings it into the menu.
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }, modifier = Modifier.pinchFontSizeHost(), shape = RoundedCornerShape(12.dp)) {
            items { expanded = false }
            DropdownMenuItem(
                text = { Text(stringResource(R.string.report_a_bug), style = MaterialTheme.typography.bodyLarge) },
                enabled = !sharing,
                onClick = {
                    expanded = false
                    sharing = true
                    scope.launch {
                        val outcome = reportBug(context)
                        sharing = false
                        val note = when (outcome) {
                            ShareOutcome.SHARED -> null
                            ShareOutcome.COPIED_ONLY -> R.string.debug_log_copied_only
                            ShareOutcome.FAILED -> R.string.debug_log_share_failed
                        }
                        note?.let { Toast.makeText(context, it, Toast.LENGTH_LONG).show() }
                    }
                },
            )
            DropdownMenuItem(
                text = { Text(stringResource(R.string.about), style = MaterialTheme.typography.bodyLarge) },
                onClick = {
                    expanded = false
                    showAbout = true
                },
            )
            // Last, so the other items keep their places whether or not an update is out.
            if (updateAvailable) {
                DropdownMenuItem(
                    text = { Text(stringResource(R.string.update_available), style = MaterialTheme.typography.bodyLarge) },
                    onClick = {
                        expanded = false
                        openPlayListing(context)
                    },
                )
            }
        }
    }
    val openLicenses = LocalOpenLicenses.current
    if (showAbout) {
        AboutDialog(
            onOpenLicenses = openLicenses?.let { open ->
                {
                    showAbout = false
                    open()
                }
            },
            onDismiss = { showAbout = false },
        )
    }
}

// The app's Play listing, in the Play Store app first, then on the web; the
// package name goes on the end.
private val PLAY_LISTING_URIS = listOf("market://details?id=", "https://play.google.com/store/apps/details?id=")

/**
 * Opens the app's Play listing, where Play does the download and install, as
 * stopdash does. With neither the Play Store nor a browser to open it (rare,
 * since Play itself reported the update), says so rather than let the tap do
 * nothing.
 */
internal fun openPlayListing(context: Context) {
    for (uri in PLAY_LISTING_URIS) {
        try {
            context.startActivity(Intent(Intent.ACTION_VIEW, "$uri${context.packageName}".toUri()))
            return
        } catch (e: ActivityNotFoundException) {
            // No app for this one (no Play Store for market://, say): try the next.
            TravelmoLog.warning("No app to open the Play listing link: %s", safe(e.javaClass.simpleName))
        }
    }
    TravelmoLog.warning("No app to open the Play listing")
    Toast.makeText(context, R.string.update_open_failed, Toast.LENGTH_SHORT).show()
}

/**
 * The app's name and the build, as a bug report names it, and the one
 * action: the open-source licenses, as in stopdash's About. Without
 * [onOpenLicenses] (a test, a preview) it offers none.
 */
@Composable
fun AboutDialog(onOpenLicenses: (() -> Unit)?, onDismiss: () -> Unit) {
    AppAlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.app_name)) },
        text = { Text(stringResource(R.string.about_version, "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")) },
        confirmButton = {
            if (onOpenLicenses != null) {
                TextButton(onClick = onOpenLicenses) { Text(stringResource(R.string.licenses)) }
            } else {
                TextButton(onClick = onDismiss) { Text(stringResource(R.string.ok)) }
            }
        },
        dismissButton = onOpenLicenses?.let { { TextButton(onClick = onDismiss) { Text(stringResource(R.string.ok)) } } },
    )
}
