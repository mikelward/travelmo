package app.travelmo.ui

import app.travelmo.shared.report_a_problem
import androidx.compose.material3.OutlinedButton
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.widget.Toast
import app.travelmo.core.sharedReportPreamble
import kotlinx.coroutines.withTimeoutOrNull
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import app.travelmo.BuildConfig
import app.travelmo.R
import app.travelmo.log.DebugLogging
import app.travelmo.log.TravelmoLog
import app.travelmo.shared.Res
import app.travelmo.shared.about
import app.travelmo.shared.about_version
import app.travelmo.shared.access
import app.travelmo.shared.app_name
import app.travelmo.shared.cancel
import app.travelmo.shared.dont_show_again
import app.travelmo.shared.licenses
import app.travelmo.shared.more_options
import app.travelmo.shared.ok
import app.travelmo.shared.report_a_bug
import app.travelmo.shared.report_consent_body
import app.travelmo.shared.report_consent_continue
import app.travelmo.shared.update_available
import com.mikelward.androidlog.android.ShareOutcome
import com.mikelward.androidlog.safe
import com.mikelward.androidzoom.compose.pinchFontSizeHost
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.stringResource

/**
 * What Report a bug shares: the debug report with a screenshot of the screen
 * it was opened from. The activity provides it once, knowing whether
 * someone is signed in, so a screen several layers down offers the same
 * report without each layer passing it on; a test hands in its own.
 */
// How long Share instead waits for the trip's bookings before sharing without them.
private const val TRIP_WAIT_MS = 5_000L

val LocalReportBug = staticCompositionLocalOf<suspend (Context, String?) -> ShareOutcome> { { context, preamble -> DebugLogging.share(context, signedIn = false, screenshot = true, preamble = preamble) } }

/**
 * Whether Google Play has a newer version (PlayUpdateChecker). The activity
 * provides it once and rechecks on each foreground; false (a test, a
 * preview) shows no dot.
 */
val LocalUpdateAvailable = compositionLocalOf { false }


/**
 * The overflow every screen's top bar ends with, as in the sibling apps
 * (stopdash's AppMenuOverflow, clothescast's BugReportOverflowMenu): Report a
 * bug, which shares the debug log as Settings does plus a screenshot of the
 * screen it was opened from, and About, which leads
 * to the open-source licenses. [items] are a screen's own, first, each given
 * a `close` to call as it acts; Access follows them for an admin
 * ([LocalOpenAccess]). While Play has a newer version
 * ([LocalUpdateAvailable]) the button carries a red dot and "Update
 * available", last, opens the Play listing.
 */
@Composable
fun AndroidAppMenu(modifier: Modifier = Modifier, items: @Composable (close: () -> Unit) -> Unit = {}) {
    val context = LocalContext.current
    val reportBug = LocalReportBug.current
    val updateAvailable = LocalUpdateAvailable.current
    val openAccess = LocalOpenAccess.current
    val scope = rememberCoroutineScope()
    var expanded by rememberSaveable { mutableStateOf(false) }
    var showAbout by rememberSaveable { mutableStateOf(false) }
    var sharing by remember { mutableStateOf(false) }
    var showConsent by rememberSaveable { mutableStateOf(false) }
    val sender = LocalBugReportSender.current
    val screen = LocalReportScreen.current
    var showSend by rememberSaveable { mutableStateOf(false) }
    // What the user wrote in the send dialog, kept while the consent dialog asks first.
    var shareText by rememberSaveable { mutableStateOf("") }
    // Shared as a sent report is: what the user wrote, then on a trip's
    // screen its bookings, ahead of the log (SPEC "Bug reports").
    val shareReport = {
        sharing = true
        scope.launch {
            val trip = screen.trip?.let { load ->
                withTimeoutOrNull(TRIP_WAIT_MS) { load() }.also { if (it == null) TravelmoLog.warning("The trip's bookings didn't load; sharing the report without them") }
            }
            val outcome = reportBug(context, sharedReportPreamble(shareText, trip?.trip, trip?.segments))
            shareText = ""
            sharing = false
            val note = when (outcome) {
                ShareOutcome.SHARED -> null
                ShareOutcome.COPIED_ONLY -> R.string.debug_log_copied_only
                ShareOutcome.FAILED -> R.string.debug_log_share_failed
            }
            note?.let { Toast.makeText(context, it, Toast.LENGTH_LONG).show() }
        }
        Unit
    }
    // Button and menu in one Box, so the menu drops from the button rather than the row slot.
    Box(modifier) {
        IconButton(onClick = { expanded = true }) {
            Box {
                Icon(Icons.Filled.MoreVert, contentDescription = stringResource(Res.string.more_options))
                if (updateAvailable) {
                    val updateDescription = stringResource(Res.string.update_available)
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
            openAccess?.let { open ->
                DropdownMenuItem(
                    text = { Text(stringResource(Res.string.access)) },
                    onClick = {
                        expanded = false
                        open()
                    },
                )
            }
            DropdownMenuItem(
                text = { Text(stringResource(Res.string.report_a_bug)) },
                enabled = !sharing,
                onClick = {
                    expanded = false
                    when {
                        // Signed in with a parser: sent to Travelmo, the dialog saying what goes each time.
                        sender != null -> showSend = true
                        // What goes, said once before it first does, as in the sibling apps.
                        DebugLogging.reportConsentNeeded(context) -> showConsent = true
                        else -> shareReport()
                    }
                },
            )
            DropdownMenuItem(
                text = { Text(stringResource(Res.string.about)) },
                onClick = {
                    expanded = false
                    showAbout = true
                },
            )
            // Last, so the other items keep their places whether or not an update is out.
            if (updateAvailable) {
                DropdownMenuItem(
                    text = { Text(stringResource(Res.string.update_available)) },
                    onClick = {
                        expanded = false
                        openPlayListing(context)
                    },
                )
            }
        }
    }
    if (showSend && sender != null) {
        // Made afresh each time the dialog opens, so a new report starts empty.
        val form = remember { BugReportForm { text -> sender.send(context, text, screen) } }
        val state by form.state.collectAsState()
        var text by rememberSaveable { mutableStateOf("") }
        SendReportDialog(
            onTrip = screen.trip != null,
            state = state,
            text = text,
            onTextChange = { text = it },
            onSend = { scope.launch { form.send(text) } },
            onShareInstead = {
                showSend = false
                shareText = text
                if (DebugLogging.reportConsentNeeded(context)) showConsent = true else shareReport()
            },
            onDismiss = { showSend = false },
        )
    }
    if (showConsent) {
        ReportConsentDialog(
            onContinue = { dontShowAgain ->
                showConsent = false
                if (dontShowAgain) DebugLogging.skipReportConsent(context)
                shareReport()
            },
            onCancel = { showConsent = false },
        )
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
 * What Report a bug shares, before it first does: the log and a screenshot
 * of the screen, which can show trips and names, and where it goes. As
 * clothescast's BugReportConsentDialog, with stopdash's list of what is
 * shared. "Don't show again" counts only with Continue; Cancel shares
 * nothing.
 */
@Composable
fun ReportConsentDialog(onContinue: (dontShowAgain: Boolean) -> Unit, onCancel: () -> Unit) {
    var dontShowAgain by rememberSaveable { mutableStateOf(false) }
    AppAlertDialog(
        onDismissRequest = onCancel,
        title = { Text(stringResource(Res.string.report_a_bug)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(stringResource(Res.string.report_consent_body))
                // The whole row toggles, so a tap on the words ticks the box too.
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.toggleable(value = dontShowAgain, role = Role.Checkbox, onValueChange = { dontShowAgain = it }),
                ) {
                    Checkbox(checked = dontShowAgain, onCheckedChange = null)
                    Text(stringResource(Res.string.dont_show_again), modifier = Modifier.padding(start = 8.dp))
                }
            }
        },
        confirmButton = { TextButton(onClick = { onContinue(dontShowAgain) }) { Text(stringResource(Res.string.report_consent_continue)) } },
        dismissButton = { TextButton(onClick = onCancel) { Text(stringResource(Res.string.cancel)) } },
    )
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
        title = { Text(stringResource(Res.string.app_name)) },
        text = { Text(stringResource(Res.string.about_version, "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")) },
        confirmButton = {
            if (onOpenLicenses != null) {
                TextButton(onClick = onOpenLicenses) { Text(stringResource(Res.string.licenses)) }
            } else {
                TextButton(onClick = onDismiss) { Text(stringResource(Res.string.ok)) }
            }
        },
        dismissButton = onOpenLicenses?.let { { TextButton(onClick = onDismiss) { Text(stringResource(Res.string.ok)) } } },
    )
}

/**
 * A screen's "Report a problem" (AppChrome.ReportProblemButton): Report a
 * bug's send dialog with [text] already written for the user to add to, or,
 * shared instead, the same report as the menu shares. Nothing without a
 * parser to send it to.
 */
@Composable
fun ReportProblemButton(text: String) {
    val sender = LocalBugReportSender.current ?: return
    val context = LocalContext.current
    val reportBug = LocalReportBug.current
    val screen = LocalReportScreen.current
    val scope = rememberCoroutineScope()
    var open by rememberSaveable { mutableStateOf(false) }
    var showConsent by rememberSaveable { mutableStateOf(false) }
    var written by rememberSaveable(text) { mutableStateOf(text) }
    val share = {
        scope.launch {
            val note = when (reportBug(context, sharedReportPreamble(written, null, null))) {
                ShareOutcome.SHARED -> null
                ShareOutcome.COPIED_ONLY -> R.string.debug_log_copied_only
                ShareOutcome.FAILED -> R.string.debug_log_share_failed
            }
            note?.let { Toast.makeText(context, it, Toast.LENGTH_LONG).show() }
        }
        Unit
    }
    OutlinedButton(onClick = { open = true }) { Text(stringResource(Res.string.report_a_problem)) }
    if (open) {
        // Made afresh each time the dialog opens.
        val form = remember { BugReportForm { report -> sender.send(context, report, screen) } }
        val state by form.state.collectAsState()
        SendReportDialog(
            onTrip = false,
            state = state,
            text = written,
            onTextChange = { written = it },
            onSend = { scope.launch { form.send(written) } },
            onShareInstead = {
                open = false
                if (DebugLogging.reportConsentNeeded(context)) showConsent = true else share()
            },
            onDismiss = { open = false },
        )
    }
    if (showConsent) {
        ReportConsentDialog(
            onContinue = { dontShowAgain ->
                showConsent = false
                if (dontShowAgain) DebugLogging.skipReportConsent(context)
                share()
            },
            onCancel = { showConsent = false },
        )
    }
}
