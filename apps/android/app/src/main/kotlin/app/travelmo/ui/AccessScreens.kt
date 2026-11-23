package app.travelmo.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.travelmo.R
import app.travelmo.auth.GoogleAccount
import app.travelmo.core.AccessConfig
import app.travelmo.core.AccessRecord
import app.travelmo.core.AccountAccess
import app.travelmo.core.canRevoke
import app.travelmo.core.formatDate
import app.travelmo.shared.Res
import app.travelmo.shared.access
import app.travelmo.shared.access_admins_only
import app.travelmo.shared.access_approved
import app.travelmo.shared.access_approved_hint
import app.travelmo.shared.access_invite_label
import app.travelmo.shared.access_no_requests
import app.travelmo.shared.access_requested_on
import app.travelmo.shared.access_requests
import app.travelmo.shared.approve
import app.travelmo.shared.back
import app.travelmo.shared.decline
import app.travelmo.shared.email_address
import app.travelmo.shared.email_link_sent
import app.travelmo.shared.invite
import app.travelmo.shared.invite_only
import app.travelmo.shared.invite_only_declined
import app.travelmo.shared.invite_only_none
import app.travelmo.shared.invite_only_requested
import app.travelmo.shared.invite_only_unverified
import app.travelmo.shared.invited_elsewhere
import app.travelmo.shared.loading
import app.travelmo.shared.request_access
import app.travelmo.shared.revoke
import app.travelmo.shared.send_link
import app.travelmo.shared.sign_out
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.stringResource

private const val REQUEST_TOKEN = "access/request"
private const val LINK_TOKEN = "access/link"
private const val INVITE_TOKEN = "access/invite"
private const val DECIDE_TOKEN = "access/decide/"
private const val DELETE_ACCOUNT_TOKEN = "access/account/delete"

/**
 * What a signed-in account sees until it is approved (SPEC "Access"), as the
 * web's RequestAccess: Request access for one that never asked, where its
 * request stands otherwise, "Invited at another address?" while it waits,
 * Sign out and Delete account (Settings, where accounts are otherwise
 * deleted, needs access). It follows the access record live, so an approval
 * opens the app here.
 */
@Composable
fun InviteOnlyScreen(account: GoogleAccount, viewModel: TripsViewModel, status: AccountAccess) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    val requesting = outcomes[REQUEST_TOKEN]
    val email = viewModel.verifiedEmail
    val waiting = status == AccountAccess.NONE || status == AccountAccess.REQUESTED
    LaunchedEffect(requesting) { if (requesting is Outcome.Done) viewModel.outcomeSeen(REQUEST_TOKEN) }
    Surface(modifier = Modifier.fillMaxSize()) {
        BoxWithConstraints(Modifier.fillMaxSize().safeDrawingPadding()) {
            val scroll = rememberScrollState()
            Column(
                modifier = Modifier.scrollEdgeCue(scroll, scrollCueColors(MaterialTheme.colorScheme.surface)).verticalScroll(scroll).heightIn(min = maxHeight).fillMaxWidth().padding(24.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Column(modifier = Modifier.widthIn(max = 480.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Image(painterResource(R.drawable.logo), contentDescription = null, modifier = Modifier.size(72.dp).padding(bottom = 16.dp))
                    Text(stringResource(Res.string.invite_only), style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
                    val said = when {
                        email == null -> stringResource(Res.string.invite_only_unverified)
                        status == AccountAccess.REQUESTED -> stringResource(Res.string.invite_only_requested)
                        status == AccountAccess.DECLINED -> stringResource(Res.string.invite_only_declined, email)
                        else -> stringResource(Res.string.invite_only_none, email)
                    }
                    Text(
                        said,
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                    if (email != null && status == AccountAccess.NONE) {
                        Button(
                            onClick = { viewModel.requestAccess(REQUEST_TOKEN) },
                            enabled = requesting !is Outcome.Busy,
                            modifier = Modifier.fillMaxWidth().padding(top = 24.dp),
                        ) { Text(stringResource(Res.string.request_access)) }
                    }
                    (requesting as? Outcome.Failed)?.let {
                        Text(it.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 16.dp))
                    }
                    if (email != null && waiting && viewModel.canLinkEmails) InvitedElsewhere(viewModel)
                    TextButton(onClick = { scope.launch { account.signOut(context) } }, modifier = Modifier.padding(top = 16.dp)) {
                        Text(stringResource(Res.string.sign_out))
                    }
                    Column(modifier = Modifier.fillMaxWidth()) {
                        DeleteAccountSection(account, viewModel, DELETE_ACCOUNT_TOKEN)
                    }
                }
            }
        }
        // As on the sign-in screen: no top bar, so the app's menu sits where one would end.
        AppMenu(modifier = Modifier.fillMaxSize().safeDrawingPadding().wrapContentSize(Alignment.TopEnd))
    }
}

/**
 * Someone invited at another address links it (SPEC "Linked email
 * addresses"): the parser mails a link only to an address that lets the
 * account in, and confirming it opens the app.
 */
@Composable
private fun InvitedElsewhere(viewModel: TripsViewModel) {
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    val sending = outcomes[LINK_TOKEN]
    var address by rememberSaveable { mutableStateOf("") }
    var sentTo by rememberSaveable { mutableStateOf<String?>(null) }
    LaunchedEffect(sending) {
        if (sending is Outcome.Done) {
            address = ""
            viewModel.outcomeSeen(LINK_TOKEN)
        }
    }
    Column(modifier = Modifier.fillMaxWidth().padding(top = 32.dp)) {
        Text(stringResource(Res.string.invited_elsewhere), style = MaterialTheme.typography.titleMedium)
        val label = stringResource(Res.string.email_address)
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
            OutlinedTextField(
                value = address,
                onValueChange = { address = it },
                placeholder = { Text("name@example.com") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                modifier = Modifier.weight(1f).semantics { contentDescription = label },
            )
            OutlinedButton(
                onClick = {
                    sentTo = address.trim().lowercase()
                    viewModel.addEmail(LINK_TOKEN, address)
                },
                enabled = sending !is Outcome.Busy && address.isNotBlank(),
            ) { Text(stringResource(Res.string.send_link)) }
        }
        if (sending == null || sending is Outcome.Done) {
            sentTo?.let { Text(stringResource(Res.string.email_link_sent, it), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp)) }
        }
        (sending as? Outcome.Failed)?.let {
            Text(it.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp))
        }
    }
}

/**
 * Admins approve requests, invite addresses and revoke access (SPEC
 * "Access"), as on the web's Access page: an address to invite, requests
 * waiting (oldest first) with Approve and Decline, and everyone approved by
 * a record with Revoke, never for an admin or the admin acting.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccessScreen(viewModel: TripsViewModel, onBack: () -> Unit) {
    val access by viewModel.access.collectAsStateWithLifecycle()
    val known = access as? AccessState.Known
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(Res.string.access)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(Res.string.back))
                    }
                },
                actions = { AppMenu() },
            )
        },
    ) { padding ->
        val scroll = rememberScrollState()
        Column(modifier = Modifier.fillMaxSize().padding(padding).scrollEdgeCue(scroll, scrollCueColors()).verticalScroll(scroll).padding(16.dp)) {
            when {
                known == null -> Text(stringResource(Res.string.loading), color = MaterialTheme.colorScheme.onSurfaceVariant)
                known.status != AccountAccess.APPROVED || !known.admin ->
                    Text(stringResource(Res.string.access_admins_only), color = MaterialTheme.colorScheme.onSurfaceVariant)
                else -> AccessAdmin(viewModel, AccessConfig(known.admins))
            }
        }
    }
}

@Composable
private fun AccessAdmin(viewModel: TripsViewModel, config: AccessConfig) {
    val lists by viewModel.accessLists.collectAsStateWithLifecycle()
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    var address by rememberSaveable { mutableStateOf("") }
    // The action whose failure shows, as the web shows one error at a time.
    var last by rememberSaveable { mutableStateOf<String?>(null) }
    val mine = outcomes.filterKeys { it == INVITE_TOKEN || it.startsWith(DECIDE_TOKEN) }
    LaunchedEffect(mine) {
        for ((token, outcome) in mine) {
            if (outcome !is Outcome.Done) continue
            if (token == INVITE_TOKEN) address = ""
            viewModel.outcomeSeen(token)
        }
    }
    val act = { token: String, action: () -> Unit ->
        last?.let { if (outcomes[it] is Outcome.Failed) viewModel.outcomeSeen(it) }
        last = token
        action()
    }
    val busy = { email: String -> outcomes[DECIDE_TOKEN + email] is Outcome.Busy }
    val label = stringResource(Res.string.access_invite_label)
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
        OutlinedTextField(
            value = address,
            onValueChange = { address = it },
            placeholder = { Text("name@example.com") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
            modifier = Modifier.weight(1f).semantics { contentDescription = label },
        )
        Button(
            onClick = { act(INVITE_TOKEN) { viewModel.inviteAccess(INVITE_TOKEN, address) } },
            enabled = mine.values.none { it is Outcome.Busy },
        ) { Text(stringResource(Res.string.invite)) }
    }
    (last?.let { outcomes[it] } as? Outcome.Failed)?.let {
        Text(it.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp))
    }
    val current = lists
    if (current == null) {
        Text(stringResource(Res.string.loading), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 24.dp))
        return
    }
    Text(stringResource(Res.string.access_requests), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 32.dp, bottom = 4.dp))
    if (current.pending.isEmpty()) {
        Text(stringResource(Res.string.access_no_requests), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    current.pending.forEachIndexed { index, record ->
        if (index > 0) HorizontalDivider()
        RequestRow(record) {
            OutlinedButton(onClick = { act(DECIDE_TOKEN + record.email) { viewModel.decideAccess(DECIDE_TOKEN + record.email, record.email, AccountAccess.APPROVED) } }, enabled = !busy(record.email)) {
                Text(stringResource(Res.string.approve))
            }
            OutlinedButton(onClick = { act(DECIDE_TOKEN + record.email) { viewModel.decideAccess(DECIDE_TOKEN + record.email, record.email, AccountAccess.DECLINED) } }, enabled = !busy(record.email)) {
                Text(stringResource(Res.string.decline))
            }
        }
    }
    Text(stringResource(Res.string.access_approved), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 32.dp, bottom = 4.dp))
    Text(stringResource(Res.string.access_approved_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    current.approved.forEachIndexed { index, record ->
        if (index > 0) HorizontalDivider()
        ApprovedRow(record) {
            if (canRevoke(record.email, viewModel.verifiedEmail, config)) {
                OutlinedButton(onClick = { act(DECIDE_TOKEN + record.email) { viewModel.decideAccess(DECIDE_TOKEN + record.email, record.email, AccountAccess.DECLINED) } }, enabled = !busy(record.email)) {
                    Text(stringResource(Res.string.revoke))
                }
            }
        }
    }
}

/** A request: its address and the day it asked, with Approve and Decline below, so a long address keeps its line. */
@Composable
private fun RequestRow(record: AccessRecord, buttons: @Composable () -> Unit) {
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        val asked = record.requestedAt?.takeIf { it.length >= 10 }?.let { formatDate(it.take(10)) }
        Text(
            if (asked != null) stringResource(Res.string.access_requested_on, record.email, asked) else record.email,
            style = MaterialTheme.typography.bodyLarge,
        )
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 4.dp)) { buttons() }
    }
}

/** Someone approved: the address, and Revoke beside it when it may be revoked. */
@Composable
private fun ApprovedRow(record: AccessRecord, button: @Composable () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).padding(vertical = 4.dp)) {
        Text(record.email, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f).padding(end = 8.dp))
        button()
    }
}
