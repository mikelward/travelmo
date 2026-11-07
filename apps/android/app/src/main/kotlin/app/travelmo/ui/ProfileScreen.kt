package app.travelmo.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.travelmo.R
import app.travelmo.core.ProfileEntry
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
    Scaffold(topBar = { TopAppBar(title = { Text(stringResource(R.string.profile)) }) }, bottomBar = bottomBar) { padding ->
        LazyColumn(modifier = Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp)) {
            val own = profile
            if (own == null || !own.hasDetails) {
                item(key = "empty") {
                    Text(stringResource(R.string.profile_empty), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            } else {
                profileSections(own, prefix = "own")
            }
            if (own != null && own.trustedEmails.isNotEmpty()) {
                item(key = "shared-with") { SectionTitle(stringResource(R.string.shared_with)) }
                item(key = "shared-with-list") {
                    Column { for (email in own.trustedEmails) Text(email, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(vertical = 2.dp)) }
                }
            }
            val others = shared.filter { it.ownerUid != own?.ownerUid }
            if (others.isNotEmpty()) {
                item(key = "shared-with-you") { SectionTitle(stringResource(R.string.shared_with_you)) }
                for (p in others) {
                    item(key = "from-${p.ownerUid}") {
                        Text(stringResource(R.string.from_sender, p.ownerEmail ?: stringResource(R.string.someone_who_trusts_you)), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, modifier = Modifier.padding(top = 8.dp))
                    }
                    if (p.hasDetails) profileSections(p, prefix = p.ownerUid) else item(key = "nothing-${p.ownerUid}") {
                        Text(stringResource(R.string.profile_nothing_yet), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }
    }
}

private fun LazyListScope.profileSections(profile: TravelProfile, prefix: String) {
    entries(stringResource = R.string.documents, entries = profile.documents, prefix = "$prefix-doc")
    if (profile.loyalty.isNotEmpty()) {
        item(key = "$prefix-loyalty-title") { SectionTitle(stringResource(R.string.loyalty_programs)) }
        item(key = "$prefix-loyalty-table") { LoyaltyTable(profile.loyalty) }
    }
    entries(stringResource = R.string.loyalty_details, entries = profile.loyalty, prefix = "$prefix-loy")
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

@Composable
private fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 20.dp, bottom = 8.dp))
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
        Text((if (open) "▾ " else "▸ ") + entry.title, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
        if (open) {
            for (field in entry.fields) {
                Row(modifier = Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Text(field.label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                    Text(field.value, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1.4f))
                }
            }
        }
    }
}

/** Every program at a glance: the number, the balance and the status. */
@Composable
private fun LoyaltyTable(entries: List<ProfileEntry>) {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.padding(vertical = 4.dp)) {
            Text(stringResource(R.string.col_program), style = MaterialTheme.typography.labelMedium, color = muted, modifier = Modifier.weight(1.4f))
            Text(stringResource(R.string.col_account), style = MaterialTheme.typography.labelMedium, color = muted, modifier = Modifier.weight(1f))
            Text(stringResource(R.string.col_balance), style = MaterialTheme.typography.labelMedium, color = muted, textAlign = TextAlign.End, modifier = Modifier.weight(0.8f))
            Text(stringResource(R.string.col_status), style = MaterialTheme.typography.labelMedium, color = muted, modifier = Modifier.weight(0.9f).padding(start = 8.dp))
        }
        for (entry in entries) {
            val s = loyaltySummary(entry)
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Row(modifier = Modifier.padding(vertical = 6.dp)) {
                Text(s.title, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1.4f))
                Text(s.account ?: "", style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                Text(s.balance ?: "", style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.End, modifier = Modifier.weight(0.8f))
                Text(
                    if (s.status != null && s.nextStatus != null) "${s.status} (next: ${s.nextStatus})" else s.status ?: "",
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.weight(0.9f).padding(start = 8.dp),
                )
            }
        }
    }
}
