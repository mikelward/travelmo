package app.travelmo.ui

import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.travelmo.BuildConfig
import app.travelmo.R
import app.travelmo.log.DebugLogging
import com.mikelward.androidlog.android.ShareOutcome
import kotlinx.coroutines.launch

/**
 * What Report a bug shares. The activity provides it once, knowing whether
 * someone is signed in, so a screen several layers down offers the same
 * report without each layer passing it on; a test hands in its own.
 */
val LocalReportBug = staticCompositionLocalOf<suspend (Context) -> ShareOutcome> { { DebugLogging.share(it, signedIn = false) } }

/**
 * The overflow every screen's top bar ends with, as in the sibling apps
 * (stopdash's AppMenuOverflow, clothescast's BugReportOverflowMenu): Report a
 * bug, which shares the debug log as Settings does, and About, which leads
 * to the open-source licenses. [items] are a screen's own, first, each given
 * a `close` to call as it acts.
 */
@Composable
fun AppMenu(modifier: Modifier = Modifier, items: @Composable (close: () -> Unit) -> Unit = {}) {
    val context = LocalContext.current
    val reportBug = LocalReportBug.current
    val scope = rememberCoroutineScope()
    var expanded by rememberSaveable { mutableStateOf(false) }
    var showAbout by rememberSaveable { mutableStateOf(false) }
    var sharing by remember { mutableStateOf(false) }
    // Button and menu in one Box, so the menu drops from the button rather than the row slot.
    Box(modifier) {
        IconButton(onClick = { expanded = true }) {
            Icon(Icons.Filled.MoreVert, contentDescription = stringResource(R.string.more_options))
        }
        DropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }, shape = RoundedCornerShape(12.dp)) {
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

/**
 * The app's name and the build, as a bug report names it, and the one
 * action: the open-source licenses, as in stopdash's About. Without
 * [onOpenLicenses] (a test, a preview) it offers none.
 */
@Composable
fun AboutDialog(onOpenLicenses: (() -> Unit)?, onDismiss: () -> Unit) {
    AlertDialog(
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
