package app.travelmo.ui

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.StringRes
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.travelmo.BuildConfig
import app.travelmo.R
import app.travelmo.auth.GoogleAccount
import app.travelmo.auth.SignedIn
import app.travelmo.core.EmailRowKind
import app.travelmo.core.MAX_GMAIL_MAILBOXES
import app.travelmo.core.MAX_RIDE_COMPANIES
import app.travelmo.core.ParsedCountries
import app.travelmo.core.RideNear
import app.travelmo.core.countryName
import app.travelmo.core.describeBackfill
import app.travelmo.core.emailRows
import app.travelmo.core.parseCountries
import app.travelmo.core.pausedReason
import app.travelmo.core.rideCompanyOrNull
import app.travelmo.log.DebugLogging
import app.travelmo.log.TravelmoLog
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
private const val FASTMAIL_TOKEN = "settings/fastmail"
private const val FASTMAIL_DISCONNECT_TOKEN = "settings/fastmail/disconnect"

/** Where Fastmail users make (and later delete) the API token Travelmo reads with. */
private const val FASTMAIL_TOKENS_URL = "https://app.fastmail.com/settings/security/tokens"
private const val REGROUP_TOKEN = "settings/trips/regroup"
private const val DELETE_TRIPS_TOKEN = "settings/trips/delete"
private const val ADD_EMAIL_TOKEN = "settings/emails/add"
private const val REMOVE_EMAIL_TOKEN = "settings/emails/remove"
private const val SENDER_RULES_TOKEN = "settings/senders"
private const val FORWARD_TOKEN = "settings/forward"
private const val EXPORT_TOKEN = "settings/export"
private const val ADD_FEED_TOKEN = "settings/feeds/add"
private const val REMOVE_FEED_TOKEN = "settings/feeds/remove"
private const val ADD_COMPANY_TOKEN = "settings/rides/add"
private const val REMOVE_COMPANY_TOKEN = "settings/rides/remove"

/**
 * The account, Gmail and Fastmail and reading past emails, regrouping or deleting all
 * trips, Import review, reminders by email and
 * as notifications on this phone, the reminders before international trips, the text size, the debug log, deleting
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
            FastmailSection(viewModel)
            TripsSection(viewModel)
            FeedsSection(viewModel)
            CalendarExportSection(viewModel)
            Text(stringResource(R.string.import_review), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
            Text(stringResource(R.string.import_review_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedButton(onClick = onOpenReview, modifier = Modifier.padding(top = 8.dp)) { Text(stringResource(R.string.open_import_review)) }
            SenderRulesSection(viewModel)
            RideCompaniesSection(viewModel)
            EmailAddressesSection(user, viewModel)
            ForwardSection(viewModel)
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
            TripRemindersSection(viewModel)
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
 * Settings' "Calendar feeds", as on the web: a calendar subscription link
 * the parser reads every day, each listed with what its last read did, and
 * removed without touching its bookings.
 */
@Composable
private fun FeedsSection(viewModel: TripsViewModel) {
    val feeds by viewModel.feeds.collectAsStateWithLifecycle()
    val added by viewModel.feedAdded.collectAsStateWithLifecycle()
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    val adding = outcomes[ADD_FEED_TOKEN]
    val removing = outcomes[REMOVE_FEED_TOKEN]
    val busy = adding is Outcome.Busy || removing is Outcome.Busy
    var url by rememberSaveable { mutableStateOf("") }
    LaunchedEffect(adding) {
        if (adding is Outcome.Done) {
            url = ""
            viewModel.outcomeSeen(ADD_FEED_TOKEN)
        }
    }
    LaunchedEffect(removing) { if (removing is Outcome.Done) viewModel.outcomeSeen(REMOVE_FEED_TOKEN) }
    val list = feeds ?: return
    Text(stringResource(R.string.calendar_feeds), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
    Text(stringResource(R.string.calendar_feeds_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    for (feed in list) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
            Column(modifier = Modifier.weight(1f)) {
                Text(feed.name, style = MaterialTheme.typography.bodyLarge)
                val read = feed.lastFetchedAt?.let { stringResource(R.string.feed_read_on, it.take(10)) } ?: stringResource(R.string.feed_not_read)
                Text(
                    listOfNotNull(read, feed.lastResult?.takeIf { feed.lastError == null }).joinToString(" · "),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                feed.lastError?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error) }
            }
            if (viewModel.canEditFeeds) {
                IconButton(onClick = { viewModel.removeFeed(REMOVE_FEED_TOKEN, feed.id) }, enabled = !busy) {
                    Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.remove_feed, feed.name))
                }
            }
        }
    }
    if (!viewModel.canEditFeeds) {
        Text(stringResource(R.string.feeds_on_web), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp))
        return
    }
    OutlinedTextField(
        value = url,
        onValueChange = { url = it },
        label = { Text(stringResource(R.string.calendar_feed_link)) },
        placeholder = { Text("webcal://… or https://…") },
        singleLine = true,
        enabled = !busy,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
    )
    Button(onClick = { viewModel.addFeed(ADD_FEED_TOKEN, url) }, enabled = !busy && url.isNotBlank(), modifier = Modifier.padding(top = 8.dp)) {
        Text(stringResource(if (adding is Outcome.Busy) R.string.reading else R.string.add_feed))
    }
    if (adding == null || adding is Outcome.Done) added?.let { Text(it, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 4.dp)) }
    for (outcome in listOf(adding, removing)) {
        (outcome as? Outcome.Failed)?.let { Text(it.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
    }
}

/**
 * Settings' "Calendar export", as on the web: a link calendar apps
 * subscribe to, created, copied, added to Google Calendar or opened in a
 * calendar app, replaced or turned off.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CalendarExportSection(viewModel: TripsViewModel) {
    val record by viewModel.calendarExport.collectAsStateWithLifecycle()
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    val outcome = outcomes[EXPORT_TOKEN]
    val busy = outcome is Outcome.Busy
    val context = LocalContext.current
    // Which change is waiting for the user to confirm it: replace or turn off.
    var confirming by rememberSaveable { mutableStateOf<Boolean?>(null) }
    LaunchedEffect(outcome) { if (outcome is Outcome.Done) viewModel.outcomeSeen(EXPORT_TOKEN) }
    val shown = record ?: return
    if (!viewModel.canExport) return
    Text(stringResource(R.string.calendar_export), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
    Text(stringResource(R.string.calendar_export_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    val token = shown.token
    if (token == null) {
        Button(onClick = { viewModel.issueCalendarExport(EXPORT_TOKEN) }, enabled = !busy, modifier = Modifier.padding(top = 8.dp)) {
            Text(stringResource(if (busy) R.string.creating else R.string.create_calendar_link))
        }
    } else {
        val links = viewModel.exportLinksFor(token)
        SelectionContainer { Text(links.https, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(top = 8.dp)) }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 4.dp)) {
            OutlinedButton(onClick = { copyToClipboard(context, R.string.calendar_export, links.https) }) { Text(stringResource(R.string.copy_link)) }
            OutlinedButton(onClick = { openLink(context, links.google, "Google Calendar's add-by-link page") }) { Text(stringResource(R.string.add_to_google_calendar)) }
            OutlinedButton(onClick = { openLink(context, links.webcal, "the calendar link in a calendar app") }) { Text(stringResource(R.string.open_in_calendar_app)) }
            OutlinedButton(onClick = { confirming = true }, enabled = !busy) { Text(stringResource(R.string.replace_link)) }
            OutlinedButton(onClick = { confirming = false }, enabled = !busy) { Text(stringResource(R.string.turn_off)) }
        }
    }
    (outcome as? Outcome.Failed)?.let { Text(it.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
    confirming?.let { replace ->
        AppAlertDialog(
            onDismissRequest = { confirming = null },
            text = { Text(stringResource(if (replace) R.string.replace_export_confirm else R.string.stop_export_confirm)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirming = null
                        if (replace) viewModel.issueCalendarExport(EXPORT_TOKEN) else viewModel.stopCalendarExport(EXPORT_TOKEN)
                    },
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                ) { Text(stringResource(if (replace) R.string.replace_link else R.string.turn_off)) }
            },
            dismissButton = { TextButton(onClick = { confirming = null }) { Text(stringResource(R.string.keep)) } },
        )
    }
}

/**
 * Settings' "Forward by email", as on the web: the user's own address to
 * forward bookings to, created, copied, replaced or turned off. Shown when
 * the deployment has a forwarding domain, or the user already has one.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ForwardSection(viewModel: TripsViewModel) {
    val forwarding by viewModel.forwarding.collectAsStateWithLifecycle()
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    val outcome = outcomes[FORWARD_TOKEN]
    val busy = outcome is Outcome.Busy
    val context = LocalContext.current
    // Which change is waiting for the user to confirm it: replace or turn off.
    var confirming by rememberSaveable { mutableStateOf<Boolean?>(null) }
    LaunchedEffect(outcome) { if (outcome is Outcome.Done) viewModel.outcomeSeen(FORWARD_TOKEN) }
    val shown = forwarding ?: return
    if (!viewModel.canForward(shown)) return
    Text(stringResource(R.string.forward_by_email), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
    Text(stringResource(R.string.forward_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    val address = shown.address
    if (address == null) {
        Button(onClick = { viewModel.issueForward(FORWARD_TOKEN) }, enabled = !busy, modifier = Modifier.padding(top = 8.dp)) {
            Text(stringResource(if (busy) R.string.creating else R.string.create_forwarding_address))
        }
    } else {
        SelectionContainer { Text(address, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(top = 8.dp)) }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 4.dp)) {
            OutlinedButton(onClick = { copyToClipboard(context, R.string.forward_by_email, address) }) { Text(stringResource(R.string.copy_address)) }
            OutlinedButton(onClick = { confirming = true }, enabled = !busy) { Text(stringResource(R.string.replace_address)) }
            OutlinedButton(onClick = { confirming = false }, enabled = !busy) { Text(stringResource(R.string.turn_off)) }
        }
    }
    (outcome as? Outcome.Failed)?.let { Text(it.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
    confirming?.let { replace ->
        AppAlertDialog(
            onDismissRequest = { confirming = null },
            text = { Text(stringResource(if (replace) R.string.replace_forward_confirm else R.string.stop_forward_confirm)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirming = null
                        if (replace) viewModel.issueForward(FORWARD_TOKEN) else viewModel.stopForward(FORWARD_TOKEN)
                    },
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                ) { Text(stringResource(if (replace) R.string.replace_address else R.string.turn_off)) }
            },
            dismissButton = { TextButton(onClick = { confirming = null }) { Text(stringResource(R.string.keep)) } },
        )
    }
}

/** Puts [text] on the clipboard, labeled [label]; Android confirms the copy itself. */
private fun copyToClipboard(context: Context, @StringRes label: Int, text: String) {
    val clipboard = context.getSystemService(ClipboardManager::class.java)
    if (clipboard == null) {
        TravelmoLog.warning("No clipboard to copy to")
        return
    }
    clipboard.setPrimaryClip(ClipData.newPlainText(context.getString(label), text))
}

/**
 * Settings' "Car and ride companies", as on the web: the user's own, which
 * trip pages offer on flights with no car or ride booked, each for rides
 * to and from home or for a car wherever a flight lands.
 */
@Composable
private fun RideCompaniesSection(viewModel: TripsViewModel) {
    val settings by viewModel.rideSettings.collectAsStateWithLifecycle()
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    val adding = outcomes[ADD_COMPANY_TOKEN]
    val removing = outcomes[REMOVE_COMPANY_TOKEN]
    val busy = adding is Outcome.Busy || removing is Outcome.Busy
    var name by rememberSaveable { mutableStateOf("") }
    var url by rememberSaveable { mutableStateOf("") }
    var near by rememberSaveable { mutableStateOf(RideNear.HOME) }
    var countries by rememberSaveable { mutableStateOf("") }
    // What is wrong with the company as typed, and the text it names, if any.
    var invalid by rememberSaveable { mutableStateOf<Int?>(null) }
    var invalidText by rememberSaveable { mutableStateOf<String?>(null) }
    val context = LocalContext.current
    LaunchedEffect(adding) {
        if (adding is Outcome.Done) {
            name = ""
            url = ""
            countries = ""
            viewModel.outcomeSeen(ADD_COMPANY_TOKEN)
        }
    }
    LaunchedEffect(removing) { if (removing is Outcome.Done) viewModel.outcomeSeen(REMOVE_COMPANY_TOKEN) }
    val companies = settings?.companies ?: return
    Text(stringResource(R.string.ride_companies), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
    Text(stringResource(R.string.ride_companies_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    val nearLabel = { where: RideNear -> if (where == RideNear.HOME) R.string.rides_home else R.string.cars_anywhere }
    for (company in companies) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    company.name,
                    style = MaterialTheme.typography.bodyLarge.copy(textDecoration = TextDecoration.Underline),
                    modifier = Modifier.clickable(onClickLabel = stringResource(R.string.open_company, company.name)) { openLink(context, company.url, "a car or ride company") },
                )
                Text(
                    (listOf(stringResource(nearLabel(company.near))) + company.countries.map(::countryName).joinToString(", ").ifEmpty { null }).filterNotNull().joinToString(" · "),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            IconButton(onClick = { viewModel.removeRideCompany(REMOVE_COMPANY_TOKEN, company) }, enabled = !busy) {
                Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.remove_company, company.name))
            }
        }
    }
    OutlinedTextField(
        value = name,
        onValueChange = { name = it; invalid = null },
        label = { Text(stringResource(R.string.company_name)) },
        singleLine = true,
        enabled = !busy,
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
    )
    OutlinedTextField(
        value = url,
        onValueChange = { url = it; invalid = null },
        label = { Text(stringResource(R.string.booking_page)) },
        placeholder = { Text("https://…") },
        singleLine = true,
        enabled = !busy,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
    )
    OutlinedTextField(
        value = countries,
        onValueChange = { countries = it; invalid = null },
        label = { Text(stringResource(R.string.company_countries)) },
        placeholder = { Text(stringResource(R.string.company_countries_hint)) },
        singleLine = true,
        enabled = !busy,
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
    )
    Column(modifier = Modifier.selectableGroup().padding(top = 4.dp)) {
        for (where in RideNear.entries) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth().selectable(selected = near == where, enabled = !busy, role = Role.RadioButton) { near = where },
            ) {
                RadioButton(selected = near == where, onClick = null, enabled = !busy)
                Text(stringResource(nearLabel(where)), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(start = 12.dp, top = 12.dp, bottom = 12.dp))
            }
        }
    }
    Button(
        onClick = {
            val where = parseCountries(countries)
            val company = (where as? ParsedCountries.Countries)?.let { rideCompanyOrNull(name, url, near.wire, it.codes) }
            invalid = when {
                name.isBlank() -> R.string.enter_a_name
                where is ParsedCountries.Unknown -> R.string.not_a_country
                company == null -> R.string.use_https_link
                else -> null
            }
            invalidText = (where as? ParsedCountries.Unknown)?.text
            if (company != null) viewModel.addRideCompany(ADD_COMPANY_TOKEN, company)
        },
        enabled = !busy && name.isNotBlank() && url.isNotBlank() && companies.size < MAX_RIDE_COMPANIES,
        modifier = Modifier.padding(top = 4.dp),
    ) { Text(stringResource(R.string.add)) }
    invalid?.let { Text(invalidText?.let { text -> stringResource(it, text) } ?: stringResource(it), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
    for (outcome in listOf(adding, removing)) {
        (outcome as? Outcome.Failed)?.let { Text(it.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
    }
}

/**
 * Settings' "Sender rules", as on the web: two lists of domains, one a
 * line, saved together. What is typed stays until saved; the stored lists
 * show otherwise.
 */
@Composable
private fun SenderRulesSection(viewModel: TripsViewModel) {
    val saved by viewModel.senderPatterns.collectAsStateWithLifecycle()
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    val outcome = outcomes[SENDER_RULES_TOKEN]
    var allow by rememberSaveable { mutableStateOf<String?>(null) }
    var deny by rememberSaveable { mutableStateOf<String?>(null) }
    var said by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(outcome) {
        if (outcome is Outcome.Done) {
            allow = null
            deny = null
            said = true
            viewModel.outcomeSeen(SENDER_RULES_TOKEN)
        }
    }
    val stored = saved ?: return
    Text(stringResource(R.string.sender_rules), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
    Text(stringResource(R.string.sender_rules_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    OutlinedTextField(
        value = allow ?: stored.allow.joinToString("\n"),
        onValueChange = { allow = it; said = false },
        // Locked while saving, so nothing typed then is lost when the save clears the edit.
        enabled = outcome !is Outcome.Busy,
        label = { Text(stringResource(R.string.always_import_list)) },
        placeholder = { Text("cove.example") },
        minLines = 3,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
    )
    OutlinedTextField(
        value = deny ?: stored.deny.joinToString("\n"),
        onValueChange = { deny = it; said = false },
        enabled = outcome !is Outcome.Busy,
        label = { Text(stringResource(R.string.never_import_list)) },
        placeholder = { Text("newsletters.example") },
        minLines = 3,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
    )
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(top = 8.dp)) {
        Button(
            onClick = { viewModel.saveSenderPatterns(SENDER_RULES_TOKEN, allow ?: stored.allow.joinToString("\n"), deny ?: stored.deny.joinToString("\n")) },
            enabled = (allow != null || deny != null) && outcome !is Outcome.Busy,
        ) { Text(stringResource(R.string.save)) }
        if (said) Text(stringResource(R.string.saved), style = MaterialTheme.typography.bodyMedium)
    }
    (outcome as? Outcome.Failed)?.let { Text(it.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
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
 * the browser, which hands back to Travelmo there; once connected, each
 * mailbox as a [MailboxRow]; then Connect another Gmail account, up to the
 * limit.
 */
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
            Text(stringResource(R.string.gmail_connected_hint), style = MaterialTheme.typography.bodyMedium)
            for (mailbox in state.mailboxes) {
                val address = mailbox.emailAddress
                MailboxRow(
                    mailbox,
                    busy = busy,
                    onStart = { restart -> viewModel.startReading(GMAIL_TOKEN, address, restart) },
                    onStop = { viewModel.stopReading(GMAIL_TOKEN, address) },
                    onDisconnect = { viewModel.disconnectGmail(GMAIL_TOKEN, address) },
                )
            }
            if (state.canConnectMore) {
                OutlinedButton(onClick = { viewModel.connectGmail(GMAIL_TOKEN) }, enabled = !busy, modifier = Modifier.padding(top = 16.dp)) {
                    Text(stringResource(R.string.connect_another_gmail))
                }
            } else {
                Text(
                    pluralStringResource(R.plurals.gmail_limit, MAX_GMAIL_MAILBOXES, MAX_GMAIL_MAILBOXES),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 16.dp),
                )
            }
        }
    }
    (outcome as? Outcome.Failed)?.let {
        Text(it.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp))
    }
}

/**
 * Settings' "Fastmail": Fastmail has no consent page for other apps, so the
 * user makes a read-only API token in Fastmail's settings and pastes it here;
 * the parser refuses one that could change mail. Once connected, the same
 * past-bookings controls as Gmail. Travelmo can't revoke the token, so
 * Settings says to delete it in Fastmail after disconnecting.
 */
@Composable
private fun FastmailSection(viewModel: TripsViewModel) {
    val context = LocalContext.current
    val fastmail by viewModel.fastmail.collectAsStateWithLifecycle()
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    val outcome = outcomes[FASTMAIL_TOKEN]
    val disconnecting = outcomes[FASTMAIL_DISCONNECT_TOKEN]
    val busy = outcome is Outcome.Busy || disconnecting is Outcome.Busy
    // Not saveable: the token stays out of the saved instance state, and is
    // cleared once the parser has it.
    var apiToken by remember { mutableStateOf("") }
    var disconnected by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(outcome) {
        if (outcome is Outcome.Done) {
            apiToken = ""
            viewModel.outcomeSeen(FASTMAIL_TOKEN)
        }
    }
    LaunchedEffect(disconnecting) {
        if (disconnecting is Outcome.Done) {
            disconnected = true
            viewModel.outcomeSeen(FASTMAIL_DISCONNECT_TOKEN)
        }
    }
    Text(stringResource(R.string.fastmail), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
    if (!viewModel.canUseFastmail) {
        Text(stringResource(R.string.fastmail_on_web), style = MaterialTheme.typography.bodyMedium)
        return
    }
    when (val state = fastmail) {
        TripsViewModel.FastmailState.Loading -> Text(stringResource(R.string.loading), style = MaterialTheme.typography.bodyMedium)
        TripsViewModel.FastmailState.NotConnected -> {
            if (disconnected) Text(stringResource(R.string.fastmail_disconnected), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(bottom = 8.dp))
            Text(stringResource(R.string.fastmail_connect_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            TextButton(onClick = { openLink(context, FASTMAIL_TOKENS_URL, "Fastmail API tokens") }) { Text(stringResource(R.string.fastmail_tokens)) }
            OutlinedTextField(
                value = apiToken,
                onValueChange = { apiToken = it },
                label = { Text(stringResource(R.string.fastmail_token)) },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false),
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                onClick = {
                    disconnected = false
                    viewModel.connectFastmail(FASTMAIL_TOKEN, apiToken)
                },
                enabled = !busy && apiToken.isNotBlank(),
                modifier = Modifier.padding(top = 8.dp),
            ) {
                Text(stringResource(R.string.connect_fastmail))
            }
        }
        is TripsViewModel.FastmailState.Connected -> {
            Text(stringResource(R.string.fastmail_connected_hint), style = MaterialTheme.typography.bodyMedium)
            MailboxRow(
                state.mailbox,
                busy = busy,
                onStart = { restart -> viewModel.startFastmailReading(FASTMAIL_TOKEN, restart) },
                onStop = { viewModel.stopFastmailReading(FASTMAIL_TOKEN) },
                onDisconnect = {
                    disconnected = false
                    viewModel.disconnectFastmail(FASTMAIL_DISCONNECT_TOKEN)
                },
            )
            Text(stringResource(R.string.fastmail_delete_token), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
        }
    }
    for (o in listOf(outcome, disconnecting)) {
        (o as? Outcome.Failed)?.let {
            Text(it.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp))
        }
    }
}

/**
 * One connected mailbox, Gmail or Fastmail: its address, Import past
 * bookings (Continue, or Read again from the start once done) or Stop while
 * it reads, Disconnect, and how far its reading got, which the parser
 * records as it goes.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MailboxRow(
    mailbox: TripsViewModel.MailboxShown,
    busy: Boolean,
    onStart: (restart: Boolean) -> Unit,
    onStop: () -> Unit,
    onDisconnect: () -> Unit,
) {
    val progress = mailbox.progress
    Text(mailbox.emailAddress, style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 16.dp))
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 4.dp)) {
        if (mailbox.reading) {
            OutlinedButton(onClick = onStop, enabled = !busy) { Text(stringResource(R.string.stop)) }
        } else {
            OutlinedButton(onClick = { onStart(progress?.done == true) }, enabled = !busy) {
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
        OutlinedButton(onClick = onDisconnect, enabled = !busy) { Text(stringResource(R.string.disconnect)) }
    }
    progress?.let {
        Text(describeBackfill(it, mailbox.reading), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
    }
    pausedReason(progress, mailbox.reading)?.let {
        Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 4.dp))
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
 * The invite-only screen offers it too, since Settings needs access.
 */
@Composable
internal fun DeleteAccountSection(account: GoogleAccount, viewModel: TripsViewModel, token: String = DELETE_ACCOUNT_TOKEN) {
    val context = LocalContext.current
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    val outcome = outcomes[token]
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
                        viewModel.deleteAccount(token) { account.signOutDeleted(appContext) }
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
