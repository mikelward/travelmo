package app.travelmo.ui

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.travelmo.BuildConfig
import app.travelmo.R
import app.travelmo.auth.GoogleAccount
import app.travelmo.auth.SignedIn
import app.travelmo.core.EmailRowKind
import app.travelmo.core.emailRows
import app.travelmo.core.pausedReason
import app.travelmo.core.describeBackfill
import app.travelmo.log.DebugLogging
import app.travelmo.notify.ReminderNotifications
import com.mikelward.androidlog.android.ShareOutcome
import com.mikelward.androidzoom.MAX_FONT_SCALE
import com.mikelward.androidzoom.MIN_FONT_SCALE
import com.mikelward.androidzoom.compose.LocalFontSizeState
import com.mikelward.androidzoom.compose.StableInputDensity
import com.mikelward.androidzoom.fontScalePercent
import kotlinx.coroutines.launch

private const val REMINDER_TOKEN = "settings/reminders/email"
private const val PUSH_TOKEN = "settings/reminders/push"
private const val DELETE_ACCOUNT_TOKEN = "settings/account/delete"
private const val GMAIL_TOKEN = "settings/gmail"
private const val REGROUP_TOKEN = "settings/trips/regroup"
private const val DELETE_TRIPS_TOKEN = "settings/trips/delete"
private const val ADD_EMAIL_TOKEN = "settings/emails/add"
private const val REMOVE_EMAIL_TOKEN = "settings/emails/remove"

/**
 * The account, Gmail and reading past emails, regrouping or deleting all
 * trips, Import review, reminders by email and
 * as notifications on this phone, the text size, the debug log, deleting
 * the account and the build; the other import settings are on the web for now.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(account: GoogleAccount, user: SignedIn, viewModel: TripsViewModel, onBack: () -> Unit, onOpenReview: () -> Unit = {}) {
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
                actions = { AppMenu() },
            )
        },
    ) { padding ->
        // Scrolls, so a short window with large text still reaches every control.
        val scroll = rememberScrollState()
        Column(modifier = Modifier.fillMaxSize().padding(padding).scrollEdgeCue(scroll, scrollCueColors()).verticalScroll(scroll).padding(16.dp)) {
            Text(stringResource(R.string.signed_in_as, user.email ?: user.uid), style = MaterialTheme.typography.bodyLarge)
            OutlinedButton(onClick = { scope.launch { account.signOut(context) } }, modifier = Modifier.padding(top = 12.dp)) {
                Text(stringResource(R.string.sign_out))
            }
            GmailSection(viewModel)
            TripsSection(viewModel)
            Text(stringResource(R.string.import_review), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
            Text(stringResource(R.string.import_review_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedButton(onClick = onOpenReview, modifier = Modifier.padding(top = 8.dp)) { Text(stringResource(R.string.open_import_review)) }
            EmailAddressesSection(user, viewModel)
            Text(stringResource(R.string.reminders), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
            Text(stringResource(R.string.reminders_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
                Text(
                    if (user.email != null) stringResource(R.string.email_me_to, user.email) else stringResource(R.string.email_me),
                    style = MaterialTheme.typography.bodyLarge,
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
            (outcome as? Outcome.Failed)?.let { Text(it.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
            PushSwitch(viewModel)
            TextSizeSection()
            DebugLogSection(signedIn = true)
            DeleteAccountSection(account, viewModel)
            Text(
                stringResource(R.string.version, BuildConfig.VERSION_NAME),
                style = MaterialTheme.typography.bodyMedium,
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
        Text(stringResource(R.string.notify_me), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
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
    if (blocked) Text(stringResource(R.string.notifications_blocked), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
    (outcome as? Outcome.Failed)?.let { Text(it.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
}

/**
 * The user's email addresses (SPEC "Linked email addresses"), as on the web:
 * the sign-in, those confirmed, the connected Gmail and those waiting for
 * their link, each linked one removable, and Add, which mails a link that
 * opens on the web. A build with no parser address lists them only.
 */
@Composable
private fun EmailAddressesSection(user: SignedIn, viewModel: TripsViewModel) {
    val holder by viewModel.addressHolder.collectAsStateWithLifecycle()
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    val adding = outcomes[ADD_EMAIL_TOKEN]
    val removing = outcomes[REMOVE_EMAIL_TOKEN]
    val busy = adding is Outcome.Busy || removing is Outcome.Busy
    var address by rememberSaveable { mutableStateOf("") }
    var sentTo by rememberSaveable { mutableStateOf<String?>(null) }
    LaunchedEffect(adding) {
        if (adding is Outcome.Done) {
            address = ""
            viewModel.outcomeSeen(ADD_EMAIL_TOKEN)
        }
    }
    LaunchedEffect(removing) { if (removing is Outcome.Done) viewModel.outcomeSeen(REMOVE_EMAIL_TOKEN) }
    Text(stringResource(R.string.email_addresses), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
    Text(stringResource(R.string.email_addresses_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    for (row in emailRows(user.email, holder, viewModel.now())) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
            Column(modifier = Modifier.weight(1f)) {
                Text(row.email, style = MaterialTheme.typography.bodyLarge)
                val note = when (row.kind) {
                    EmailRowKind.SIGN_IN -> R.string.email_sign_in
                    EmailRowKind.GMAIL -> R.string.email_gmail
                    EmailRowKind.PENDING -> R.string.email_pending
                    EmailRowKind.CONFIRMED -> null
                }
                note?.let { Text(stringResource(it), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
            if (row.removable && viewModel.canLinkEmails) {
                IconButton(onClick = { sentTo = null; viewModel.removeEmail(REMOVE_EMAIL_TOKEN, row.email) }, enabled = !busy) {
                    Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.remove_email, row.email))
                }
            }
        }
    }
    if (!viewModel.canLinkEmails) {
        Text(stringResource(R.string.emails_on_web), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp))
        return
    }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
        OutlinedTextField(
            value = address,
            onValueChange = { address = it },
            placeholder = { Text("name@example.com") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            modifier = Modifier.weight(1f),
        )
        Button(
            onClick = {
                sentTo = address.trim().lowercase()
                viewModel.addEmail(ADD_EMAIL_TOKEN, address)
            },
            enabled = !busy && address.isNotBlank(),
        ) { Text(stringResource(R.string.add)) }
    }
    if (adding == null || adding is Outcome.Done) sentTo?.let { Text(stringResource(R.string.email_link_sent, it), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 4.dp)) }
    for (outcome in listOf(adding, removing)) {
        (outcome as? Outcome.Failed)?.let { Text(it.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
    }
}

/**
 * Settings' "Gmail", as on the web: Connect opens Google's consent page in
 * the browser, which hands back to Travelmo there; once connected, the
 * address, Import past bookings (Continue, or Read again from the start once
 * done) or Stop while it reads, Disconnect, and how far the reading got,
 * which the parser records as it goes.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun GmailSection(viewModel: TripsViewModel) {
    val context = LocalContext.current
    val gmail by viewModel.gmail.collectAsStateWithLifecycle()
    val consent by viewModel.gmailConsentUrl.collectAsStateWithLifecycle()
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    val outcome = outcomes[GMAIL_TOKEN]
    val busy = outcome is Outcome.Busy
    LaunchedEffect(consent) {
        consent?.let {
            openLink(context, it, "Gmail consent")
            viewModel.gmailConsentOpened()
        }
    }
    LaunchedEffect(outcome) { if (outcome is Outcome.Done) viewModel.outcomeSeen(GMAIL_TOKEN) }
    Text(stringResource(R.string.gmail), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
    if (!viewModel.canUseGmail) {
        Text(stringResource(R.string.gmail_on_web), style = MaterialTheme.typography.bodyMedium)
        return
    }
    when (val state = gmail) {
        TripsViewModel.GmailState.Loading -> Text(stringResource(R.string.loading), style = MaterialTheme.typography.bodyMedium)
        TripsViewModel.GmailState.NotConnected -> {
            Text(stringResource(R.string.gmail_connect_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedButton(onClick = { viewModel.connectGmail(GMAIL_TOKEN) }, enabled = !busy, modifier = Modifier.padding(top = 8.dp)) {
                Text(stringResource(R.string.connect_gmail))
            }
        }
        is TripsViewModel.GmailState.Connected -> {
            Text(stringResource(R.string.gmail_connected_as, state.emailAddress), style = MaterialTheme.typography.bodyMedium)
            val progress = state.progress
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                if (state.reading) {
                    OutlinedButton(onClick = { viewModel.stopReading(GMAIL_TOKEN) }, enabled = !busy) { Text(stringResource(R.string.stop)) }
                } else {
                    OutlinedButton(onClick = { viewModel.startReading(GMAIL_TOKEN, restart = progress?.done == true) }, enabled = !busy) {
                        Text(
                            stringResource(
                                when {
                                    progress == null -> R.string.import_past_bookings
                                    progress.done -> R.string.read_again_from_start
                                    else -> R.string.continue_reading
                                },
                            ),
                        )
                    }
                }
                OutlinedButton(onClick = { viewModel.disconnectGmail(GMAIL_TOKEN) }, enabled = !busy) { Text(stringResource(R.string.disconnect)) }
            }
            progress?.let {
                Text(describeBackfill(it, state.reading), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
            }
            pausedReason(progress, state.reading)?.let {
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp))
            }
        }
    }
    (outcome as? Outcome.Failed)?.let {
        Text(it.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp))
    }
}

/**
 * Settings' "Trips", as on the web: "Regroup trips" files every booking
 * again with the grouping imports use now, and "Delete all trips" asks
 * first, with how many will go, before deleting them so the user can import
 * again. A build with no parser address says to use the web.
 */
@Composable
private fun TripsSection(viewModel: TripsViewModel) {
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    val notice by viewModel.tripNotice.collectAsStateWithLifecycle()
    val own by viewModel.ownTripCount.collectAsStateWithLifecycle()
    val regrouping = outcomes[REGROUP_TOKEN]
    val deleting = outcomes[DELETE_TRIPS_TOKEN]
    val busy = regrouping is Outcome.Busy || deleting is Outcome.Busy
    var confirming by remember { mutableStateOf(false) }
    // A finished action is acknowledged so the next starts afresh; its line stays.
    LaunchedEffect(regrouping) { if (regrouping is Outcome.Done) viewModel.outcomeSeen(REGROUP_TOKEN) }
    LaunchedEffect(deleting) { if (deleting is Outcome.Done) viewModel.outcomeSeen(DELETE_TRIPS_TOKEN) }
    Text(stringResource(R.string.trips_section), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
    Text(stringResource(R.string.regroup_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    if (!viewModel.canRunTripActions) {
        Text(stringResource(R.string.trips_on_web), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp))
        return
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
        OutlinedButton(
            onClick = {
                listOf(REGROUP_TOKEN, DELETE_TRIPS_TOKEN).forEach(viewModel::outcomeSeen)
                viewModel.regroupTrips(REGROUP_TOKEN)
            },
            enabled = !busy,
        ) { Text(stringResource(if (regrouping is Outcome.Busy) R.string.regrouping else R.string.regroup_trips)) }
        OutlinedButton(
            onClick = { confirming = true },
            enabled = !busy,
            colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
        ) { Text(stringResource(if (deleting is Outcome.Busy) R.string.deleting else R.string.delete_all_trips)) }
    }
    notice?.let { Text(it, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp)) }
    listOf(regrouping, deleting).filterIsInstance<Outcome.Failed>().lastOrNull()?.let {
        Text(it.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp))
    }
    if (confirming) {
        AppAlertDialog(
            onDismissRequest = { confirming = false },
            title = { Text(stringResource(R.string.delete_all_trips_title)) },
            text = { Text(stringResource(R.string.delete_all_trips_confirm)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirming = false
                        listOf(REGROUP_TOKEN, DELETE_TRIPS_TOKEN).forEach(viewModel::outcomeSeen)
                        viewModel.deleteAllTrips(DELETE_TRIPS_TOKEN)
                    },
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                ) {
                    Text(own?.let { pluralStringResource(R.plurals.delete_n_trips, it, it) } ?: stringResource(R.string.delete))
                }
            },
            dismissButton = { TextButton(onClick = { confirming = false }) { Text(stringResource(R.string.keep)) } },
        )
    }
}

/**
 * Deleting the account, as on the web: a dialog asks first, then the parser
 * deletes everything and the app signs out, and the sign-in screen says the
 * account is gone. A build with no parser address says to use the web.
 */
@Composable
private fun DeleteAccountSection(account: GoogleAccount, viewModel: TripsViewModel) {
    val context = LocalContext.current
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    val outcome = outcomes[DELETE_ACCOUNT_TOKEN]
    var confirming by remember { mutableStateOf(false) }
    Text(stringResource(R.string.delete_account), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
    Text(stringResource(R.string.delete_account_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    if (!viewModel.canDeleteAccount) {
        Text(stringResource(R.string.delete_account_on_web), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp))
        return
    }
    OutlinedButton(
        onClick = { confirming = true },
        enabled = outcome !is Outcome.Busy,
        colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
        modifier = Modifier.padding(top = 8.dp),
    ) { Text(stringResource(if (outcome is Outcome.Busy) R.string.deleting else R.string.delete_account)) }
    (outcome as? Outcome.Failed)?.let { Text(it.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
    if (confirming) {
        AppAlertDialog(
            onDismissRequest = { confirming = false },
            title = { Text(stringResource(R.string.delete_account_confirm_title)) },
            text = { Text(stringResource(R.string.delete_account_confirm)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirming = false
                        val appContext = context.applicationContext
                        viewModel.deleteAccount(DELETE_ACCOUNT_TOKEN) { account.signOutDeleted(appContext) }
                    },
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                ) { Text(stringResource(R.string.delete)) }
            },
            dismissButton = { TextButton(onClick = { confirming = false }) { Text(stringResource(R.string.keep)) } },
        )
    }
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
    Text(stringResource(R.string.debug_log), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
    Text(stringResource(R.string.debug_log_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
        Text(stringResource(R.string.debug_log_record), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Switch(
            checked = enabled,
            onCheckedChange = { on ->
                enabled = on
                saveFailed = !DebugLogging.setEnabled(context, on)
            },
        )
    }
    if (saveFailed) Text(stringResource(R.string.setting_not_saved), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
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
    shareNote?.let { Text(stringResource(it), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
}

/**
 * The text size (SPEC "Text size"): the percentage of the phone's own size,
 * a slider that resizes the app as it moves and saves on release, − and +
 * for one percent a tap, each off at its end of the range, and a switch for
 * the two-finger pinch. Reads the theme's state, so the slider and a pinch
 * move one value; absent outside the theme.
 */
@Composable
internal fun TextSizeSection() {
    val fontSize = LocalFontSizeState.current ?: return
    val scale = fontSize.scale
    val percent = stringResource(R.string.text_size_value, fontScalePercent(scale))
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 24.dp, bottom = 4.dp)) {
        Text(stringResource(R.string.text_size), style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
        Text(percent, style = MaterialTheme.typography.titleLarge)
    }
    Text(stringResource(R.string.text_size_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
        ) { Icon(painterResource(R.drawable.ic_remove), contentDescription = stringResource(R.string.text_size_smaller)) }
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
        ) { Icon(Icons.Filled.Add, contentDescription = stringResource(R.string.text_size_larger)) }
    }
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
        Text(stringResource(R.string.pinch_to_resize), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
        Switch(checked = fontSize.pinchEnabled, onCheckedChange = fontSize::choosePinch)
    }
    if (TextSizeSetting.saveFailed) Text(stringResource(R.string.setting_not_saved), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
}
