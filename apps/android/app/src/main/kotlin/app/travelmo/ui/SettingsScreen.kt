package app.travelmo.ui

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.travelmo.BuildConfig
import app.travelmo.R
import app.travelmo.auth.GoogleAccount
import app.travelmo.auth.SignedIn
import app.travelmo.log.DebugLogging
import app.travelmo.notify.ReminderNotifications
import com.mikelward.androidlog.android.ShareOutcome
import kotlinx.coroutines.launch

private const val REMINDER_TOKEN = "settings/reminders/email"
private const val PUSH_TOKEN = "settings/reminders/push"

/**
 * The account, reminders by email and as notifications on this phone, the
 * debug log and the build; the import settings are on the web for now.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(account: GoogleAccount, user: SignedIn, viewModel: TripsViewModel, onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val stored by viewModel.reminderEmail.collectAsStateWithLifecycle()
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    val outcome = outcomes[REMINDER_TOKEN]
    // The switch follows the tap at once; the stored value catches up, and a
    // refusal puts it back and stays on screen until the next tap replaces it.
    var chosen by remember { mutableStateOf<Boolean?>(null) }
    LaunchedEffect(outcome) {
        when (outcome) {
            is Outcome.Done -> viewModel.outcomeSeen(REMINDER_TOKEN)
            is Outcome.Failed -> chosen = null
            else -> {}
        }
    }
    LaunchedEffect(stored) { if (stored == chosen) chosen = null }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.settings)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.back))
                    }
                },
            )
        },
    ) { padding ->
        // Scrolls, so a short window with large text still reaches every control.
        Column(modifier = Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(16.dp)) {
            Text(stringResource(R.string.signed_in_as, user.email ?: user.uid), style = MaterialTheme.typography.bodyLarge)
            OutlinedButton(onClick = { scope.launch { account.signOut(context) } }, modifier = Modifier.padding(top = 12.dp)) {
                Text(stringResource(R.string.sign_out))
            }
            Text(stringResource(R.string.reminders), style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
            Text(stringResource(R.string.reminders_hint), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
                Text(
                    if (user.email != null) stringResource(R.string.email_me_to, user.email) else stringResource(R.string.email_me),
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.weight(1f),
                )
                Switch(
                    checked = chosen ?: stored ?: false,
                    onCheckedChange = { on ->
                        chosen = on
                        viewModel.setReminderEmail(REMINDER_TOKEN, on)
                    },
                    enabled = stored != null && outcome !is Outcome.Busy,
                )
            }
            (outcome as? Outcome.Failed)?.let { Text(it.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
            PushSwitch(viewModel)
            DebugLogSection(signedIn = true)
            Text(
                stringResource(R.string.version, BuildConfig.VERSION_NAME),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 24.dp),
            )
        }
    }
}

/**
 * Reminders as notifications on this phone: the switch asks for the
 * notification permission the first time, then registers the phone's
 * messaging token under the account; off forgets the phone. It is absent
 * when the phone has no token (Firebase dormant, no Play services).
 */
@Composable
private fun PushSwitch(viewModel: TripsViewModel) {
    val context = LocalContext.current
    val state by viewModel.pushState.collectAsStateWithLifecycle()
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    val outcome = outcomes[PUSH_TOKEN]
    val ready = state as? PushState.Ready ?: return
    var chosen by remember { mutableStateOf<Boolean?>(null) }
    var blocked by remember { mutableStateOf(false) }
    LaunchedEffect(outcome) {
        when (outcome) {
            is Outcome.Done -> viewModel.outcomeSeen(PUSH_TOKEN)
            is Outcome.Failed -> chosen = null
            else -> {}
        }
    }
    LaunchedEffect(ready.on) { if (ready.on == chosen) chosen = null }
    val turnOn = {
        if (ReminderNotifications.allowed(context)) {
            blocked = false
            chosen = true
            viewModel.setPushDevice(PUSH_TOKEN, true)
        } else {
            // Granted, yet the app is blocked in the system settings.
            blocked = true
        }
    }
    val askPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) turnOn() else blocked = true
    }
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
        Text(stringResource(R.string.notify_me), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        Switch(
            checked = chosen ?: ready.on,
            onCheckedChange = { on ->
                if (!on) {
                    blocked = false
                    chosen = false
                    viewModel.setPushDevice(PUSH_TOKEN, false)
                } else if (ReminderNotifications.allowed(context)) {
                    turnOn()
                } else {
                    askPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                }
            },
            enabled = outcome !is Outcome.Busy,
        )
    }
    if (blocked) Text(stringResource(R.string.notifications_blocked), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
    (outcome as? Outcome.Failed)?.let { Text(it.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
}

/**
 * The on-device debug log: a switch to stop recording (which also empties
 * what was collected) and a share of a report built from this run and the
 * earlier ones, through the system share sheet with a clipboard copy. The
 * log carries nothing of the user's that the privacy floor withholds.
 */
@Composable
private fun DebugLogSection(signedIn: Boolean) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var enabled by remember { mutableStateOf(DebugLogging.isEnabled(context)) }
    var saveFailed by remember { mutableStateOf(false) }
    var sharing by remember { mutableStateOf(false) }
    var shareNote by remember { mutableStateOf<Int?>(null) }
    Text(stringResource(R.string.debug_log), style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
    Text(stringResource(R.string.debug_log_hint), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
        Text(stringResource(R.string.debug_log_record), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        Switch(
            checked = enabled,
            onCheckedChange = { on ->
                enabled = on
                saveFailed = !DebugLogging.setEnabled(context, on)
            },
        )
    }
    if (saveFailed) Text(stringResource(R.string.setting_not_saved), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
    OutlinedButton(
        onClick = {
            sharing = true
            shareNote = null
            scope.launch {
                val outcome = DebugLogging.share(context, signedIn)
                shareNote = when (outcome) {
                    ShareOutcome.SHARED -> null
                    ShareOutcome.COPIED_ONLY -> R.string.debug_log_copied_only
                    ShareOutcome.FAILED -> R.string.debug_log_share_failed
                }
                sharing = false
            }
        },
        enabled = !sharing,
        modifier = Modifier.padding(top = 8.dp),
    ) { Text(stringResource(if (sharing) R.string.sharing else R.string.share_debug_log)) }
    shareNote?.let { Text(stringResource(it), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
}
