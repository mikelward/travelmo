package app.travelmo.ui

import kotlinx.datetime.TimeZone
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.travelmo.core.ParsedRecord
import app.travelmo.core.REVIEW_RECENT
import app.travelmo.core.SenderList
import app.travelmo.core.dayRange
import app.travelmo.core.domainOf
import app.travelmo.core.effectiveDecision
import app.travelmo.core.isFromMailbox
import app.travelmo.core.outcomeLabel
import app.travelmo.core.recordSourceLabel
import app.travelmo.core.reviewDate
import app.travelmo.core.toReview
import app.travelmo.core.withLatest
import app.travelmo.shared.Res
import app.travelmo.shared.always_import
import app.travelmo.shared.back
import app.travelmo.shared.cancel
import app.travelmo.shared.clear
import app.travelmo.shared.import_anyway
import app.travelmo.shared.import_review
import app.travelmo.shared.import_review_hint
import app.travelmo.shared.loading
import app.travelmo.shared.never_import
import app.travelmo.shared.no_subject
import app.travelmo.shared.nothing_matches
import app.travelmo.shared.nothing_to_review
import app.travelmo.shared.ok
import app.travelmo.shared.review_from
import app.travelmo.shared.review_from_date
import app.travelmo.shared.review_showing_recent
import app.travelmo.shared.review_to
import app.travelmo.shared.review_to_date
import app.travelmo.shared.search
import app.travelmo.shared.searching
import app.travelmo.shared.unknown_sender
import org.jetbrains.compose.resources.pluralStringResource
import org.jetbrains.compose.resources.stringResource

private const val REVIEW_PREFIX = "review/"

/**
 * Import review, as the web's /settings/review: emails and other imports
 * that did not become bookings, the latest [REVIEW_RECENT] until a search
 * reads them all, narrowed by words and optionally by the days they were
 * sent, each with what it was and the way to import it anyway or teach the
 * importer its sender.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ImportReviewScreen(viewModel: TripsViewModel, onBack: () -> Unit, zone: String = TimeZone.currentSystemDefault().id) {
    var keyword by rememberSaveable { mutableStateOf("") }
    var from by rememberSaveable { mutableStateOf<String?>(null) }
    var to by rememberSaveable { mutableStateOf<String?>(null) }
    var picking by rememberSaveable { mutableStateOf<String?>(null) }
    val searching = keyword.isNotBlank() || from != null || to != null
    LaunchedEffect(searching) { viewModel.setReviewSearching(searching) }
    val latest by viewModel.reviewLatest.collectAsStateWithLifecycle()
    val all by viewModel.reviewAll.collectAsStateWithLifecycle()
    val patterns by viewModel.senderPatterns.collectAsStateWithLifecycle()
    val notices by viewModel.reviewNotices.collectAsStateWithLifecycle()
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    // A search's records are read once; the live latest show any read again since.
    val records = if (searching) all?.let { withLatest(it.records, latest.orEmpty()) } else latest
    val shown = records?.let { toReview(it, keyword, dayRange(from, to, zone)) }.orEmpty()
    val searchDone = !searching || all?.done == true
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(Res.string.import_review)) },
                navigationIcon = {
                    IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(Res.string.back)) }
                },
                actions = { AppMenu() },
            )
        },
    ) { padding ->
        val list = rememberLazyListState()
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).scrollEdgeCue(list, scrollCueColors()),
            state = list,
            contentPadding = PaddingValues(16.dp),
        ) {
            item(key = "intro") {
                Column {
                    Text(stringResource(Res.string.import_review_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    OutlinedTextField(
                        value = keyword,
                        onValueChange = { keyword = it },
                        label = { Text(stringResource(Res.string.search)) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                    )
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                        OutlinedButton(onClick = { picking = "from" }) { Text(from?.let { stringResource(Res.string.review_from_date, it) } ?: stringResource(Res.string.review_from)) }
                        OutlinedButton(onClick = { picking = "to" }) { Text(to?.let { stringResource(Res.string.review_to_date, it) } ?: stringResource(Res.string.review_to)) }
                        if (searching) {
                            TextButton(onClick = {
                                keyword = ""
                                from = null
                                to = null
                            }) { Text(stringResource(Res.string.clear)) }
                        }
                    }
                }
            }
            when {
                records == null -> item(key = "loading") { Text(stringResource(Res.string.loading), modifier = Modifier.padding(top = 12.dp)) }
                shown.isEmpty() && searchDone -> item(key = "none") {
                    Text(
                        stringResource(if (searching) Res.string.nothing_matches else Res.string.nothing_to_review),
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 12.dp),
                    )
                }
            }
            items(shown, key = { it.messageId }) { record ->
                val mine = outcomes.filterKeys { it.startsWith("$REVIEW_PREFIX${record.messageId}/") }.values
                ReviewRow(
                    record = record,
                    zone = zone,
                    decision = record.from?.let(::domainOf)?.let { effectiveDecision(patterns, it) },
                    busy = mine.any { it is Outcome.Busy },
                    canReimport = viewModel.canReimport,
                    notice = mine.filterIsInstance<Outcome.Failed>().lastOrNull()?.message ?: notices[record.messageId],
                    // Each action replaces what the row said about the last one.
                    onReimport = {
                        forgetRow(viewModel, record.messageId)
                        viewModel.reimport("$REVIEW_PREFIX${record.messageId}/reimport", record.messageId)
                    },
                    onLearn = { domain, which ->
                        forgetRow(viewModel, record.messageId)
                        viewModel.learnSender("$REVIEW_PREFIX${record.messageId}/learn", record.messageId, domain, which)
                    },
                )
            }
            if (searching && !searchDone) {
                item(key = "searching") { Text(stringResource(Res.string.searching), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 12.dp)) }
            }
            if (!searching && latest?.size == REVIEW_RECENT) {
                item(key = "more") {
                    Text(pluralStringResource(Res.plurals.review_showing_recent, REVIEW_RECENT, REVIEW_RECENT), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 12.dp))
                }
            }
        }
    }
    picking?.let { which ->
        val initial = (if (which == "from") from else to)?.let { pickerMillis(it) }
        val state = rememberDatePickerState(initialSelectedDateMillis = initial)
        DatePickerDialog(
            onDismissRequest = { picking = null },
            confirmButton = {
                TextButton(onClick = {
                    // The picker answers in UTC midnights.
                    val day = state.selectedDateMillis?.let { pickerDate(it) }
                    if (which == "from") from = day else to = day
                    picking = null
                }) { Text(stringResource(Res.string.ok)) }
            },
            dismissButton = { TextButton(onClick = { picking = null }) { Text(stringResource(Res.string.cancel)) } },
        ) { DatePicker(state = state) }
    }
}

// Clears what a row's earlier actions said, failures and notices alike.
private fun forgetRow(viewModel: TripsViewModel, messageId: String) {
    listOf("reimport", "learn").forEach { viewModel.outcomeSeen("$REVIEW_PREFIX$messageId/$it") }
    viewModel.reviewNoticeSeen(messageId)
}

/**
 * One reviewed message: its subject, then when it was sent (or read), who
 * from, which source and what became of it, then Import anyway for a message
 * read from a mailbox and Always or Never import its sender unless the
 * rules already say so.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ReviewRow(
    record: ParsedRecord,
    zone: String,
    decision: SenderList?,
    busy: Boolean,
    canReimport: Boolean,
    notice: String?,
    onReimport: () -> Unit,
    onLearn: (String, SenderList) -> Unit,
) {
    // Records from other sources have no sender to teach and no email to read again.
    val fromMailbox = isFromMailbox(record)
    val domain = if (fromMailbox) record.from?.let(::domainOf) else null
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 12.dp)) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(bottom = 12.dp))
        Text(record.subject?.takeIf { it.isNotBlank() } ?: stringResource(Res.string.no_subject), style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
        val line = listOf(reviewDate(record, zone), record.from ?: stringResource(Res.string.unknown_sender), recordSourceLabel(record.source), outcomeLabel(record.outcome)).joinToString(" · ") +
            (record.reason?.let { " ($it)" } ?: "")
        Text(line, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
            if (fromMailbox && canReimport) OutlinedButton(onClick = onReimport, enabled = !busy) { Text(stringResource(Res.string.import_anyway)) }
            if (domain != null && decision != SenderList.ALLOW) {
                OutlinedButton(onClick = { onLearn(domain, SenderList.ALLOW) }, enabled = !busy) { Text(stringResource(Res.string.always_import, domain)) }
            }
            if (domain != null && decision != SenderList.DENY) {
                OutlinedButton(onClick = { onLearn(domain, SenderList.DENY) }, enabled = !busy) { Text(stringResource(Res.string.never_import, domain)) }
            }
        }
        notice?.let { Text(it, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 4.dp)) }
    }
}
