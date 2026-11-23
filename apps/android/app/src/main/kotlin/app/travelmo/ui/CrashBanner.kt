package app.travelmo.ui

import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.travelmo.R
import app.travelmo.shared.Res
import app.travelmo.shared.crash_banner_body
import app.travelmo.shared.crash_banner_dismiss
import app.travelmo.shared.crash_banner_share
import app.travelmo.shared.crash_banner_title
import app.travelmo.shared.sharing
import com.mikelward.androidlog.android.ShareOutcome
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.jetbrains.compose.resources.stringResource

/**
 * The crash banner's state and actions. The activity provides the debug
 * log's ([app.travelmo.log.DebugLogging]); a test provides its own. [crashed]
 * comes down when a report's clipboard copy lands or on [dismiss], both
 * decided by the shared log library, so [share] does not lower it itself.
 */
class CrashReport(
    val crashed: StateFlow<Boolean>,
    val refresh: () -> Unit,
    val dismiss: () -> Unit,
    val share: suspend (Context) -> ShareOutcome,
) {
    companion object {
        /** No crash and nothing to do: a preview, or a test that is not about the banner. */
        val None = CrashReport(MutableStateFlow(false), refresh = {}, dismiss = {}, share = { ShareOutcome.FAILED })
    }
}

val LocalCrashReport = staticCompositionLocalOf { CrashReport.None }

/**
 * Whether to show [LastCrashBanner]: after a crash in an earlier run, until
 * its report lands or the user dismisses it. Re-derived each time the screen
 * comes forward, so a crash while the app was in the background shows
 * without a restart. A screen calls it once and shows the banner when true,
 * so an absent banner takes no room in its layout.
 */
@Composable
fun crashPending(): Boolean {
    val report = LocalCrashReport.current
    val crashed by report.crashed.collectAsStateWithLifecycle()
    LifecycleResumeEffect(report) {
        report.refresh()
        onPauseOrDispose {}
    }
    return crashed
}

/**
 * Offers an earlier run's crash report where the user will see it, as the
 * sibling apps do on their main screen; shown while [crashPending].
 *
 * The report carries no screenshot: the crash was in an earlier run, so the
 * screen showing now says nothing about it.
 */
@Composable
fun LastCrashBanner(modifier: Modifier = Modifier) {
    val report = LocalCrashReport.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var sharing by remember { mutableStateOf(false) }
    var shareFailed by remember { mutableStateOf(false) }
    CrashBanner(
        onShare = {
            sharing = true
            shareFailed = false
            scope.launch {
                // A landed copy lowers the banner, which leaves the composition
                // and cancels this scope; the share, and saying how it went,
                // must finish regardless.
                withContext(NonCancellable) {
                    val outcome = report.share(context)
                    sharing = false
                    when (outcome) {
                        ShareOutcome.SHARED -> Unit
                        // The copy landed, so the banner is on its way down: say where the report went in a toast.
                        ShareOutcome.COPIED_ONLY -> Toast.makeText(context.applicationContext, R.string.debug_log_copied_only, Toast.LENGTH_LONG).show()
                        ShareOutcome.FAILED -> shareFailed = true
                    }
                }
            }
        },
        onDismiss = report.dismiss,
        sharing = sharing,
        shareFailed = shareFailed,
        modifier = modifier,
    )
}

/** The banner itself: what happened, the ask, Dismiss and Share; Share is off while a share runs. */
@Composable
fun CrashBanner(onShare: () -> Unit, onDismiss: () -> Unit, sharing: Boolean, shareFailed: Boolean, modifier: Modifier = Modifier) {
    Surface(
        shape = MaterialTheme.shapes.medium,
        color = MaterialTheme.colorScheme.errorContainer,
        contentColor = MaterialTheme.colorScheme.onErrorContainer,
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(Res.string.crash_banner_title), style = MaterialTheme.typography.titleMedium)
            Text(stringResource(Res.string.crash_banner_body), style = MaterialTheme.typography.bodyMedium)
            if (shareFailed) Text(stringResource(R.string.debug_log_share_failed), style = MaterialTheme.typography.bodySmall)
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                TextButton(onClick = onDismiss) { Text(stringResource(Res.string.crash_banner_dismiss)) }
                Button(onClick = onShare, enabled = !sharing) {
                    Text(stringResource(if (sharing) Res.string.sharing else Res.string.crash_banner_share))
                }
            }
        }
    }
}
