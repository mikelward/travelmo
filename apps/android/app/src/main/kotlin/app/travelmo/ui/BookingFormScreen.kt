package app.travelmo.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.travelmo.R
import app.travelmo.core.BookingFields
import app.travelmo.core.BookingFormException
import app.travelmo.core.FIXED_OFFSET_PREFIX
import app.travelmo.core.Segment
import app.travelmo.core.SegmentType
import app.travelmo.core.airportZone
import app.travelmo.core.countryChoices
import app.travelmo.core.countryName
import app.travelmo.core.formatDateWithYear
import app.travelmo.core.initialFields
import app.travelmo.core.timeZones
import app.travelmo.core.toDraft
import app.travelmo.core.zoneLabel
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset
import java.util.UUID

private val typeLabels = mapOf(
    SegmentType.FLIGHT to "Flight", SegmentType.TRAIN to "Train", SegmentType.BUS to "Bus", SegmentType.FERRY to "Ferry",
    SegmentType.LODGING to "Stay", SegmentType.CAR_RENTAL to "Car rental", SegmentType.ACTIVITY to "Activity", SegmentType.OTHER to "Other",
)

/**
 * Add or edit a booking, the web's form (apps/web/src/components/SegmentForm.tsx)
 * in Material: type, title, start and end as date, time and zone, the
 * places, the reference, notes. A known airport code also sets its end's
 * zone, unless the zone was picked by hand.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BookingFormScreen(viewModel: TripsViewModel, tripId: String, segmentId: String?, defaultDate: String, onDone: () -> Unit) {
    val segmentsFlow = remember(tripId) { viewModel.segments(tripId) }
    val segments by segmentsFlow.collectAsStateWithLifecycle(initialValue = null)
    val existing = segments?.firstOrNull { it.id == segmentId }
    // The fields are set up once the booking being edited has arrived.
    if (segmentId != null && existing == null) {
        if (segments == null) return
    }
    // The form's token survives a rotation with it, so the save it started
    // in the ViewModel still answers to it, and a save another form started
    // does not.
    val token = rememberSaveable { UUID.randomUUID().toString() }
    val saves by viewModel.bookingSaves.collectAsStateWithLifecycle()
    val mine = saves[token]
    LaunchedEffect(mine) {
        if (mine is BookingSave.Done) {
            viewModel.bookingSaveSeen(token)
            onDone()
        }
    }
    BookingForm(
        existing = existing,
        defaultDate = defaultDate,
        busy = mine is BookingSave.Busy,
        saveError = (mine as? BookingSave.Failed)?.message,
        onSave = { draft -> viewModel.saveSegment(token, tripId, draft, existing?.id) },
        onDone = onDone,
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BookingForm(
    existing: Segment?,
    defaultDate: String,
    busy: Boolean,
    saveError: String?,
    onSave: (app.travelmo.core.SegmentDraft) -> Unit,
    onDone: () -> Unit,
) {
    var fields by rememberSaveable(existing?.id, stateSaver = BookingFieldsSaver) { mutableStateOf(initialFields(existing, defaultDate)) }
    var pickedZones by rememberSaveable { mutableStateOf(setOf<String>()) }
    // What the form itself refuses; what the save refused comes from the caller.
    var formError by remember { mutableStateOf<String?>(null) }
    val error = formError ?: saveError
    val lodging = fields.type == SegmentType.LODGING
    val save = {
        formError = null
        try {
            onSave(toDraft(fields, existing))
        } catch (e: BookingFormException) {
            formError = e.message
        }
    }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(if (existing == null) R.string.add_booking else R.string.edit_booking)) },
                navigationIcon = {
                    IconButton(onClick = onDone) { Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.cancel)) }
                },
                actions = {
                    TextButton(onClick = { save() }, enabled = !busy) {
                        Text(stringResource(if (existing == null) R.string.add else R.string.save))
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            TypeField(fields.type) { fields = fields.copy(type = it) }
            OutlinedTextField(
                value = fields.title,
                onValueChange = { fields = fields.copy(title = it) },
                label = { Text(stringResource(R.string.field_title)) },
                placeholder = { Text("BA 117 LHR to JFK") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            WhenFields(
                label = stringResource(if (lodging) R.string.check_in_local else R.string.start_local),
                date = fields.startDate, time = fields.startTime, zone = fields.startZone, required = true,
                onDate = { fields = fields.copy(startDate = it) },
                onTime = { fields = fields.copy(startTime = it) },
                onZone = { fields = fields.copy(startZone = it); pickedZones = pickedZones + "start" },
            )
            WhenFields(
                label = stringResource(if (lodging) R.string.check_out_local else R.string.end_local),
                date = fields.endDate, time = fields.endTime, zone = fields.endZone, required = false,
                onDate = { fields = fields.copy(endDate = it) },
                onTime = { fields = fields.copy(endTime = it) },
                onZone = { fields = fields.copy(endZone = it); pickedZones = pickedZones + "end" },
                onClear = { fields = fields.copy(endDate = "", endTime = "") },
            )
            if (fields.transport) {
                PlaceFields(
                    label = stringResource(R.string.field_from), placeholder = "London Heathrow", codePlaceholder = "LHR",
                    name = fields.originName, code = fields.originCode,
                    onName = { fields = fields.copy(originName = it) },
                    onCode = { code ->
                        val zone = airportZone(code)
                        fields = if (zone != null && "start" !in pickedZones) fields.copy(originCode = code, startZone = zone) else fields.copy(originCode = code)
                    },
                )
                PlaceFields(
                    label = stringResource(R.string.field_to), placeholder = "New York JFK", codePlaceholder = "JFK",
                    name = fields.destinationName, code = fields.destinationCode,
                    onName = { fields = fields.copy(destinationName = it) },
                    onCode = { code ->
                        val zone = airportZone(code)
                        fields = if (zone != null && "end" !in pickedZones) fields.copy(destinationCode = code, endZone = zone) else fields.copy(destinationCode = code)
                    },
                )
                if (fields.type != SegmentType.FLIGHT) {
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        CountryField(stringResource(R.string.from_country), fields.originCountry, Modifier.weight(1f)) { fields = fields.copy(originCountry = it) }
                        CountryField(stringResource(R.string.to_country), fields.destinationCountry, Modifier.weight(1f)) { fields = fields.copy(destinationCountry = it) }
                    }
                }
            } else {
                OutlinedTextField(
                    value = fields.destinationName,
                    onValueChange = { fields = fields.copy(destinationName = it) },
                    label = { Text(stringResource(R.string.field_where)) },
                    placeholder = { Text("Cove Liverpool") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                CountryField(stringResource(R.string.field_country), fields.destinationCountry, Modifier.fillMaxWidth()) { fields = fields.copy(destinationCountry = it) }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = fields.provider, onValueChange = { fields = fields.copy(provider = it) },
                    label = { Text(stringResource(R.string.field_provider)) }, placeholder = { Text("British Airways") }, singleLine = true, modifier = Modifier.weight(1f),
                )
                OutlinedTextField(
                    value = fields.confirmation, onValueChange = { fields = fields.copy(confirmation = it) },
                    label = { Text(stringResource(R.string.field_confirmation)) }, placeholder = { Text("ABC123") }, singleLine = true, modifier = Modifier.weight(1f),
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters),
                )
            }
            OutlinedTextField(
                value = fields.notes, onValueChange = { fields = fields.copy(notes = it) },
                label = { Text(stringResource(R.string.field_notes)) }, minLines = 2, modifier = Modifier.fillMaxWidth(),
            )
            error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun TypeField(type: SegmentType, onChange: (SegmentType) -> Unit) {
    var open by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = open, onExpandedChange = { open = it }) {
        OutlinedTextField(
            value = typeLabels.getValue(type),
            onValueChange = {},
            readOnly = true,
            label = { Text(stringResource(R.string.field_type)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = open) },
            modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            for (t in SegmentType.entries) {
                DropdownMenuItem(text = { Text(typeLabels.getValue(t)) }, onClick = { onChange(t); open = false })
            }
        }
    }
}

/** A date, a time and a zone, each a field that opens its picker. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun WhenFields(
    label: String,
    date: String,
    time: String,
    zone: String,
    required: Boolean,
    onDate: (String) -> Unit,
    onTime: (String) -> Unit,
    onZone: (String) -> Unit,
    onClear: (() -> Unit)? = null,
) {
    var picking by remember { mutableStateOf<String?>(null) }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(label, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            PickerField(
                value = date.takeIf { it.isNotEmpty() }?.let { formatDateWithYear(it) } ?: "",
                label = stringResource(R.string.field_date),
                modifier = Modifier.weight(1.4f),
                onClick = { picking = "date" },
            )
            PickerField(value = time, label = stringResource(R.string.field_time), modifier = Modifier.weight(1f), onClick = { picking = "time" })
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            PickerField(value = zoneLabel(zone), label = stringResource(R.string.field_zone), modifier = Modifier.weight(1f), onClick = { picking = "zone" })
            if (onClear != null && (date.isNotEmpty() || time.isNotEmpty())) {
                TextButton(onClick = onClear, modifier = Modifier.padding(top = 8.dp)) { Text(stringResource(R.string.clear)) }
            }
        }
    }
    when (picking) {
        "date" -> {
            val initial = date.takeIf { it.isNotEmpty() }?.let { LocalDate.parse(it).atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli() }
            val state = rememberDatePickerState(initialSelectedDateMillis = initial)
            DatePickerDialog(
                onDismissRequest = { picking = null },
                confirmButton = {
                    TextButton(onClick = {
                        state.selectedDateMillis?.let { onDate(Instant.ofEpochMilli(it).atOffset(ZoneOffset.UTC).toLocalDate().toString()) }
                        picking = null
                    }) { Text(stringResource(R.string.ok)) }
                },
                dismissButton = { TextButton(onClick = { picking = null }) { Text(stringResource(R.string.cancel)) } },
            ) { DatePicker(state = state) }
        }
        "time" -> {
            val (h, m) = time.takeIf { it.length == 5 }?.let { it.substring(0, 2).toInt() to it.substring(3, 5).toInt() } ?: (9 to 0)
            val state = rememberTimePickerState(initialHour = h, initialMinute = m, is24Hour = true)
            AlertDialog(
                onDismissRequest = { picking = null },
                confirmButton = {
                    TextButton(onClick = {
                        onTime(String.format(java.util.Locale.ROOT, "%02d:%02d", state.hour, state.minute))
                        picking = null
                    }) { Text(stringResource(R.string.ok)) }
                },
                dismissButton = { TextButton(onClick = { picking = null }) { Text(stringResource(R.string.cancel)) } },
                text = { TimePicker(state = state) },
            )
        }
        "zone" -> ZonePicker(current = zone, onPick = { onZone(it); picking = null }, onDismiss = { picking = null })
    }
    if (!required) Unit
}

/** A read-only field that opens a picker on tap. */
@Composable
private fun PickerField(value: String, label: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(modifier = modifier) {
        OutlinedTextField(value = value, onValueChange = {}, readOnly = true, label = { Text(label) }, singleLine = true, modifier = Modifier.fillMaxWidth())
        // A transparent layer takes the tap: a read-only field would open the keyboard's cursor instead.
        Box(
            modifier = Modifier.matchParentSize().clickable(onClick = onClick),
        )
    }
}

/** Every zone, filtered as you type; the pinned offset of an import stays an option until a zone is picked. */
@Composable
private fun ZonePicker(current: String, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    var query by remember { mutableStateOf("") }
    val zones = remember { timeZones() }
    val shown = remember(query) { zones.filter { it.replace('_', ' ').contains(query.trim(), ignoreCase = true) } }
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
        title = { Text(stringResource(R.string.field_zone)) },
        text = {
            Column {
                OutlinedTextField(value = query, onValueChange = { query = it }, singleLine = true, placeholder = { Text(stringResource(R.string.search_zones)) }, modifier = Modifier.fillMaxWidth())
                LazyColumn(modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
                    if (current.startsWith(FIXED_OFFSET_PREFIX)) {
                        item { DropdownMenuItem(text = { Text(zoneLabel(current)) }, onClick = { onPick(current) }) }
                    }
                    items(shown, key = { it }) { zone -> DropdownMenuItem(text = { Text(zone.replace('_', ' ')) }, onClick = { onPick(zone) }) }
                }
            }
        },
    )
}

/** A place's name and its airport or station code. */
@Composable
private fun PlaceFields(label: String, placeholder: String, codePlaceholder: String, name: String, code: String, onName: (String) -> Unit, onCode: (String) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        OutlinedTextField(value = name, onValueChange = onName, label = { Text(label) }, placeholder = { Text(placeholder) }, singleLine = true, modifier = Modifier.weight(1f))
        OutlinedTextField(
            value = code, onValueChange = { onCode(it.uppercase()) }, label = { Text(stringResource(R.string.field_code)) }, placeholder = { Text(codePlaceholder) }, singleLine = true,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Characters), modifier = Modifier.width(104.dp),
        )
    }
}

/** A country by name, or none; optional, since most imports fill it in. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CountryField(label: String, code: String, modifier: Modifier = Modifier, onChange: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val choices = remember { countryChoices() }
    ExposedDropdownMenuBox(expanded = open, onExpandedChange = { open = it }, modifier = modifier) {
        OutlinedTextField(
            value = if (code.isEmpty()) "" else countryName(code),
            onValueChange = {},
            readOnly = true,
            label = { Text(label) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = open) },
            modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(text = { Text(stringResource(R.string.no_country)) }, onClick = { onChange(""); open = false })
            for ((c, name) in choices) {
                DropdownMenuItem(text = { Text(name) }, onClick = { onChange(c); open = false })
            }
        }
    }
}
