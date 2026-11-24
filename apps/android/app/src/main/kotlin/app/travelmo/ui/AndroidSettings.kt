package app.travelmo.ui

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.travelmo.R
import app.travelmo.log.DebugLogging
import app.travelmo.notify.LiveFlightNotifications
import app.travelmo.notify.ReminderNotifications
import app.travelmo.shared.Res
import app.travelmo.shared.back
import app.travelmo.shared.debug_log
import app.travelmo.shared.debug_log_hint
import app.travelmo.shared.debug_log_record
import app.travelmo.shared.notifications_blocked
import app.travelmo.shared.notify_me
import app.travelmo.shared.pinch_to_resize
import app.travelmo.shared.reminders
import app.travelmo.shared.setting_not_saved
import app.travelmo.shared.settings
import app.travelmo.shared.share_debug_log
import app.travelmo.shared.sharing
import app.travelmo.shared.stop
import app.travelmo.shared.text_size
import app.travelmo.shared.text_size_hint
import app.travelmo.shared.text_size_larger
import app.travelmo.shared.text_size_smaller
import app.travelmo.shared.text_size_value
import com.mikelward.androidlog.android.ShareOutcome
import com.mikelward.androidzoom.MAX_FONT_SCALE
import com.mikelward.androidzoom.MIN_FONT_SCALE
import com.mikelward.androidzoom.compose.LocalFontSizeState
import com.mikelward.androidzoom.compose.StableInputDensity
import com.mikelward.androidzoom.fontScalePercent
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.stringResource

// Settings' sections only Android has, which the shared Settings screen
// shows through AppChrome: reminders as notifications (the permission and
// the phone's Cloud Messaging token), the text size the user picks, and the
// on-device debug log.

private const val PUSH_TOKEN = "settings/reminders/push"

/**
 * Reminders as notifications on this phone: the switch asks for the
 * notification permission the first time, then registers the phone's
 * messaging token under the account; off forgets the phone. It is absent
 * when the phone has no token (Firebase dormant, no Play services).
 */
@Composable
fun PushSwitch(viewModel: TripsViewModel) {
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
        Text(stringResource(Res.string.notify_me), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Switch(
            checked = chosen ?: ready.on,
            onCheckedChange = { on ->
                if (!on) {
                    blocked = false
                    chosen = false
                    viewModel.setPushDevice(PUSH_TOKEN, false)
                    // The kept Live Updates too, or their alarms would draw them again.
                    LiveFlightNotifications.forgetAll(context)
                } else if (ReminderNotifications.allowed(context)) {
                    turnOn()
                } else {
                    askPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                }
            },
            enabled = outcome !is Outcome.Busy,
        )
    }
    if (blocked) Text(stringResource(Res.string.notifications_blocked), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
    (outcome as? Outcome.Failed)?.let { Text(it.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
}

/**
 * The text size (SPEC "Text size"): the percentage of the phone's own size,
 * a slider that resizes the app as it moves and saves on release, − and +
 * for one percent a tap, each off at its end of the range, and a switch for
 * the two-finger pinch. Reads the theme's state, so the slider and a pinch
 * move one value; absent outside the theme.
 */
@Composable
fun TextSizeSection() {
    val fontSize = LocalFontSizeState.current ?: return
    val scale = fontSize.scale
    val percent = stringResource(Res.string.text_size_value, fontScalePercent(scale))
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 24.dp, bottom = 4.dp)) {
        Text(stringResource(Res.string.text_size), style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
        Text(percent, style = MaterialTheme.typography.titleLarge)
    }
    Text(stringResource(Res.string.text_size_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    // Where the drag last was, so the release saves exactly that: [scale]
    // comes back through recomposition, which a release in the same frame
    // as the last movement would beat.
    var dragged by remember { mutableFloatStateOf(scale) }
    var dragging by remember { mutableStateOf(false) }
    // Level with a pinch or a step whenever the slider isn't the one moving it.
    if (!dragging) dragged = scale
    // Leaving Settings mid-drag never calls onValueChangeFinished; end the drag
    // here, or the state would hold back stored values for the rest of the run.
    DisposableEffect(Unit) { onDispose { if (dragging) fontSize.commit(dragged) } }
    val smaller = stepTextScale(scale, -1)
    val larger = stepTextScale(scale, 1)
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
        IconButton(
            onClick = {
                fontSize.preview(smaller)
                fontSize.commit(smaller)
            },
            enabled = smaller != scale,
        ) { Icon(painterResource(R.drawable.ic_remove), contentDescription = stringResource(Res.string.text_size_smaller)) }
        Box(modifier = Modifier.weight(1f)) {
            // At the density before the text size: dragging changes that
            // density, which would otherwise restart the slider's own gesture.
            StableInputDensity {
                Slider(
                    value = scale,
                    onValueChange = {
                        dragging = true
                        dragged = it
                        fontSize.preview(it)
                    },
                    onValueChangeFinished = {
                        dragging = false
                        fontSize.commit(dragged)
                    },
                    // Not stepped, like the pinch, so neither rounds away the other's size.
                    valueRange = MIN_FONT_SCALE..MAX_FONT_SCALE,
                    // The palette has no secondaryContainer, Material's default here.
                    colors = SliderDefaults.colors(inactiveTrackColor = MaterialTheme.colorScheme.outlineVariant),
                    // The percentage beside the title, not the thumb's place in the track.
                    modifier = Modifier.semantics { stateDescription = percent },
                )
            }
        }
        IconButton(
            onClick = {
                fontSize.preview(larger)
                fontSize.commit(larger)
            },
            enabled = larger != scale,
        ) { Icon(Icons.Filled.Add, contentDescription = stringResource(Res.string.text_size_larger)) }
    }
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
        Text(stringResource(Res.string.pinch_to_resize), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Switch(checked = fontSize.pinchEnabled, onCheckedChange = fontSize::choosePinch)
    }
    if (TextSizeSetting.saveFailed) Text(stringResource(Res.string.setting_not_saved), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
}

/**
 * The on-device debug log: a switch to stop recording (which also empties
 * what was collected) and a share of a report built from this run and the
 * earlier ones, through the system share sheet with a clipboard copy. The
 * log carries nothing of the user's that the privacy floor withholds.
 */
@Composable
fun DebugLogSection(signedIn: Boolean) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var enabled by remember { mutableStateOf(DebugLogging.isEnabled(context)) }
    var saveFailed by remember { mutableStateOf(false) }
    var sharing by remember { mutableStateOf(false) }
    var shareNote by remember { mutableStateOf<Int?>(null) }
    Text(stringResource(Res.string.debug_log), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
    Text(stringResource(Res.string.debug_log_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
        Text(stringResource(Res.string.debug_log_record), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Switch(
            checked = enabled,
            onCheckedChange = { on ->
                enabled = on
                saveFailed = !DebugLogging.setEnabled(context, on)
            },
        )
    }
    if (saveFailed) Text(stringResource(Res.string.setting_not_saved), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
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
    ) { Text(stringResource(if (sharing) Res.string.sharing else Res.string.share_debug_log)) }
    shareNote?.let { Text(stringResource(it), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
}
