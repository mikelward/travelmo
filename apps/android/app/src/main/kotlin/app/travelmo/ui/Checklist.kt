package app.travelmo.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.travelmo.core.ChecklistEntry
import app.travelmo.core.DEFAULT_LEAD
import app.travelmo.core.Lead
import app.travelmo.core.LeadUnit
import app.travelmo.core.MAX_REMINDER_TEXT
import app.travelmo.core.MAX_STANDING_REMINDERS
import app.travelmo.core.Reminder
import app.travelmo.core.dueText
import app.travelmo.core.formatDate
import app.travelmo.core.leadText
import app.travelmo.shared.Res
import app.travelmo.shared.add_reminder
import app.travelmo.shared.before_international_trips
import app.travelmo.shared.before_international_trips_hint
import app.travelmo.shared.before_you_go
import app.travelmo.shared.cancel
import app.travelmo.shared.days_before
import app.travelmo.shared.edit
import app.travelmo.shared.edit_reminder
import app.travelmo.shared.field_date
import app.travelmo.shared.how_long_before
import app.travelmo.shared.months_before
import app.travelmo.shared.ok
import app.travelmo.shared.on_a_date
import app.travelmo.shared.reminder
import app.travelmo.shared.reminder_amount_error
import app.travelmo.shared.reminder_date_error
import app.travelmo.shared.reminder_example
import app.travelmo.shared.remove_named
import app.travelmo.shared.save
import app.travelmo.shared.weeks_before
import app.travelmo.ui.theme.TextButtonInset
import com.mikelward.androidzoom.compose.FontSizeWindow
import com.mikelward.androidzoom.compose.pinchFontSizeHost
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import org.jetbrains.compose.resources.stringResource

// The traveler's own reminders before a trip (SPEC "Before you go"), as the
// web's components/Checklist.tsx shows them: Settings' "Before international
// trips" and a trip's "Before you go".

private const val SAVE_TOKEN = "settings/tripReminders/save"
private const val REMOVE_TOKEN = "settings/tripReminders/remove"

/** Settings' "Before international trips": the user's reminders, each with how long before; edit, remove, add. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun TripRemindersSection(viewModel: TripsViewModel) {
    val reminders by viewModel.standingReminders.collectAsStateWithLifecycle()
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    val saving = outcomes[SAVE_TOKEN]
    val removing = outcomes[REMOVE_TOKEN]
    val busy = saving is Outcome.Busy || removing is Outcome.Busy
    // The reminder in the dialog: a new one has no slot.
    var editing by remember { mutableStateOf<Reminder?>(null) }
    LaunchedEffect(saving) { if (saving is Outcome.Done) viewModel.outcomeSeen(SAVE_TOKEN) }
    LaunchedEffect(removing) { if (removing is Outcome.Done) viewModel.outcomeSeen(REMOVE_TOKEN) }
    editing?.let { reminder ->
        ReminderDialog(
            title = stringResource(if (reminder.slot.isEmpty()) Res.string.add_reminder else Res.string.edit_reminder),
            initial = reminder,
            dated = false,
            onDismiss = { editing = null },
        ) { saved ->
            editing = null
            viewModel.saveReminder(SAVE_TOKEN, null, saved)
        }
    }
    Text(stringResource(Res.string.before_international_trips), style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
    Text(stringResource(Res.string.before_international_trips_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    val list = reminders.orEmpty()
    for (reminder in list) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
            Column(modifier = Modifier.weight(1f)) {
                Text(reminder.text, style = MaterialTheme.typography.bodyLarge)
                Text(leadText(reminder.lead ?: DEFAULT_LEAD), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            TextButton(onClick = { editing = reminder }, enabled = !busy) { Text(stringResource(Res.string.edit)) }
            IconButton(onClick = { viewModel.removeReminder(REMOVE_TOKEN, null, reminder.slot) }, enabled = !busy) {
                Icon(Icons.Filled.Close, contentDescription = stringResource(Res.string.remove_named, reminder.text))
            }
        }
    }
    OutlinedButton(
        onClick = { editing = Reminder("", "", "", DEFAULT_LEAD) },
        enabled = reminders != null && !busy && list.size < MAX_STANDING_REMINDERS,
        modifier = Modifier.padding(top = 8.dp),
    ) { Text(stringResource(Res.string.add_reminder)) }
    for (outcome in listOf(saving, removing)) {
        (outcome as? Outcome.Failed)?.let { Text(it.message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
    }
}

/** What the trip page needs to show and change "Before you go". */
class Checklist(
    val entries: List<ChecklistEntry>,
    val onTick: (ChecklistEntry, Boolean) -> Unit,
    val onRemove: (ChecklistEntry) -> Unit,
    val onAdd: (Reminder) -> Unit,
    val canAdd: Boolean,
)

/** A trip's "Before you go": the viewer's reminders for it, each ticked off for them alone, and Add a reminder. */
@Composable
internal fun BeforeYouGo(checklist: Checklist, today: String) {
    var adding by rememberSaveable { mutableStateOf(false) }
    if (adding) {
        ReminderDialog(
            title = stringResource(Res.string.add_reminder),
            initial = Reminder("", "", "", DEFAULT_LEAD),
            dated = true,
            onDismiss = { adding = false },
        ) { reminder ->
            adding = false
            checklist.onAdd(reminder)
        }
    }
    Column {
        Text(stringResource(Res.string.before_you_go), style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 20.dp, bottom = 4.dp))
        for (entry in checklist.entries) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Checkbox(checked = entry.done, onCheckedChange = { checklist.onTick(entry, it) })
                Text(
                    entry.text,
                    style = MaterialTheme.typography.bodyLarge,
                    textDecoration = if (entry.done) TextDecoration.LineThrough else null,
                    color = if (entry.done) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    dueText(entry.due, today),
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (entry.done || entry.due > today) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error,
                )
                if (entry.oneOff) {
                    IconButton(onClick = { checklist.onRemove(entry) }) {
                        Icon(Icons.Filled.Close, contentDescription = stringResource(Res.string.remove_named, entry.text))
                    }
                }
            }
        }
        TextButton(onClick = { adding = true }, enabled = checklist.canAdd, modifier = Modifier.padding(top = 4.dp).offset(x = -TextButtonInset)) { Text(stringResource(Res.string.add_reminder)) }
    }
}

/**
 * The words and when: how many days, weeks or months before the trip, or
 * for a one-off ([dated]) a date. Says what is wrong rather than saving it.
 */
@OptIn(ExperimentalLayoutApi::class, ExperimentalMaterial3Api::class)
@Composable
private fun ReminderDialog(title: String, initial: Reminder, dated: Boolean, onDismiss: () -> Unit, onSave: (Reminder) -> Unit) {
    var text by rememberSaveable { mutableStateOf(initial.text) }
    var amount by rememberSaveable { mutableStateOf((initial.lead ?: DEFAULT_LEAD).amount.toString()) }
    // A unit's wire name, or "date".
    var unit by rememberSaveable { mutableStateOf(if (initial.date != null) "date" else (initial.lead ?: DEFAULT_LEAD).unit.wire) }
    var date by rememberSaveable { mutableStateOf(initial.date ?: "") }
    var picking by rememberSaveable { mutableStateOf(false) }
    var error by rememberSaveable { mutableStateOf<String?>(null) }
    val amountError = stringResource(Res.string.reminder_amount_error, LeadUnit.fromWire(unit)?.limit ?: 0)
    val dateError = stringResource(Res.string.reminder_date_error)
    val save = {
        val words = text.trim()
        val leadUnit = LeadUnit.fromWire(unit)
        val number = amount.trim().toIntOrNull()
        when {
            leadUnit == null && date.isEmpty() -> error = dateError
            leadUnit != null && (number == null || number < 0 || number > leadUnit.limit) -> error = amountError
            else -> onSave(
                if (leadUnit == null) initial.copy(text = words, lead = null, date = date) else initial.copy(text = words, lead = Lead(number!!, leadUnit), date = null),
            )
        }
    }
    AppAlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = text,
                    onValueChange = { text = it.take(MAX_REMINDER_TEXT) },
                    label = { Text(stringResource(Res.string.reminder)) },
                    placeholder = { Text(stringResource(Res.string.reminder_example)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    val units = listOf(
                        "days" to Res.string.days_before,
                        "weeks" to Res.string.weeks_before,
                        "months" to Res.string.months_before,
                    ) + if (dated) listOf("date" to Res.string.on_a_date) else emptyList()
                    for ((wire, label) in units) {
                        FilterChip(selected = unit == wire, onClick = { unit = wire; error = null }, label = { Text(stringResource(label)) })
                    }
                }
                if (unit == "date") {
                    PickerField(value = date.takeIf { it.isNotEmpty() }?.let(::formatDate) ?: "", label = stringResource(Res.string.field_date), onClick = { picking = true })
                } else {
                    OutlinedTextField(
                        value = amount,
                        onValueChange = { amount = it.filter(Char::isDigit).take(3); error = null },
                        label = { Text(stringResource(Res.string.how_long_before)) },
                        singleLine = true,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.width(160.dp),
                    )
                }
                error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
            }
        },
        confirmButton = { TextButton(onClick = save, enabled = text.isNotBlank()) { Text(stringResource(Res.string.save)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(Res.string.cancel)) } },
    )
    if (picking) {
        val start = date.takeIf { it.isNotEmpty() }?.let { LocalDate.parse(it).atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli() }
        val state = rememberDatePickerState(initialSelectedDateMillis = start)
        // A window of its own, so it re-applies the text size and hosts the pinch.
        DatePickerDialog(
            onDismissRequest = { picking = false },
            modifier = Modifier.pinchFontSizeHost(),
            confirmButton = {
                FontSizeWindow {
                    TextButton(onClick = {
                        state.selectedDateMillis?.let { date = Instant.ofEpochMilli(it).atOffset(ZoneOffset.UTC).toLocalDate().toString(); error = null }
                        picking = false
                    }) { Text(stringResource(Res.string.ok)) }
                }
            },
            dismissButton = { FontSizeWindow { TextButton(onClick = { picking = false }) { Text(stringResource(Res.string.cancel)) } } },
        ) { FontSizeWindow { DatePicker(state = state) } }
    }
}
