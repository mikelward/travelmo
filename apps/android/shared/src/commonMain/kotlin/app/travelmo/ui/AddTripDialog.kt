package app.travelmo.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DateRangePicker
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDateRangePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.travelmo.core.formatDateRange
import app.travelmo.shared.Res
import app.travelmo.shared.add
import app.travelmo.shared.add_trip
import app.travelmo.shared.cancel
import app.travelmo.shared.ok
import app.travelmo.shared.pick_dates
import app.travelmo.shared.trip_name
import org.jetbrains.compose.resources.stringResource

/**
 * Add a trip (SPEC "Adding a trip"): a name and its dates, picked as a range.
 * [onAdd] gets them as typed and picked; [problem] is what the last try
 * said was wrong, and [busy] holds the buttons while it is written.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddTripDialog(busy: Boolean, problem: String?, onDismiss: () -> Unit, onAdd: (title: String, start: String?, end: String?) -> Unit) {
    var title by rememberSaveable { mutableStateOf("") }
    var start by rememberSaveable { mutableStateOf<String?>(null) }
    var end by rememberSaveable { mutableStateOf<String?>(null) }
    var picking by rememberSaveable { mutableStateOf(false) }
    AppAlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(Res.string.add_trip)) },
        text = {
            Column {
                OutlinedTextField(value = title, onValueChange = { title = it }, singleLine = true, label = { Text(stringResource(Res.string.trip_name)) }, modifier = Modifier.fillMaxWidth())
                OutlinedButton(onClick = { picking = true }, modifier = Modifier.padding(top = 12.dp)) {
                    val s = start
                    val e = end
                    Text(if (s != null && e != null) formatDateRange(s, e) else stringResource(Res.string.pick_dates))
                }
                problem?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp)) }
            }
        },
        confirmButton = { TextButton(onClick = { onAdd(title, start, end) }, enabled = !busy) { Text(stringResource(Res.string.add)) } },
        dismissButton = { TextButton(onClick = onDismiss, enabled = !busy) { Text(stringResource(Res.string.cancel)) } },
    )
    if (picking) {
        // Opens on the range chosen, if any; the picker answers in UTC midnights.
        val state = rememberDateRangePickerState(initialSelectedStartDateMillis = start?.let(::pickerMillis), initialSelectedEndDateMillis = end?.let(::pickerMillis))
        DatePickerDialog(
            onDismissRequest = { picking = false },
            confirmButton = {
                TextButton(onClick = {
                    val from = state.selectedStartDateMillis?.let(::pickerDate)
                    if (from != null) {
                        start = from
                        // One day picked is a day trip.
                        end = state.selectedEndDateMillis?.let(::pickerDate) ?: from
                    }
                    picking = false
                }) { Text(stringResource(Res.string.ok)) }
            },
            dismissButton = { TextButton(onClick = { picking = false }) { Text(stringResource(Res.string.cancel)) } },
        ) { DateRangePicker(state = state, modifier = Modifier.height(480.dp)) }
    }
}
