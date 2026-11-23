package app.travelmo.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.border
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import app.travelmo.core.MAX_TRUSTED
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.travelmo.R
import app.travelmo.core.FoundLoyalty
import app.travelmo.core.ProfileEntry
import app.travelmo.core.allLoyalty
import app.travelmo.core.loyaltyByPerson
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.TextButton
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import app.travelmo.core.TravelProfile
import app.travelmo.core.loyaltySummary

/**
 * The travel profile, as the web's /profile: documents, the loyalty
 * programs at a glance and in full, the travelers, who it is shared with,
 * and the profiles shared with the viewer. Sharing itself stays on the web
 * for now.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileScreen(viewModel: TripsViewModel, bottomBar: @Composable () -> Unit) {
    val profile by viewModel.ownProfile.collectAsStateWithLifecycle()
    val shared by viewModel.sharedProfiles.collectAsStateWithLifecycle()
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    val loaded by viewModel.profileLoaded.collectAsStateWithLifecycle()
    // A finished share is acknowledged so a later one starts afresh.
    LaunchedEffect(outcomes[SHARE_TOKEN]) { if (outcomes[SHARE_TOKEN] is Outcome.Done) viewModel.outcomeSeen(SHARE_TOKEN) }
    // A removal that failed says so under the list; one that finished is acknowledged.
    val removals = outcomes.filterKeys { it.startsWith(FOUND_PREFIX) }
    val removalError = removals.values.filterIsInstance<Outcome.Failed>().lastOrNull()?.message
    LaunchedEffect(removals) { for ((token, outcome) in removals) if (outcome is Outcome.Done) viewModel.outcomeSeen(token) }
    // Likewise saying whose a number is.
    val whose = outcomes.filterKeys { it.startsWith(PERSON_PREFIX) }
    val whoseError = whose.values.filterIsInstance<Outcome.Failed>().lastOrNull()?.message
    LaunchedEffect(whose) { for ((token, outcome) in whose) if (outcome is Outcome.Done) viewModel.outcomeSeen(token) }
    var editing by rememberSaveable { mutableStateOf<List<String>?>(null) }
    editing?.let { (program, number) ->
        PersonDialog(
            program = program,
            number = number,
            people = profile?.let { p -> loyaltyByPerson(allLoyalty(p)).mapNotNull { it.person } }.orEmpty(),
            onPick = { person ->
                whose.keys.forEach(viewModel::outcomeSeen)
                viewModel.setLoyaltyPerson("$PERSON_PREFIX$program/$number", program, number, person)
            },
            onDismiss = { editing = null },
        )
    }
    Scaffold(topBar = { TopAppBar(title = { Text(stringResource(R.string.profile)) }, actions = { AppMenu() }) }, bottomBar = bottomBar) { padding ->
        val list = rememberLazyListState()
        LazyColumn(modifier = Modifier.fillMaxSize().padding(padding).scrollEdgeCue(list, scrollCueColors()), state = list, contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp)) {
            val own = profile
            if (own == null || !own.hasDetails) {
                item(key = "empty") {
                    Text(stringResource(R.string.profile_empty), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            } else {
                profileSections(
                    own,
                    prefix = "own",
                    onRemoveFound = { found ->
                        // A new attempt clears what the last one said.
                        removals.keys.forEach(viewModel::outcomeSeen)
                        viewModel.removeFoundLoyalty("$FOUND_PREFIX${found.program}/${found.number}", found)
                    },
                    removalError = removalError,
                    onWhose = { program, number -> editing = listOf(program, number) },
                    whoseError = whoseError,
                )
            }
            item(key = "shared-with") { SectionTitle(stringResource(R.string.shared_with)) }
            item(key = "sharing") {
                // Until the profile has answered, the list it would replace is
                // unknown, so nothing can be shared or removed yet.
                Sharing(
                    trusted = own?.trustedEmails.orEmpty(),
                    busy = !loaded || outcomes[SHARE_TOKEN] is Outcome.Busy,
                    error = (outcomes[SHARE_TOKEN] as? Outcome.Failed)?.message,
                    onSave = { viewModel.saveTrusted(SHARE_TOKEN, it) },
                )
            }
            val others = shared.filter { it.ownerUid != own?.ownerUid }
            if (others.isNotEmpty()) {
                item(key = "shared-with-you") { SectionTitle(stringResource(R.string.shared_with_you)) }
                for (p in others) {
                    item(key = "from-${p.ownerUid}") {
                        Text(stringResource(R.string.from_sender, p.ownerEmail ?: stringResource(R.string.someone_who_trusts_you)), style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium, modifier = Modifier.padding(top = 8.dp))
                    }
                    if (p.hasDetails) profileSections(p, prefix = p.ownerUid) else item(key = "nothing-${p.ownerUid}") {
                        Text(stringResource(R.string.profile_nothing_yet), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

/**
 * [onRemoveFound] and [onWhose] are set on the viewer's own profile, where
 * what emails showed can be removed and each number said to be someone's.
 */
private fun LazyListScope.profileSections(
    profile: TravelProfile,
    prefix: String,
    onRemoveFound: ((FoundLoyalty) -> Unit)? = null,
    removalError: String? = null,
    onWhose: ((program: String, number: String) -> Unit)? = null,
    whoseError: String? = null,
) {
    entries(stringResource = R.string.documents, entries = profile.documents, prefix = "$prefix-doc")
    val loyalty = allLoyalty(profile)
    if (loyalty.isNotEmpty()) {
        item(key = "$prefix-loyalty-title") { SectionTitle(stringResource(R.string.loyalty_programs)) }
        // The owner's first, then each other person's, named whenever any is someone else's.
        val groups = loyaltyByPerson(loyalty)
        for (group in groups) {
            item(key = "$prefix-loyalty-table-${group.person.orEmpty()}") {
                Column {
                    if (groups.size > 1 || group.person != null) {
                        val name = group.person ?: stringResource(if (onWhose != null) R.string.loyalty_you else R.string.loyalty_theirs)
                        Text(
                            name,
                            style = MaterialTheme.typography.titleSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(top = 12.dp, bottom = 4.dp).semantics { heading() },
                        )
                    }
                    LoyaltyTable(group.entries, onWhose)
                }
            }
        }
        whoseError?.let { message ->
            item(key = "$prefix-whose-error") { Text(message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
        }
    }
    if (onRemoveFound != null && profile.foundLoyalty.isNotEmpty()) {
        item(key = "$prefix-found-title") { SectionTitle(stringResource(R.string.found_in_emails)) }
        for (found in profile.foundLoyalty) {
            item(key = "$prefix-found-${found.program}-${found.number}") { FoundRow(found, onRemove = { onRemoveFound(found) }) }
        }
        removalError?.let { message ->
            item(key = "$prefix-found-error") { Text(message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
        }
    }
    entries(stringResource = R.string.loyalty_details, entries = loyalty, prefix = "$prefix-loy")
    entries(stringResource = R.string.travelers, entries = profile.travelers, prefix = "$prefix-trav")
}

/** Each entry folds away; they start folded, so a passport number is not on screen until asked for. */
private fun LazyListScope.entries(stringResource: Int, entries: List<ProfileEntry>, prefix: String) {
    if (entries.isEmpty()) return
    item(key = "$prefix-title") { SectionTitle(stringResource(stringResource)) }
    for ((i, entry) in entries.withIndex()) {
        item(key = "$prefix-$i") { FoldingEntry(entry) }
    }
}

/** A loyalty number found in an email, the email it came from, and Remove, since the extraction is sometimes wrong. */
@Composable
private fun FoundRow(found: FoundLoyalty, onRemove: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.weight(1f)) {
            Text("${found.program} · ${found.number}", style = MaterialTheme.typography.bodyLarge)
            Text(
                stringResource(R.string.found_from_email, found.label ?: stringResource(R.string.a_booking_email)),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        IconButton(onClick = onRemove) {
            Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.remove_found_loyalty, found.program))
        }
    }
}

private const val SHARE_TOKEN = "profile/share"
private const val FOUND_PREFIX = "profile/found/"
private const val PERSON_PREFIX = "profile/person/"

/**
 * Who a membership belongs to: the owner, someone already named, or, as a
 * second step, someone new by name.
 */
@Composable
private fun PersonDialog(program: String, number: String, people: List<String>, onPick: (String?) -> Unit, onDismiss: () -> Unit) {
    var naming by rememberSaveable { mutableStateOf(false) }
    var name by rememberSaveable { mutableStateOf("") }
    val pick = { person: String? ->
        onPick(person)
        onDismiss()
    }
    AppAlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.whose_is, program, number)) },
        text = {
            if (naming) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it.take(80) },
                    label = { Text(stringResource(R.string.someone_else)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            } else {
                Column {
                    for ((label, person) in listOf(stringResource(R.string.loyalty_mine) to null) + people.map { it to it }) {
                        TextButton(onClick = { pick(person) }, modifier = Modifier.fillMaxWidth()) {
                            Text(label, modifier = Modifier.fillMaxWidth())
                        }
                    }
                    TextButton(onClick = { naming = true }, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(R.string.someone_else_more), modifier = Modifier.fillMaxWidth())
                    }
                }
            }
        },
        confirmButton = {
            if (naming) TextButton(onClick = { pick(name.trim()) }, enabled = name.isNotBlank()) { Text(stringResource(R.string.save)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}

/**
 * Who the profile is shared with, as the web's page has it: each address
 * removable, an address to add, and what sharing means. Sharing is kept
 * on the server by the list alone, so a change is the whole list again.
 */
@Composable
private fun Sharing(trusted: List<String>, busy: Boolean, error: String?, onSave: (List<String>) -> Unit) {
    var address by rememberSaveable { mutableStateOf("") }
    // An address the form itself refuses, kept in the field to be corrected; a refusal from the write comes from the caller.
    var formError by rememberSaveable { mutableStateOf<String?>(null) }
    val notAnAddress = stringResource(R.string.enter_email)
    Column(modifier = Modifier.fillMaxWidth()) {
        Text(stringResource(R.string.share_profile_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (trusted.isEmpty()) {
            Text(stringResource(R.string.only_you), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
        }
        for (email in trusted) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Text(email, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                IconButton(onClick = { onSave(trusted - email) }, enabled = !busy) {
                    Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.stop_sharing_with, email))
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
            OutlinedTextField(
                value = address,
                onValueChange = { address = it },
                placeholder = { Text("name@example.com") },
                singleLine = true,
                modifier = Modifier.weight(1f),
            )
            Button(
                onClick = {
                    if (address.contains("@")) {
                        formError = null
                        onSave(trusted + address)
                        address = ""
                    } else {
                        formError = notAnAddress
                    }
                },
                enabled = !busy && address.isNotBlank() && trusted.size < MAX_TRUSTED,
            ) { Text(stringResource(R.string.share)) }
        }
        (formError ?: error)?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp)) }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 20.dp, bottom = 8.dp))
}

@Composable
private fun FoldingEntry(entry: ProfileEntry) {
    var open by rememberSaveable(entry.title) { mutableStateOf(false) }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(bottom = 8.dp)
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(8.dp))
            .clickable { open = !open }
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Text((if (open) "▾ " else "▸ ") + entry.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
        if (open) {
            for (field in entry.fields) {
                Row(modifier = Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Text(field.label, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                    Text(field.value, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1.4f))
                }
            }
        }
    }
}

/** Every program at a glance: the number, the balance and the status, and with [onWhose], a way to say whose it is. */
@Composable
private fun LoyaltyTable(entries: List<ProfileEntry>, onWhose: ((program: String, number: String) -> Unit)? = null) {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.padding(vertical = 4.dp)) {
            Text(stringResource(R.string.col_program), style = MaterialTheme.typography.labelLarge, color = muted, modifier = Modifier.weight(1.4f))
            Text(stringResource(R.string.col_account), style = MaterialTheme.typography.labelLarge, color = muted, modifier = Modifier.weight(1f))
            Text(stringResource(R.string.col_balance), style = MaterialTheme.typography.labelLarge, color = muted, textAlign = TextAlign.End, modifier = Modifier.weight(0.8f))
            Text(stringResource(R.string.col_status), style = MaterialTheme.typography.labelLarge, color = muted, modifier = Modifier.weight(0.9f).padding(start = 8.dp))
            if (onWhose != null) Spacer(Modifier.width(40.dp))
        }
        for (entry in entries) {
            val s = loyaltySummary(entry)
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Row(modifier = Modifier.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(s.title, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1.4f))
                Text(s.account ?: "", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                Text(s.balance ?: "", style = MaterialTheme.typography.bodyMedium, textAlign = TextAlign.End, modifier = Modifier.weight(0.8f))
                Text(
                    if (s.status != null && s.nextStatus != null) "${s.status} (next: ${s.nextStatus})" else s.status ?: "",
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.weight(0.9f).padding(start = 8.dp),
                )
                if (onWhose != null) {
                    val account = s.account
                    if (account != null) {
                        IconButton(onClick = { onWhose(s.title, account) }, modifier = Modifier.size(40.dp)) {
                            Icon(Icons.Filled.MoreVert, contentDescription = stringResource(R.string.whose_is, s.title, account))
                        }
                    } else {
                        Spacer(Modifier.size(40.dp))
                    }
                }
            }
        }
    }
}
