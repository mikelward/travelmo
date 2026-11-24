package app.travelmo.ui

import app.travelmo.shared.try_again
import app.travelmo.shared.add_it_yourself
import app.travelmo.shared.open_in_gmail
import app.travelmo.core.ParsedRecord
import androidx.compose.runtime.produceState
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
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.travelmo.auth.SignedIn
import app.travelmo.core.EmailRowKind
import app.travelmo.core.ICLOUD_IMAP
import app.travelmo.core.ImapServerChoice
import app.travelmo.core.MAX_GMAIL_MAILBOXES
import app.travelmo.core.MAX_IMAP_MAILBOXES
import app.travelmo.core.MAX_RIDE_COMPANIES
import app.travelmo.core.ParsedCountries
import app.travelmo.core.REFRESH_BLURB
import app.travelmo.core.RideNear
import app.travelmo.core.YAHOO_IMAP
import app.travelmo.core.countryName
import app.travelmo.core.describeBackfill
import app.travelmo.core.describeRefresh
import app.travelmo.core.emailRows
import app.travelmo.core.imapRedirect
import app.travelmo.core.imapServerFor
import app.travelmo.core.parseCountries
import app.travelmo.core.pausedReason
import app.travelmo.core.refreshButton
import app.travelmo.core.failedEmailIds
import app.travelmo.core.failedEmailLine
import app.travelmo.core.failedEmailsReport
import app.travelmo.core.gmailSourceLink
import app.travelmo.core.moreFailedEmails
import app.travelmo.core.rideCompanyOrNull
import app.travelmo.shared.Res
import app.travelmo.shared.add
import app.travelmo.shared.add_feed
import app.travelmo.shared.add_to_google_calendar
import app.travelmo.shared.always_import_list
import app.travelmo.shared.back
import app.travelmo.shared.booking_page
import app.travelmo.shared.calendar_export
import app.travelmo.shared.calendar_export_hint
import app.travelmo.shared.calendar_feed_link
import app.travelmo.shared.calendar_feeds
import app.travelmo.shared.calendar_feeds_hint
import app.travelmo.shared.calendars_saved_read
import app.travelmo.shared.cars_anywhere
import app.travelmo.shared.company_countries
import app.travelmo.shared.company_countries_hint
import app.travelmo.shared.company_name
import app.travelmo.shared.connect_another_gmail
import app.travelmo.shared.connect_fastmail
import app.travelmo.shared.connect_gmail
import app.travelmo.shared.connect_google_calendar
import app.travelmo.shared.connect_imap
import app.travelmo.shared.connected_as
import app.travelmo.shared.continue_reading
import app.travelmo.shared.copy_address
import app.travelmo.shared.copy_link
import app.travelmo.shared.create_calendar_link
import app.travelmo.shared.create_forwarding_address
import app.travelmo.shared.creating
import app.travelmo.shared.debug_log
import app.travelmo.shared.debug_log_hint
import app.travelmo.shared.debug_log_record
import app.travelmo.shared.delete
import app.travelmo.shared.delete_account
import app.travelmo.shared.delete_account_confirm
import app.travelmo.shared.delete_account_confirm_title
import app.travelmo.shared.delete_account_hint
import app.travelmo.shared.delete_account_on_web
import app.travelmo.shared.delete_all_trips
import app.travelmo.shared.delete_all_trips_confirm
import app.travelmo.shared.delete_all_trips_title
import app.travelmo.shared.delete_n_trips
import app.travelmo.shared.deleting
import app.travelmo.shared.disconnect
import app.travelmo.shared.email_addresses
import app.travelmo.shared.email_addresses_hint
import app.travelmo.shared.email_gmail
import app.travelmo.shared.email_link_sent
import app.travelmo.shared.email_me
import app.travelmo.shared.email_me_to
import app.travelmo.shared.email_pending
import app.travelmo.shared.email_sign_in
import app.travelmo.shared.emails_on_web
import app.travelmo.shared.enter_a_name
import app.travelmo.shared.fastmail
import app.travelmo.shared.fastmail_connect_hint
import app.travelmo.shared.fastmail_connected_hint
import app.travelmo.shared.fastmail_delete_token
import app.travelmo.shared.fastmail_disconnected
import app.travelmo.shared.fastmail_on_web
import app.travelmo.shared.fastmail_token
import app.travelmo.shared.fastmail_tokens
import app.travelmo.shared.feed_not_read
import app.travelmo.shared.feed_read_on
import app.travelmo.shared.feeds_on_web
import app.travelmo.shared.forward_by_email
import app.travelmo.shared.forward_hint
import app.travelmo.shared.gmail
import app.travelmo.shared.gmail_connect_hint
import app.travelmo.shared.gmail_connected_hint
import app.travelmo.shared.gmail_limit
import app.travelmo.shared.gmail_on_web
import app.travelmo.shared.google_calendar
import app.travelmo.shared.google_calendar_hint
import app.travelmo.shared.google_calendar_on_web
import app.travelmo.shared.imap
import app.travelmo.shared.imap_address
import app.travelmo.shared.imap_connect_hint
import app.travelmo.shared.imap_disconnected
import app.travelmo.shared.imap_icloud_passwords
import app.travelmo.shared.imap_limit
import app.travelmo.shared.imap_login_failed
import app.travelmo.shared.imap_on_web
import app.travelmo.shared.imap_password
import app.travelmo.shared.imap_server
import app.travelmo.shared.imap_server_example
import app.travelmo.shared.imap_yahoo_passwords
import app.travelmo.shared.import_past_bookings
import app.travelmo.shared.import_review
import app.travelmo.shared.import_review_hint
import app.travelmo.shared.keep
import app.travelmo.shared.loading
import app.travelmo.shared.never_import_list
import app.travelmo.shared.not_a_country
import app.travelmo.shared.notifications_blocked
import app.travelmo.shared.notify_me
import app.travelmo.shared.open_company
import app.travelmo.shared.open_import_review
import app.travelmo.shared.open_in_calendar_app
import app.travelmo.shared.pinch_to_resize
import app.travelmo.shared.read_again_from_start
import app.travelmo.shared.reading
import app.travelmo.shared.regroup_hint
import app.travelmo.shared.regroup_trips
import app.travelmo.shared.regrouping
import app.travelmo.shared.reminders
import app.travelmo.shared.reminders_hint
import app.travelmo.shared.remove_company
import app.travelmo.shared.remove_email
import app.travelmo.shared.remove_feed
import app.travelmo.shared.replace_address
import app.travelmo.shared.replace_export_confirm
import app.travelmo.shared.replace_forward_confirm
import app.travelmo.shared.replace_link
import app.travelmo.shared.ride_companies
import app.travelmo.shared.ride_companies_hint
import app.travelmo.shared.rides_home
import app.travelmo.shared.save
import app.travelmo.shared.save_choice
import app.travelmo.shared.saved
import app.travelmo.shared.sender_rules
import app.travelmo.shared.sender_rules_hint
import app.travelmo.shared.setting_not_saved
import app.travelmo.shared.settings
import app.travelmo.shared.share_debug_log
import app.travelmo.shared.sharing
import app.travelmo.shared.sign_out
import app.travelmo.shared.signed_in_as
import app.travelmo.shared.stop
import app.travelmo.shared.stop_export_confirm
import app.travelmo.shared.stop_forward_confirm
import app.travelmo.shared.text_size
import app.travelmo.shared.text_size_hint
import app.travelmo.shared.text_size_larger
import app.travelmo.shared.text_size_smaller
import app.travelmo.shared.text_size_value
import app.travelmo.shared.trips_on_web
import app.travelmo.shared.trips_section
import app.travelmo.shared.turn_off
import app.travelmo.shared.use_https_link
import app.travelmo.shared.version
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.pluralStringResource
import org.jetbrains.compose.resources.stringResource

private const val REMINDER_TOKEN = "settings/reminders/email"
private const val SETTINGS_DELETE_ACCOUNT_TOKEN = "settings/account/delete"
private const val GMAIL_TOKEN = "settings/gmail"
private const val FASTMAIL_TOKEN = "settings/fastmail"
private const val FASTMAIL_DISCONNECT_TOKEN = "settings/fastmail/disconnect"
private const val IMAP_TOKEN = "settings/imap"
private const val IMAP_CONNECT_TOKEN = "settings/imap/connect"
private const val IMAP_DISCONNECT_TOKEN = "settings/imap/disconnect"

/** Where Fastmail users make (and later delete) the API token Travelmo reads with. */
private const val FASTMAIL_TOKENS_URL = "https://app.fastmail.com/settings/security/tokens"
private const val REGROUP_TOKEN = "settings/trips/regroup"
private const val REFRESH_TOKEN = "settings/trips/refresh"
private const val REFRESH_STOP_TOKEN = "settings/trips/refresh/stop"
private const val DELETE_TRIPS_TOKEN = "settings/trips/delete"
private const val ADD_EMAIL_TOKEN = "settings/emails/add"
private const val REMOVE_EMAIL_TOKEN = "settings/emails/remove"
private const val SENDER_RULES_TOKEN = "settings/senders"
private const val FORWARD_TOKEN = "settings/forward"
private const val EXPORT_TOKEN = "settings/export"
private const val CALENDAR_TOKEN = "settings/calendar"
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
fun SettingsScreen(
    account: SignedInAccount,
    user: SignedIn,
    viewModel: TripsViewModel,
    onBack: () -> Unit,
    onOpenReview: () -> Unit = {},
    onAddBooking: (defaultDate: String) -> Unit = {},
) {
    val chrome = LocalAppChrome.current
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
            AppTopBar(stringResource(Res.string.settings), navigation = TopBarNavigation.Back(onBack))
        },
    ) { padding ->
        // Scrolls, so a short window with large text still reaches every control.
        val scroll = rememberScrollState()
        Column(modifier = Modifier.fillMaxSize().padding(padding).scrollEdgeCue(scroll, scrollCueColors()).verticalScroll(scroll).padding(16.dp)) {
            Text(stringResource(Res.string.signed_in_as, user.email ?: user.uid), style = MaterialTheme.typography.bodyLarge)
            OutlinedButton(onClick = { scope.launch { account.signOut() } }, modifier = Modifier.padding(top = 12.dp)) {
                Text(stringResource(Res.string.sign_out))
            }
            GmailSection(viewModel)
            FastmailSection(viewModel)
            ImapSection(viewModel)
            TripsSection(viewModel, onAddBooking)
            FeedsSection(viewModel)
            GoogleCalendarSection(viewModel)
            CalendarExportSection(viewModel)
            Text(stringResource(Res.string.import_review), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
            Text(stringResource(Res.string.import_review_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedButton(onClick = onOpenReview, modifier = Modifier.padding(top = 8.dp)) { Text(stringResource(Res.string.open_import_review)) }
            SenderRulesSection(viewModel)
            RideCompaniesSection(viewModel)
            EmailAddressesSection(user, viewModel)
            ForwardSection(viewModel)
            Text(stringResource(Res.string.reminders), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
            Text(stringResource(Res.string.reminders_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
                Text(
                    if (user.email != null) stringResource(Res.string.email_me_to, user.email) else stringResource(Res.string.email_me),
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
            chrome.PushSettings(viewModel)
            TripRemindersSection(viewModel)
            chrome.DeviceSettings()
            DeleteAccountSection(account, viewModel, SETTINGS_DELETE_ACCOUNT_TOKEN)
            Text(
                stringResource(Res.string.version, chrome.versionName),
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
    Text(stringResource(Res.string.calendar_feeds), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
    Text(stringResource(Res.string.calendar_feeds_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    for (feed in list) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
            Column(modifier = Modifier.weight(1f)) {
                Text(feed.name, style = MaterialTheme.typography.bodyLarge)
                val read = feed.lastFetchedAt?.let { stringResource(Res.string.feed_read_on, it.take(10)) } ?: stringResource(Res.string.feed_not_read)
                Text(
                    listOfNotNull(read, feed.lastResult?.takeIf { feed.lastError == null }).joinToString(" · "),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                feed.lastError?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error) }
            }
            if (viewModel.canEditFeeds) {
                IconButton(onClick = { viewModel.removeFeed(REMOVE_FEED_TOKEN, feed.id) }, enabled = !busy) {
                    Icon(Icons.Filled.Close, contentDescription = stringResource(Res.string.remove_feed, feed.name))
                }
            }
        }
    }
    if (!viewModel.canEditFeeds) {
        Text(stringResource(Res.string.feeds_on_web), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp))
        return
    }
    OutlinedTextField(
        value = url,
        onValueChange = { url = it },
        label = { Text(stringResource(Res.string.calendar_feed_link)) },
        placeholder = { Text("webcal://… or https://…") },
        singleLine = true,
        enabled = !busy,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
    )
    Button(onClick = { viewModel.addFeed(ADD_FEED_TOKEN, url) }, enabled = !busy && url.isNotBlank(), modifier = Modifier.padding(top = 8.dp)) {
        Text(stringResource(if (adding is Outcome.Busy) Res.string.reading else Res.string.add_feed))
    }
    if (adding == null || adding is Outcome.Done) added?.let { Text(it, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 4.dp)) }
    for (outcome in listOf(adding, removing)) {
        (outcome as? Outcome.Failed)?.let { Text(it.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
    }
}

/**
 * Settings' "Google Calendar", as on the web: Connect opens Google's consent
 * page in the browser, which hands back to Travelmo there; once connected,
 * the account's calendars to tick, each read one with what its last read
 * did, Save choice and Disconnect.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun GoogleCalendarSection(viewModel: TripsViewModel) {
    val chrome = LocalAppChrome.current
    val shown by viewModel.googleCalendar.collectAsStateWithLifecycle()
    val consent by viewModel.calendarConsentUrl.collectAsStateWithLifecycle()
    val saved by viewModel.calendarSaved.collectAsStateWithLifecycle()
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    val outcome = outcomes[CALENDAR_TOKEN]
    val busy = outcome is Outcome.Busy
    // The ticks as changed here, until saved; the stored choice otherwise.
    var draft by rememberSaveable { mutableStateOf<List<String>?>(null) }
    LaunchedEffect(consent) {
        consent?.let {
            chrome.openLink(it, "Google Calendar consent")
            viewModel.calendarConsentOpened()
        }
    }
    LaunchedEffect(outcome) {
        if (outcome is Outcome.Done) {
            draft = null
            viewModel.outcomeSeen(CALENDAR_TOKEN)
        }
    }
    val state = shown ?: return
    Text(stringResource(Res.string.google_calendar), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
    Text(stringResource(Res.string.google_calendar_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    val connection = state.connection
    if (!viewModel.canConnectCalendar) {
        Text(stringResource(Res.string.google_calendar_on_web), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp))
        return
    }
    if (connection == null) {
        Button(onClick = { viewModel.connectCalendar(CALENDAR_TOKEN) }, enabled = !busy, modifier = Modifier.padding(top = 8.dp)) {
            Text(stringResource(Res.string.connect_google_calendar))
        }
    } else {
        Text(stringResource(Res.string.connected_as, connection.emailAddress), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(top = 8.dp))
        val stored = connection.calendars.filter { it.selected }.map { it.id }.toSet()
        val chosen = draft?.toSet() ?: stored
        Column(modifier = Modifier.selectableGroup().padding(top = 4.dp)) {
            for (calendar in connection.calendars) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.fillMaxWidth().toggleable(value = calendar.id in chosen, enabled = !busy, role = Role.Checkbox) { on ->
                        draft = (if (on) chosen + calendar.id else chosen - calendar.id).toList()
                    },
                ) {
                    Checkbox(checked = calendar.id in chosen, onCheckedChange = null, enabled = !busy)
                    Column(modifier = Modifier.padding(start = 12.dp, top = 8.dp, bottom = 8.dp)) {
                        Text(calendar.summary, style = MaterialTheme.typography.bodyLarge)
                        if (calendar.selected) {
                            calendar.lastError?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error) }
                                ?: calendar.lastReadAt?.let { read ->
                                    Text(
                                        listOfNotNull(stringResource(Res.string.feed_read_on, read.take(10)), calendar.lastResult).joinToString(" · "),
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                        }
                    }
                }
            }
        }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 4.dp)) {
            Button(onClick = { viewModel.selectCalendars(CALENDAR_TOKEN, chosen.toList()) }, enabled = !busy && chosen != stored) {
                Text(stringResource(if (busy && draft != null) Res.string.reading else Res.string.save_choice))
            }
            OutlinedButton(onClick = { draft = null; viewModel.disconnectCalendar(CALENDAR_TOKEN) }, enabled = !busy) { Text(stringResource(Res.string.disconnect)) }
        }
        saved?.let { Text(stringResource(if (it) Res.string.calendars_saved_read else Res.string.saved), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 4.dp)) }
    }
    (outcome as? Outcome.Failed)?.let { Text(it.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
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
    val chrome = LocalAppChrome.current
    // Which change is waiting for the user to confirm it: replace or turn off.
    var confirming by rememberSaveable { mutableStateOf<Boolean?>(null) }
    LaunchedEffect(outcome) { if (outcome is Outcome.Done) viewModel.outcomeSeen(EXPORT_TOKEN) }
    val shown = record ?: return
    if (!viewModel.canExport) return
    Text(stringResource(Res.string.calendar_export), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
    Text(stringResource(Res.string.calendar_export_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    val token = shown.token
    if (token == null) {
        Button(onClick = { viewModel.issueCalendarExport(EXPORT_TOKEN) }, enabled = !busy, modifier = Modifier.padding(top = 8.dp)) {
            Text(stringResource(if (busy) Res.string.creating else Res.string.create_calendar_link))
        }
    } else {
        val links = viewModel.exportLinksFor(token)
        SelectionContainer { Text(links.https, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(top = 8.dp)) }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 4.dp)) {
            val exportLabel = stringResource(Res.string.calendar_export)
            OutlinedButton(onClick = { chrome.copyToClipboard(exportLabel, links.https) }) { Text(stringResource(Res.string.copy_link)) }
            OutlinedButton(onClick = { chrome.openLink(links.google, "Google Calendar's add-by-link page") }) { Text(stringResource(Res.string.add_to_google_calendar)) }
            OutlinedButton(onClick = { chrome.openLink(links.webcal, "the calendar link in a calendar app") }) { Text(stringResource(Res.string.open_in_calendar_app)) }
            OutlinedButton(onClick = { confirming = true }, enabled = !busy) { Text(stringResource(Res.string.replace_link)) }
            OutlinedButton(onClick = { confirming = false }, enabled = !busy) { Text(stringResource(Res.string.turn_off)) }
        }
    }
    (outcome as? Outcome.Failed)?.let { Text(it.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
    confirming?.let { replace ->
        AppAlertDialog(
            onDismissRequest = { confirming = null },
            text = { Text(stringResource(if (replace) Res.string.replace_export_confirm else Res.string.stop_export_confirm)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirming = null
                        if (replace) viewModel.issueCalendarExport(EXPORT_TOKEN) else viewModel.stopCalendarExport(EXPORT_TOKEN)
                    },
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                ) { Text(stringResource(if (replace) Res.string.replace_link else Res.string.turn_off)) }
            },
            dismissButton = { TextButton(onClick = { confirming = null }) { Text(stringResource(Res.string.keep)) } },
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
    val chrome = LocalAppChrome.current
    // Which change is waiting for the user to confirm it: replace or turn off.
    var confirming by rememberSaveable { mutableStateOf<Boolean?>(null) }
    LaunchedEffect(outcome) { if (outcome is Outcome.Done) viewModel.outcomeSeen(FORWARD_TOKEN) }
    val shown = forwarding ?: return
    if (!viewModel.canForward(shown)) return
    Text(stringResource(Res.string.forward_by_email), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
    Text(stringResource(Res.string.forward_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    val address = shown.address
    if (address == null) {
        Button(onClick = { viewModel.issueForward(FORWARD_TOKEN) }, enabled = !busy, modifier = Modifier.padding(top = 8.dp)) {
            Text(stringResource(if (busy) Res.string.creating else Res.string.create_forwarding_address))
        }
    } else {
        SelectionContainer { Text(address, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(top = 8.dp)) }
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 4.dp)) {
            val forwardLabel = stringResource(Res.string.forward_by_email)
            OutlinedButton(onClick = { chrome.copyToClipboard(forwardLabel, address) }) { Text(stringResource(Res.string.copy_address)) }
            OutlinedButton(onClick = { confirming = true }, enabled = !busy) { Text(stringResource(Res.string.replace_address)) }
            OutlinedButton(onClick = { confirming = false }, enabled = !busy) { Text(stringResource(Res.string.turn_off)) }
        }
    }
    (outcome as? Outcome.Failed)?.let { Text(it.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
    confirming?.let { replace ->
        AppAlertDialog(
            onDismissRequest = { confirming = null },
            text = { Text(stringResource(if (replace) Res.string.replace_forward_confirm else Res.string.stop_forward_confirm)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirming = null
                        if (replace) viewModel.issueForward(FORWARD_TOKEN) else viewModel.stopForward(FORWARD_TOKEN)
                    },
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                ) { Text(stringResource(if (replace) Res.string.replace_address else Res.string.turn_off)) }
            },
            dismissButton = { TextButton(onClick = { confirming = null }) { Text(stringResource(Res.string.keep)) } },
        )
    }
}

/** What is wrong with a car or ride company as typed: an enum, so it survives recreation. */
private enum class CompanyProblem(val text: StringResource) {
    NO_NAME(Res.string.enter_a_name),
    UNKNOWN_COUNTRY(Res.string.not_a_country),
    NOT_HTTPS(Res.string.use_https_link),
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
    var invalid by rememberSaveable { mutableStateOf<CompanyProblem?>(null) }
    var invalidText by rememberSaveable { mutableStateOf<String?>(null) }
    val chrome = LocalAppChrome.current
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
    Text(stringResource(Res.string.ride_companies), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
    Text(stringResource(Res.string.ride_companies_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    val nearLabel = { where: RideNear -> if (where == RideNear.HOME) Res.string.rides_home else Res.string.cars_anywhere }
    for (company in companies) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    company.name,
                    style = MaterialTheme.typography.bodyLarge.copy(textDecoration = TextDecoration.Underline),
                    modifier = Modifier.clickable(onClickLabel = stringResource(Res.string.open_company, company.name)) { chrome.openLink(company.url, "a car or ride company") },
                )
                Text(
                    (listOf(stringResource(nearLabel(company.near))) + company.countries.map(::countryName).joinToString(", ").ifEmpty { null }).filterNotNull().joinToString(" · "),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            IconButton(onClick = { viewModel.removeRideCompany(REMOVE_COMPANY_TOKEN, company) }, enabled = !busy) {
                Icon(Icons.Filled.Close, contentDescription = stringResource(Res.string.remove_company, company.name))
            }
        }
    }
    OutlinedTextField(
        value = name,
        onValueChange = { name = it; invalid = null },
        label = { Text(stringResource(Res.string.company_name)) },
        singleLine = true,
        enabled = !busy,
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
    )
    OutlinedTextField(
        value = url,
        onValueChange = { url = it; invalid = null },
        label = { Text(stringResource(Res.string.booking_page)) },
        placeholder = { Text("https://…") },
        singleLine = true,
        enabled = !busy,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
    )
    OutlinedTextField(
        value = countries,
        onValueChange = { countries = it; invalid = null },
        label = { Text(stringResource(Res.string.company_countries)) },
        placeholder = { Text(stringResource(Res.string.company_countries_hint)) },
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
                name.isBlank() -> CompanyProblem.NO_NAME
                where is ParsedCountries.Unknown -> CompanyProblem.UNKNOWN_COUNTRY
                company == null -> CompanyProblem.NOT_HTTPS
                else -> null
            }
            invalidText = (where as? ParsedCountries.Unknown)?.text
            if (company != null) viewModel.addRideCompany(ADD_COMPANY_TOKEN, company)
        },
        enabled = !busy && name.isNotBlank() && url.isNotBlank() && companies.size < MAX_RIDE_COMPANIES,
        modifier = Modifier.padding(top = 4.dp),
    ) { Text(stringResource(Res.string.add)) }
    invalid?.let { Text(invalidText?.let { text -> stringResource(it.text, text) } ?: stringResource(it.text), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
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
    Text(stringResource(Res.string.sender_rules), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
    Text(stringResource(Res.string.sender_rules_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    OutlinedTextField(
        value = allow ?: stored.allow.joinToString("\n"),
        onValueChange = { allow = it; said = false },
        // Locked while saving, so nothing typed then is lost when the save clears the edit.
        enabled = outcome !is Outcome.Busy,
        label = { Text(stringResource(Res.string.always_import_list)) },
        placeholder = { Text("cove.example") },
        minLines = 3,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
    )
    OutlinedTextField(
        value = deny ?: stored.deny.joinToString("\n"),
        onValueChange = { deny = it; said = false },
        enabled = outcome !is Outcome.Busy,
        label = { Text(stringResource(Res.string.never_import_list)) },
        placeholder = { Text("newsletters.example") },
        minLines = 3,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
    )
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.padding(top = 8.dp)) {
        Button(
            onClick = { viewModel.saveSenderPatterns(SENDER_RULES_TOKEN, allow ?: stored.allow.joinToString("\n"), deny ?: stored.deny.joinToString("\n")) },
            enabled = (allow != null || deny != null) && outcome !is Outcome.Busy,
        ) { Text(stringResource(Res.string.save)) }
        if (said) Text(stringResource(Res.string.saved), style = MaterialTheme.typography.bodyMedium)
    }
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
    Text(stringResource(Res.string.email_addresses), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
    Text(stringResource(Res.string.email_addresses_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    for (row in emailRows(user.email, holder, viewModel.now())) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
            Column(modifier = Modifier.weight(1f)) {
                Text(row.email, style = MaterialTheme.typography.bodyLarge)
                val note = when (row.kind) {
                    EmailRowKind.SIGN_IN -> Res.string.email_sign_in
                    EmailRowKind.GMAIL -> Res.string.email_gmail
                    EmailRowKind.PENDING -> Res.string.email_pending
                    EmailRowKind.CONFIRMED -> null
                }
                note?.let { Text(stringResource(it), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
            if (row.removable && viewModel.canLinkEmails) {
                IconButton(onClick = { sentTo = null; viewModel.removeEmail(REMOVE_EMAIL_TOKEN, row.email) }, enabled = !busy) {
                    Icon(Icons.Filled.Close, contentDescription = stringResource(Res.string.remove_email, row.email))
                }
            }
        }
    }
    if (!viewModel.canLinkEmails) {
        Text(stringResource(Res.string.emails_on_web), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp))
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
        ) { Text(stringResource(Res.string.add)) }
    }
    if (adding == null || adding is Outcome.Done) sentTo?.let { Text(stringResource(Res.string.email_link_sent, it), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 4.dp)) }
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
    val chrome = LocalAppChrome.current
    val gmail by viewModel.gmail.collectAsStateWithLifecycle()
    val consent by viewModel.gmailConsentUrl.collectAsStateWithLifecycle()
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    val outcome = outcomes[GMAIL_TOKEN]
    val busy = outcome is Outcome.Busy
    LaunchedEffect(consent) {
        consent?.let {
            chrome.openLink(it, "Gmail consent")
            viewModel.gmailConsentOpened()
        }
    }
    LaunchedEffect(outcome) { if (outcome is Outcome.Done) viewModel.outcomeSeen(GMAIL_TOKEN) }
    Text(stringResource(Res.string.gmail), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
    if (!viewModel.canUseGmail) {
        Text(stringResource(Res.string.gmail_on_web), style = MaterialTheme.typography.bodyMedium)
        return
    }
    when (val state = gmail) {
        TripsViewModel.GmailState.Loading -> Text(stringResource(Res.string.loading), style = MaterialTheme.typography.bodyMedium)
        TripsViewModel.GmailState.NotConnected -> {
            Text(stringResource(Res.string.gmail_connect_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedButton(onClick = { viewModel.connectGmail(GMAIL_TOKEN) }, enabled = !busy, modifier = Modifier.padding(top = 8.dp)) {
                Text(stringResource(Res.string.connect_gmail))
            }
        }
        is TripsViewModel.GmailState.Connected -> {
            Text(stringResource(Res.string.gmail_connected_hint), style = MaterialTheme.typography.bodyMedium)
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
                    Text(stringResource(Res.string.connect_another_gmail))
                }
            } else {
                Text(
                    pluralStringResource(Res.plurals.gmail_limit, MAX_GMAIL_MAILBOXES, MAX_GMAIL_MAILBOXES),
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
    val chrome = LocalAppChrome.current
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
    Text(stringResource(Res.string.fastmail), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
    if (!viewModel.canUseFastmail) {
        Text(stringResource(Res.string.fastmail_on_web), style = MaterialTheme.typography.bodyMedium)
        return
    }
    when (val state = fastmail) {
        TripsViewModel.FastmailState.Loading -> Text(stringResource(Res.string.loading), style = MaterialTheme.typography.bodyMedium)
        TripsViewModel.FastmailState.NotConnected -> {
            if (disconnected) Text(stringResource(Res.string.fastmail_disconnected), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(bottom = 8.dp))
            Text(stringResource(Res.string.fastmail_connect_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            TextButton(onClick = { chrome.openLink(FASTMAIL_TOKENS_URL, "Fastmail API tokens") }) { Text(stringResource(Res.string.fastmail_tokens)) }
            OutlinedTextField(
                value = apiToken,
                onValueChange = { apiToken = it },
                label = { Text(stringResource(Res.string.fastmail_token)) },
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
                Text(stringResource(Res.string.connect_fastmail))
            }
        }
        is TripsViewModel.FastmailState.Connected -> {
            Text(stringResource(Res.string.fastmail_connected_hint), style = MaterialTheme.typography.bodyMedium)
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
            Text(stringResource(Res.string.fastmail_delete_token), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
        }
    }
    for (o in listOf(outcome, disconnecting)) {
        (o as? Outcome.Failed)?.let {
            Text(it.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp))
        }
    }
}

/**
 * Settings' "Other email (IMAP)", as on the web: any other inbox, read with
 * an app password the user makes with their provider, the server filled in
 * for providers Travelmo knows and asked for otherwise; a Gmail or Fastmail
 * address is sent to its own section. Each connected mailbox is a
 * [MailboxRow], with a line when its server turned the password down.
 */
@Composable
private fun ImapSection(viewModel: TripsViewModel) {
    val chrome = LocalAppChrome.current
    val imap by viewModel.imap.collectAsStateWithLifecycle()
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    val connecting = outcomes[IMAP_CONNECT_TOKEN]
    val reading = outcomes[IMAP_TOKEN]
    val disconnecting = outcomes[IMAP_DISCONNECT_TOKEN]
    val busy = listOf(connecting, reading, disconnecting).any { it is Outcome.Busy }
    var address by rememberSaveable { mutableStateOf("") }
    // Not saveable: the password stays out of the saved instance state, and
    // is cleared once the parser has it.
    var password by remember { mutableStateOf("") }
    var server by rememberSaveable { mutableStateOf("") }
    var disconnected by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(connecting) {
        if (connecting is Outcome.Done) {
            address = ""
            password = ""
            server = ""
            viewModel.outcomeSeen(IMAP_CONNECT_TOKEN)
        }
    }
    LaunchedEffect(reading) { if (reading is Outcome.Done) viewModel.outcomeSeen(IMAP_TOKEN) }
    LaunchedEffect(disconnecting) {
        if (disconnecting is Outcome.Done) {
            disconnected = true
            viewModel.outcomeSeen(IMAP_DISCONNECT_TOKEN)
        }
    }
    Text(stringResource(Res.string.imap), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
    if (!viewModel.canUseImap) {
        Text(stringResource(Res.string.imap_on_web), style = MaterialTheme.typography.bodyMedium)
        return
    }
    when (val state = imap) {
        TripsViewModel.ImapState.Loading -> Text(stringResource(Res.string.loading), style = MaterialTheme.typography.bodyMedium)
        is TripsViewModel.ImapState.Loaded -> {
            for (shown in state.mailboxes) {
                val mailboxAddress = shown.mailbox.emailAddress
                MailboxRow(
                    shown.mailbox,
                    busy = busy,
                    warning = if (shown.loginFailed) stringResource(Res.string.imap_login_failed) else null,
                    onStart = { restart -> viewModel.startImapReading(IMAP_TOKEN, mailboxAddress, restart) },
                    onStop = { viewModel.stopImapReading(IMAP_TOKEN, mailboxAddress) },
                    onDisconnect = {
                        disconnected = false
                        viewModel.disconnectImap(IMAP_DISCONNECT_TOKEN, mailboxAddress)
                    },
                )
            }
            if (disconnected) Text(stringResource(Res.string.imap_disconnected), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp))
            // At the limit, the form still gives a connected mailbox a new
            // app password; the parser refuses only a new address.
            if (!state.canConnectMore) {
                Text(
                    pluralStringResource(Res.plurals.imap_limit, MAX_IMAP_MAILBOXES, MAX_IMAP_MAILBOXES),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 16.dp),
                )
            }
            run {
                val typed = address.trim()
                val redirect = if (typed.contains('@')) imapRedirect(typed) else null
                val needsServer = typed.contains('@') && imapServerFor(typed) == ImapServerChoice.Other
                Text(
                    stringResource(Res.string.imap_connect_hint),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = if (state.mailboxes.isEmpty()) 0.dp else 16.dp),
                )
                Row {
                    ICLOUD_IMAP.appPasswordUrl?.let { url -> TextButton(onClick = { chrome.openLink(url, "iCloud app passwords") }) { Text(stringResource(Res.string.imap_icloud_passwords)) } }
                    YAHOO_IMAP.appPasswordUrl?.let { url -> TextButton(onClick = { chrome.openLink(url, "Yahoo app passwords") }) { Text(stringResource(Res.string.imap_yahoo_passwords)) } }
                }
                OutlinedTextField(
                    value = address,
                    onValueChange = { address = it },
                    label = { Text(stringResource(Res.string.imap_address)) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, autoCorrectEnabled = false),
                    modifier = Modifier.fillMaxWidth(),
                )
                redirect?.let { Text(it, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 4.dp)) }
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text(stringResource(Res.string.imap_password)) },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, autoCorrectEnabled = false),
                    modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                )
                if (needsServer) {
                    OutlinedTextField(
                        value = server,
                        onValueChange = { server = it },
                        label = { Text(stringResource(Res.string.imap_server)) },
                        placeholder = { Text(stringResource(Res.string.imap_server_example)) },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, autoCorrectEnabled = false),
                        modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
                    )
                }
                Button(
                    onClick = {
                        disconnected = false
                        viewModel.connectImap(IMAP_CONNECT_TOKEN, typed, password, server)
                    },
                    enabled = !busy && redirect == null && typed.isNotEmpty() && password.isNotBlank() && (!needsServer || server.isNotBlank()),
                    modifier = Modifier.padding(top = 8.dp),
                ) {
                    Text(stringResource(Res.string.connect_imap))
                }
            }
        }
    }
    for (o in listOf(connecting, reading, disconnecting)) {
        (o as? Outcome.Failed)?.let {
            Text(it.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp))
        }
    }
}

/**
 * One connected mailbox, Gmail, Fastmail or IMAP: its address, Import past
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
    warning: String? = null,
) {
    val progress = mailbox.progress
    Text(mailbox.emailAddress, style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 16.dp))
    warning?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 4.dp)) }
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 4.dp)) {
        if (mailbox.reading) {
            OutlinedButton(onClick = onStop, enabled = !busy) { Text(stringResource(Res.string.stop)) }
        } else {
            OutlinedButton(onClick = { onStart(progress?.done == true) }, enabled = !busy) {
                Text(
                    stringResource(
                        when {
                            progress == null -> Res.string.import_past_bookings
                            progress.done -> Res.string.read_again_from_start
                            else -> Res.string.continue_reading
                        },
                    ),
                )
            }
        }
        OutlinedButton(onClick = onDisconnect, enabled = !busy) { Text(stringResource(Res.string.disconnect)) }
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
 * again with the grouping imports use now, "Delete all trips" asks
 * first, with how many will go, before deleting them so the user can import
 * again, and "Refresh from email" reads the emails the bookings came from
 * again. A build with no parser address says to use the web.
 */
@Composable
private fun TripsSection(viewModel: TripsViewModel, onAddBooking: (defaultDate: String) -> Unit) {
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
    Text(stringResource(Res.string.trips_section), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
    Text(stringResource(Res.string.regroup_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    if (!viewModel.canRunTripActions) {
        Text(stringResource(Res.string.trips_on_web), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp))
        return
    }
    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
        OutlinedButton(
            onClick = {
                listOf(REGROUP_TOKEN, DELETE_TRIPS_TOKEN).forEach(viewModel::outcomeSeen)
                viewModel.regroupTrips(REGROUP_TOKEN)
            },
            enabled = !busy,
        ) { Text(stringResource(if (regrouping is Outcome.Busy) Res.string.regrouping else Res.string.regroup_trips)) }
        OutlinedButton(
            onClick = { confirming = true },
            enabled = !busy,
            colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error),
        ) { Text(stringResource(if (deleting is Outcome.Busy) Res.string.deleting else Res.string.delete_all_trips)) }
    }
    notice?.let { Text(it, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp)) }
    listOf(regrouping, deleting).filterIsInstance<Outcome.Failed>().lastOrNull()?.let {
        Text(it.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp))
    }
    RefreshFromEmail(viewModel, onAddBooking)
    if (confirming) {
        AppAlertDialog(
            onDismissRequest = { confirming = false },
            title = { Text(stringResource(Res.string.delete_all_trips_title)) },
            text = { Text(stringResource(Res.string.delete_all_trips_confirm)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        confirming = false
                        listOf(REGROUP_TOKEN, DELETE_TRIPS_TOKEN).forEach(viewModel::outcomeSeen)
                        viewModel.deleteAllTrips(DELETE_TRIPS_TOKEN)
                    },
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                ) {
                    Text(own?.let { pluralStringResource(Res.plurals.delete_n_trips, it, it) } ?: stringResource(Res.string.delete))
                }
            },
            dismissButton = { TextButton(onClick = { confirming = false }) { Text(stringResource(Res.string.keep)) } },
        )
    }
}

/**
 * The emails a refresh couldn't read, by subject and sender, as on the web:
 * a Gmail one opens in Gmail, to check it; Add it yourself takes its booking
 * by hand into the trip it falls in, or a new one; Try again reads them
 * alone again, and Report a problem sends us their ids.
 */
@Composable
private fun FailedEmails(
    viewModel: TripsViewModel,
    ids: List<String>,
    more: String?,
    report: String,
    busy: Boolean,
    onAddBooking: (defaultDate: String) -> Unit,
    onTryAgain: () -> Unit,
) {
    val chrome = LocalAppChrome.current
    val mailboxes by viewModel.gmailMailboxes.collectAsStateWithLifecycle()
    val records by produceState(emptyMap<String, ParsedRecord>(), ids) { value = viewModel.failedEmailRecords(ids) }
    Column(Modifier.padding(top = 4.dp)) {
        for (id in ids) {
            val record = records[id]
            val gmail = record != null && (record.source ?: "gmail") == "gmail"
            Text("• ${failedEmailLine(record)}", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 4.dp))
            Row {
                if (gmail) {
                    TextButton(onClick = { chrome.openLink(gmailSourceLink(id, mailboxes), "an email a refresh couldn't read") }) {
                        Text(stringResource(Res.string.open_in_gmail))
                    }
                }
                TextButton(onClick = { onAddBooking(record?.sentAt?.take(10) ?: viewModel.today()) }) {
                    Text(stringResource(Res.string.add_it_yourself))
                }
            }
        }
        more?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp)) }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
            OutlinedButton(onClick = onTryAgain, enabled = !busy) { Text(stringResource(Res.string.try_again)) }
            chrome.ReportProblemButton(report)
        }
    }
}

/**
 * "Refresh from email", as on the web: start it (Continue after it stopped
 * part way, from the first email again once done) or Stop it while it runs,
 * and how far it got, which the parser records on the user document as it
 * goes, so it carries on with the app closed.
 */
@Composable
private fun RefreshFromEmail(viewModel: TripsViewModel, onAddBooking: (defaultDate: String) -> Unit) {
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    val state by viewModel.refresh.collectAsStateWithLifecycle()
    val starting = outcomes[REFRESH_TOKEN]
    val stopping = outcomes[REFRESH_STOP_TOKEN]
    val busy = starting is Outcome.Busy || stopping is Outcome.Busy
    LaunchedEffect(starting) { if (starting is Outcome.Done) viewModel.outcomeSeen(REFRESH_TOKEN) }
    LaunchedEffect(stopping) { if (stopping is Outcome.Done) viewModel.outcomeSeen(REFRESH_STOP_TOKEN) }
    val progress = state.progress
    Text(REFRESH_BLURB, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 16.dp))
    if (state.reading) {
        OutlinedButton(onClick = { viewModel.stopRefresh(REFRESH_STOP_TOKEN) }, enabled = !busy, modifier = Modifier.padding(top = 8.dp)) {
            Text(stringResource(Res.string.stop))
        }
    } else {
        OutlinedButton(
            onClick = {
                listOf(REFRESH_TOKEN, REFRESH_STOP_TOKEN).forEach(viewModel::outcomeSeen)
                viewModel.startRefresh(REFRESH_TOKEN, progress?.done == true)
            },
            enabled = !busy,
            modifier = Modifier.padding(top = 8.dp),
        ) { Text(refreshButton(progress)) }
    }
    progress?.let {
        Text(describeRefresh(it, state.reading), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
    }
    val failedIds = if (state.reading) emptyList() else failedEmailIds(progress)
    if (progress != null && failedIds.isNotEmpty()) {
        FailedEmails(
            viewModel = viewModel,
            ids = failedIds,
            more = moreFailedEmails(progress),
            report = failedEmailsReport(progress),
            busy = busy,
            onAddBooking = onAddBooking,
            onTryAgain = {
                listOf(REFRESH_TOKEN, REFRESH_STOP_TOKEN).forEach(viewModel::outcomeSeen)
                viewModel.startRefresh(REFRESH_TOKEN, restart = false, retryFailed = true)
            },
        )
    }
    listOf(starting, stopping).filterIsInstance<Outcome.Failed>().lastOrNull()?.let {
        Text(it.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp))
    }
}



