package app.travelmo.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.TextButton
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.travelmo.R
import app.travelmo.core.PersonWarning
import app.travelmo.core.ProfileEntry
import app.travelmo.core.Segment
import app.travelmo.core.Trip
import app.travelmo.core.formatDate
import app.travelmo.core.loyaltyLine
import app.travelmo.core.programsFor
import app.travelmo.core.tripWarnings
import app.travelmo.core.formatDateRange
import app.travelmo.core.referenceLine
import app.travelmo.core.routeLine
import app.travelmo.core.segmentsByDay
import app.travelmo.core.timesLine
import app.travelmo.ui.theme.SharedBadge
import kotlinx.coroutines.launch

/**
 * A trip's bookings by day, as the web's trip page lists them. The owner and
 * a sharee add, edit and delete bookings (the rules decide finally); only
 * the owner's other powers (rename, share, delete the trip) stay on the web.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TripDetailScreen(
    viewModel: TripsViewModel,
    tripId: String,
    uid: String,
    email: String?,
    onBack: () -> Unit,
    onAddBooking: (defaultDate: String) -> Unit,
    onEditBooking: (segmentId: String) -> Unit,
) {
    val tripFlow = remember(tripId) { viewModel.trip(tripId) }
    val segmentsFlow = remember(tripId) { viewModel.segments(tripId) }
    val trip by tripFlow.collectAsStateWithLifecycle(initialValue = null)
    val segments by segmentsFlow.collectAsStateWithLifecycle(initialValue = emptyList())
    val loaded by viewModel.state.collectAsStateWithLifecycle()
    val people by viewModel.people.collectAsStateWithLifecycle()
    val ownProfile by viewModel.ownProfile.collectAsStateWithLifecycle()
    val scope = rememberCoroutineScope()
    var error by remember { mutableStateOf<String?>(null) }
    var deleting by remember { mutableStateOf<Segment?>(null) }
    val current = trip
    val canEdit = current != null && !current.deleting && (current.ownerUid == uid || (email != null && current.sharedWith.contains(email)))
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(trip?.title ?: "", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.back))
                    }
                },
            )
        },
        floatingActionButton = {
            current?.takeIf { canEdit }?.let { editable ->
                ExtendedFloatingActionButton(
                    onClick = { onAddBooking(editable.start) },
                    icon = { Icon(Icons.Filled.Add, contentDescription = null) },
                    text = { Text(stringResource(R.string.add_booking)) },
                )
            }
        },
    ) { padding ->
        deleting?.let { segment ->
            AlertDialog(
                onDismissRequest = { deleting = null },
                title = { Text(stringResource(R.string.delete_booking_title)) },
                text = { Text(stringResource(R.string.delete_booking_text, segment.title)) },
                confirmButton = {
                    TextButton(onClick = {
                        deleting = null
                        scope.launch {
                            try {
                                viewModel.deleteSegment(tripId, segment.id)
                            } catch (e: Exception) {
                                error = e.message ?: e.javaClass.simpleName
                            }
                        }
                    }) { Text(stringResource(R.string.delete)) }
                },
                dismissButton = { TextButton(onClick = { deleting = null }) { Text(stringResource(R.string.keep)) } },
            )
        }
        when {
            current != null -> TripBody(
                current, segments, shared = current.ownerUid != uid, error = error,
                warnings = tripWarnings(people, current, segments, viewModel.today()), today = viewModel.today(),
                programsFor = { provider -> programsFor(provider, ownProfile?.loyalty.orEmpty()) },
                actions = if (canEdit) BookingActions(onEdit = { onEditBooking(it.id) }, onDelete = { deleting = it }) else null,
                modifier = Modifier.padding(padding),
            )
            loaded.groups == null -> Text(stringResource(R.string.trip_loading), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(padding).padding(16.dp))
            else -> Text(stringResource(R.string.trip_not_found), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(padding).padding(16.dp))
        }
    }
}

/** What a viewer who may edit can do to a booking. */
class BookingActions(val onEdit: (Segment) -> Unit, val onDelete: (Segment) -> Unit)

@Composable
private fun TripBody(
    trip: Trip,
    segments: List<Segment>,
    shared: Boolean,
    error: String?,
    warnings: List<PersonWarning>,
    today: String,
    programsFor: (String?) -> List<ProfileEntry>,
    actions: BookingActions?,
    modifier: Modifier = Modifier,
) {
    val days = segmentsByDay(segments)
    LazyColumn(modifier = modifier.fillMaxSize(), contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 96.dp)) {
        item(key = "dates") {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(formatDateRange(trip.start, trip.end), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (shared) Text(stringResource(R.string.badge_shared).uppercase(), style = MaterialTheme.typography.labelSmall, color = SharedBadge)
            }
        }
        if (error != null) {
            item(key = "error") { Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp)) }
        }
        if (warnings.isNotEmpty()) {
            item(key = "warnings") { DocumentWarnings(warnings, today) }
        }
        if (days.isEmpty()) {
            item(key = "empty") {
                Text(stringResource(R.string.trip_no_bookings), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 16.dp))
            }
        }
        for ((date, items) in days) {
            item(key = "day-$date") {
                Text(formatDate(date), style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 20.dp, bottom = 4.dp))
            }
            items(items, key = { it.id }) { segment ->
                SegmentRow(segment, actions, programs = programsFor(segment.provider))
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
        }
        if (trip.sharedWith.isNotEmpty()) {
            item(key = "shared-with") {
                Text(stringResource(R.string.shared_with), style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
                for (email in trip.sharedWith) Text(email, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

/** One booking: its kind, title, route, times, reference, verdict, sources and sender, and its actions when the viewer may edit. */
@Composable
fun SegmentRow(segment: Segment, actions: BookingActions? = null, programs: List<ProfileEntry> = emptyList()) {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    var menu by remember { mutableStateOf(false) }
    Row(modifier = Modifier.padding(vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(
            segment.type.label.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = muted,
            modifier = Modifier.width(64.dp).padding(top = 4.dp),
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(segment.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
            routeLine(segment)?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = muted) }
            Text(timesLine(segment), style = MaterialTheme.typography.bodyMedium, color = muted)
            referenceLine(segment)?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = muted, modifier = Modifier.padding(top = 4.dp)) }
            if (programs.isNotEmpty()) {
                Text(programs.joinToString(" · ", transform = ::loyaltyLine), style = MaterialTheme.typography.bodySmall, color = muted, modifier = Modifier.padding(top = 4.dp))
            }
            segment.notes?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = muted, modifier = Modifier.padding(top = 4.dp)) }
            Verdict(segment)
            // The sources and the sender share one line.
            val provenance = listOfNotNull(
                segment.sourceCount.takeIf { it > 0 }?.let { pluralStringResource(R.plurals.sources, it, it) },
                segment.sender?.let { stringResource(R.string.from_sender, it) },
            )
            if (provenance.isNotEmpty()) {
                Text(provenance.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = muted, modifier = Modifier.padding(top = 4.dp))
            }
        }
        if (actions != null) {
            Box {
                IconButton(onClick = { menu = true }, modifier = Modifier.size(32.dp)) {
                    Icon(Icons.Filled.MoreVert, contentDescription = stringResource(R.string.booking_actions), tint = muted)
                }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(text = { Text(stringResource(R.string.edit)) }, onClick = { menu = false; actions.onEdit(segment) })
                    DropdownMenuItem(text = { Text(stringResource(R.string.delete)) }, onClick = { menu = false; actions.onDelete(segment) })
                }
            }
        }
    }
}

/** The traveler's stars and heart, shown when there are any. */
@Composable
private fun Verdict(segment: Segment) {
    val rating = segment.rating ?: 0
    if (rating == 0 && !segment.favorite) return
    Row(modifier = Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        if (rating > 0) {
            Text(
                "★".repeat(rating) + "☆".repeat(5 - rating),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.tertiary,
            )
        }
        if (segment.favorite) Text("♥", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
    }
}
