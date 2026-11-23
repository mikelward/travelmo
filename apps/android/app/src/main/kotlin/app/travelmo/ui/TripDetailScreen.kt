package app.travelmo.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import app.travelmo.R
import app.travelmo.core.PersonWarning
import app.travelmo.core.ProfileEntry
import app.travelmo.core.Segment
import app.travelmo.core.SegmentType
import app.travelmo.core.SourceKind
import app.travelmo.core.SourceRef
import app.travelmo.core.Trip
import app.travelmo.core.displayTitles
import app.travelmo.core.emailLinkFor
import app.travelmo.core.allLoyalty
import app.travelmo.core.RideCompany
import app.travelmo.core.RideNeed
import app.travelmo.core.rideNeedKey
import app.travelmo.core.sharedWithAny
import app.travelmo.core.fittedRange
import app.travelmo.core.formatDate
import app.travelmo.core.formatDateRange
import app.travelmo.core.shownEnd
import app.travelmo.core.shownStart
import app.travelmo.core.isCancelled
import app.travelmo.core.loyaltyLine
import app.travelmo.core.otherTrips
import app.travelmo.core.programsFor
import app.travelmo.core.referenceLine
import app.travelmo.core.routeLine
import app.travelmo.core.segmentsByDay
import app.travelmo.core.timesLine
import app.travelmo.core.tripWarnings
import app.travelmo.log.TravelmoLog
import app.travelmo.ui.theme.TravelmoTheme
import app.travelmo.ui.theme.TextButtonInset
import com.mikelward.androidzoom.compose.pinchFontSizeHost

/**
 * A trip's bookings by day, as the web's trip page lists them. The owner and
 * a sharee add, edit, delete and move bookings (the rules decide finally);
 * the owner also renames, fits the dates, shares, merges and deletes the
 * trip, in the sections the web's page has.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TripDetailScreen(
    viewModel: TripsViewModel,
    tripId: String,
    uid: String,
    onBack: () -> Unit,
    onAddBooking: (defaultDate: String) -> Unit,
    onEditBooking: (segmentId: String) -> Unit,
    onMerged: (targetId: String) -> Unit,
) {
    val tripFlow = remember(tripId) { viewModel.trip(tripId) }
    val segmentsFlow = remember(tripId) { viewModel.segments(tripId) }
    val trip by tripFlow.collectAsStateWithLifecycle(initialValue = null)
    val trips by viewModel.trips.collectAsStateWithLifecycle()
    val segments by segmentsFlow.collectAsStateWithLifecycle(initialValue = emptyList())
    val flightStatusesFlow = remember(tripId) { viewModel.flightStatuses(tripId) }
    val flightStatuses by flightStatusesFlow.collectAsStateWithLifecycle(initialValue = emptyMap())
    // While the trip is in front, its flights near departure are looked at
    // as often as the parser allows, so the gate on screen is fresh.
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(tripId, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) {
                viewModel.refreshFlights(tripId)
                delay(60_000)
            }
        }
    }
    val loaded by viewModel.state.collectAsStateWithLifecycle()
    val people by viewModel.people.collectAsStateWithLifecycle()
    val ownProfile by viewModel.ownProfile.collectAsStateWithLifecycle()
    val gmailMailboxes by viewModel.gmailMailboxes.collectAsStateWithLifecycle()
    val rideSettings by viewModel.rideSettings.collectAsStateWithLifecycle()
    val addresses by viewModel.addresses.collectAsStateWithLifecycle()
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    var deleting by remember { mutableStateOf<Segment?>(null) }
    var moving by remember { mutableStateOf<Segment?>(null) }
    val current = trip
    val isOwner = current != null && current.ownerUid == uid
    val canEdit = current != null && !current.deleting && (isOwner || sharedWithAny(current.sharedWith, addresses))
    val canManage = isOwner && !current.deleting
    val targets = otherTrips(trips.orEmpty(), tripId)

    // The page's own writes, by token: a finished one is acknowledged here,
    // and a deletion or a merge leaves the page, even after a rotation.
    val prefix = "trip/$tripId/"
    val mine = outcomes.filterKeys { it.startsWith(prefix) }
    val errors = mine.mapNotNull { (token, outcome) -> (outcome as? Outcome.Failed)?.let { token to it.message } }
    val busy = mine.values.any { it is Outcome.Busy }
    LaunchedEffect(mine) {
        for ((token, outcome) in mine) {
            if (outcome !is Outcome.Done) continue
            viewModel.outcomeSeen(token)
            val action = token.removePrefix(prefix)
            when {
                action == "delete" -> onBack()
                action.startsWith("merge/") -> onMerged(action.removePrefix("merge/"))
            }
        }
    }
    val actions = TripActions(
        rename = { viewModel.renameTrip("${prefix}rename", tripId, it) },
        fit = { viewModel.fitTripDates("${prefix}fit", tripId) },
        share = { viewModel.shareTrip("${prefix}share", tripId, it) },
        unshare = { viewModel.unshareTrip("${prefix}unshare/$it", tripId, it) },
        delete = { viewModel.deleteTrip("${prefix}delete", tripId) },
        merge = { viewModel.mergeTrips("${prefix}merge/$it", tripId, it) },
    )
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(trip?.title ?: "", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.back))
                    }
                },
                actions = { AppMenu() },
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
            AppAlertDialog(
                onDismissRequest = { deleting = null },
                title = { Text(stringResource(R.string.delete_booking_title)) },
                text = { Text(stringResource(R.string.delete_booking_text, segment.title)) },
                confirmButton = {
                    TextButton(onClick = {
                        deleting = null
                        viewModel.deleteSegment("${prefix}segment/${segment.id}/delete", tripId, segment.id)
                    }) { Text(stringResource(R.string.delete)) }
                },
                dismissButton = { TextButton(onClick = { deleting = null }) { Text(stringResource(R.string.keep)) } },
            )
        }
        moving?.let { segment ->
            MoveDialog(segment, targets, onDismiss = { moving = null }) { target ->
                moving = null
                viewModel.moveSegment("${prefix}segment/${segment.id}/move", tripId, segment.id, target.id)
            }
        }
        when {
            current != null -> TripBody(
                current, segments, shared = current.ownerUid != uid, errors = errors, busy = busy,
                warnings = tripWarnings(people, current, segments, viewModel.today()), today = viewModel.today(),
                programsFor = { provider -> programsFor(provider, ownProfile?.let(::allLoyalty).orEmpty()) },
                flightLines = { segment -> viewModel.flightLines(segment, flightStatuses) },
                emailLink = { source -> emailLinkFor(source, uid, ownsTrip = isOwner, mailboxes = gmailMailboxes) },
                rides = RideSuggestions(
                    needs = viewModel.rideNeedsFor(segments, rideSettings).groupBy { it.segmentId },
                    companies = rideSettings?.companies.orEmpty(),
                    onHide = { need -> viewModel.hideRideNeed("${prefix}ride/${rideNeedKey(need)}", need) },
                ),
                bookingActions = if (canEdit) {
                    BookingActions(
                        onEdit = { onEditBooking(it.id) },
                        onDelete = { deleting = it },
                        onMove = if (targets.isEmpty()) null else { segment -> moving = segment },
                        onRestore = { segment -> viewModel.restoreSegment("${prefix}segment/${segment.id}/restore", tripId, segment.id) },
                    )
                } else {
                    null
                },
                tripActions = if (isOwner) actions else null,
                canManage = canManage,
                targets = targets,
                titles = displayTitles(trips.orEmpty()),
                modifier = Modifier.padding(padding),
            )
            loaded.groups == null -> Text(stringResource(R.string.trip_loading), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(padding).padding(16.dp))
            else -> Text(stringResource(R.string.trip_not_found), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(padding).padding(16.dp))
        }
    }
}

/** Car and ride suggestions by the flight they follow, with the viewer's own companies. */
class RideSuggestions(
    val needs: Map<String, List<RideNeed>> = emptyMap(),
    val companies: List<RideCompany> = emptyList(),
    val onHide: (RideNeed) -> Unit = {},
)

/** What a viewer who may edit can do to a booking. */
class BookingActions(
    val onEdit: (Segment) -> Unit,
    val onDelete: (Segment) -> Unit,
    val onMove: ((Segment) -> Unit)? = null,
    val onRestore: ((Segment) -> Unit)? = null,
)

/** What the owner can do to the trip. */
class TripActions(
    val rename: (String) -> Unit,
    val fit: () -> Unit,
    val share: (String) -> Unit,
    val unshare: (String) -> Unit,
    val delete: () -> Unit,
    val merge: (String) -> Unit,
)

@Composable
private fun TripBody(
    trip: Trip,
    segments: List<Segment>,
    shared: Boolean,
    /** What failed, by its write's token, so two alike messages still get their own rows. */
    errors: List<Pair<String, String>>,
    busy: Boolean,
    warnings: List<PersonWarning>,
    today: String,
    programsFor: (String?) -> List<ProfileEntry>,
    /** A flight's live gates and carousel. */
    flightLines: (Segment) -> List<String>,
    bookingActions: BookingActions?,
    emailLink: (SourceRef) -> String?,
    rides: RideSuggestions,
    tripActions: TripActions?,
    canManage: Boolean,
    targets: List<Trip>,
    /** Every trip's title as [displayTitles] shows it among the others. */
    titles: Map<String, String>,
    modifier: Modifier = Modifier,
) {
    val days = segmentsByDay(segments)
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    var renaming by rememberSaveable { mutableStateOf(false) }
    var confirmingDelete by rememberSaveable { mutableStateOf(false) }
    if (renaming && tripActions != null) {
        RenameDialog(trip.title, onDismiss = { renaming = false }) { title ->
            renaming = false
            tripActions.rename(title)
        }
    }
    if (confirmingDelete && tripActions != null) {
        AppAlertDialog(
            onDismissRequest = { confirmingDelete = false },
            title = { Text(stringResource(R.string.delete_trip_title)) },
            text = { Text(stringResource(R.string.delete_trip_text, trip.title)) },
            confirmButton = {
                TextButton(onClick = {
                    confirmingDelete = false
                    tripActions.delete()
                }) { Text(stringResource(R.string.delete)) }
            },
            dismissButton = { TextButton(onClick = { confirmingDelete = false }) { Text(stringResource(R.string.keep)) } },
        )
    }
    val list = rememberLazyListState()
    LazyColumn(modifier = modifier.fillMaxSize().scrollEdgeCue(list, scrollCueColors()), state = list, contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 96.dp)) {
        item(key = "dates") {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(formatDateRange(trip.shownStart, trip.shownEnd), style = MaterialTheme.typography.bodyMedium, color = muted)
                if (shared) Text(stringResource(R.string.badge_shared).uppercase(), style = MaterialTheme.typography.labelSmall, color = TravelmoTheme.colors.shared)
            }
            if (canManage && tripActions != null) {
                // Renaming and fitting the dates sit by the dates, as on the web;
                // fitting is offered only when the bookings span less than the trip.
                // Shifted by the buttons' own padding so their labels line up with the dates.
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.offset(x = -TextButtonInset),
                ) {
                    TextButton(onClick = { renaming = true }, enabled = !busy) { Text(stringResource(R.string.rename)) }
                    fittedRange(trip, segments)?.let { range ->
                        TextButton(onClick = tripActions.fit, enabled = !busy) { Text(stringResource(R.string.fit_dates, formatDateRange(range.first, range.second))) }
                    }
                }
            }
        }
        if (trip.deleting && tripActions != null) {
            item(key = "interrupted") { InterruptedDeletion(busy, tripActions.delete) }
        }
        for ((token, message) in errors) {
            item(key = "error-$token") { Text(message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp)) }
        }
        if (warnings.isNotEmpty()) {
            item(key = "warnings") { DocumentWarnings(warnings, today) }
        }
        if (days.isEmpty()) {
            item(key = "empty") {
                Text(stringResource(R.string.trip_no_bookings), color = muted, modifier = Modifier.padding(top = 16.dp))
            }
        }
        for ((date, items) in days) {
            item(key = "day-$date") {
                Text(formatDate(date), style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 20.dp, bottom = 4.dp))
            }
            items(items, key = { it.id }) { segment ->
                SegmentRow(segment, bookingActions, programs = programsFor(segment.provider), emailLink = emailLink, flightLines = flightLines(segment))
                for (need in rides.needs[segment.id].orEmpty()) {
                    RideSuggestion(need.kind, segment, rides.companies, onHide = { rides.onHide(need) })
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            }
        }
        if (canManage && tripActions != null) {
            item(key = "sharing") { Sharing(trip, busy, tripActions) }
            if (targets.isNotEmpty()) {
                item(key = "merge") { MergeInto(targets, titles, busy, tripActions.merge) }
            }
            item(key = "delete") {
                TextButton(onClick = { confirmingDelete = true }, enabled = !busy, modifier = Modifier.padding(top = 24.dp).offset(x = -TextButtonInset)) {
                    Text(stringResource(R.string.delete_trip), color = MaterialTheme.colorScheme.error)
                }
            }
        } else if (trip.sharedWith.isNotEmpty()) {
            item(key = "shared-with") {
                SectionTitle(stringResource(R.string.shared_with))
                for (address in trip.sharedWith) Text(address, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
}

/** A deletion the app was interrupted in: the trip can only be finished off. */
@Composable
private fun InterruptedDeletion(busy: Boolean, finish: () -> Unit) {
    val shape = RoundedCornerShape(8.dp)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 12.dp)
            .clip(shape)
            .border(1.dp, MaterialTheme.colorScheme.tertiary.copy(alpha = 0.4f), shape)
            .background(MaterialTheme.colorScheme.tertiaryContainer.copy(alpha = 0.5f))
            .padding(12.dp),
    ) {
        Text(stringResource(R.string.deleting_interrupted), style = MaterialTheme.typography.bodyMedium)
        Button(onClick = finish, enabled = !busy, modifier = Modifier.padding(top = 8.dp)) { Text(stringResource(R.string.finish_deleting)) }
    }
}

/** Who the trip is shared with, each removable, and an address to add. */
@Composable
private fun Sharing(trip: Trip, busy: Boolean, actions: TripActions) {
    var address by rememberSaveable { mutableStateOf("") }
    Column {
        SectionTitle(stringResource(R.string.shared_with))
        if (trip.sharedWith.isEmpty()) {
            Text(stringResource(R.string.only_you), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        for (email in trip.sharedWith) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Text(email, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                IconButton(onClick = { actions.unshare(email) }, enabled = !busy) {
                    Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.stop_sharing_with, email))
                }
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
            OutlinedTextField(
                value = address,
                onValueChange = { address = it },
                placeholder = { Text("partner@example.com") },
                singleLine = true,
                modifier = Modifier.weight(1f),
            )
            Button(onClick = { actions.share(address); address = "" }, enabled = !busy && address.isNotBlank()) { Text(stringResource(R.string.share)) }
        }
    }
}

/** The other trip this one's bookings go to, and the button that sends them. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun MergeInto(targets: List<Trip>, titles: Map<String, String>, busy: Boolean, merge: (String) -> Unit) {
    var targetId by rememberSaveable { mutableStateOf<String?>(null) }
    var open by remember { mutableStateOf(false) }
    val target = targets.firstOrNull { it.id == targetId }
    Column {
        SectionTitle(stringResource(R.string.merge_title))
        Text(stringResource(R.string.merge_text), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        ExposedDropdownMenuBox(expanded = open, onExpandedChange = { open = it }, modifier = Modifier.padding(top = 8.dp)) {
            OutlinedTextField(
                value = target?.let { tripChoice(it) } ?: "",
                onValueChange = {},
                readOnly = true,
                placeholder = { Text(stringResource(R.string.choose_trip)) },
                trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = open) },
                modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
            )
            ExposedDropdownMenu(expanded = open, onDismissRequest = { open = false }, modifier = Modifier.pinchFontSizeHost()) {
                for (t in targets) {
                    DropdownMenuItem(text = { Text(tripChoice(t)) }, onClick = { targetId = t.id; open = false })
                }
            }
        }
        Button(onClick = { target?.let { merge(it.id) } }, enabled = !busy && target != null, modifier = Modifier.padding(top = 8.dp)) {
            Text(stringResource(R.string.merge_into, target?.let { titles[it.id] ?: it.title } ?: "…"))
        }
    }
}

/** A trip as a choice reads as its title and dates. */
private fun tripChoice(trip: Trip) = "${trip.title} (${formatDateRange(trip.shownStart, trip.shownEnd)})"

@Composable
private fun RenameDialog(current: String, onDismiss: () -> Unit, onRename: (String) -> Unit) {
    var title by rememberSaveable { mutableStateOf(current) }
    AppAlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.rename_trip)) },
        text = { OutlinedTextField(value = title, onValueChange = { title = it }, singleLine = true, label = { Text(stringResource(R.string.trip_name)) }) },
        confirmButton = { TextButton(onClick = { onRename(title) }) { Text(stringResource(R.string.save)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}

/** The trips a booking can move to, one tap each. */
@Composable
private fun MoveDialog(segment: Segment, targets: List<Trip>, onDismiss: () -> Unit, onMove: (Trip) -> Unit) {
    AppAlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.move_booking_title, segment.title)) },
        text = {
            // A long travel history scrolls rather than running off the dialog.
            LazyColumn(modifier = Modifier.heightIn(max = 360.dp)) {
                items(targets, key = { it.id }) { t ->
                    Text(tripChoice(t), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.fillMaxWidth().clickable { onMove(t) }.padding(vertical = 12.dp))
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.cancel)) } },
    )
}

/**
 * One booking: its kind, title, route, times, reference and verdict, and a ⋮
 * menu: copying the reference and the sources for anyone, the actions when
 * the viewer may edit. [emailLink] is the Gmail link of a source the viewer
 * imported, else null.
 */
@Composable
fun SegmentRow(
    segment: Segment,
    actions: BookingActions? = null,
    programs: List<ProfileEntry> = emptyList(),
    emailLink: (SourceRef) -> String? = { null },
    flightLines: List<String> = emptyList(),
) {
    val context = LocalContext.current
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    var menu by remember { mutableStateOf(false) }
    var showingSources by rememberSaveable(segment.id) { mutableStateOf(false) }
    val hasSources = segment.sources.isNotEmpty() || segment.sender != null
    val reference = segment.confirmation?.trim()?.takeIf { it.isNotEmpty() }
    if (showingSources && hasSources) {
        SourcesDialog(segment, emailLink, onDismiss = { showingSources = false })
    }
    Row(modifier = Modifier.padding(vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Icon(
            painterResource(segmentIcon(segment.type)),
            contentDescription = segment.type.label,
            tint = muted,
            modifier = Modifier.padding(top = 2.dp).size(24.dp),
        )
        Column(modifier = Modifier.weight(1f)) {
            // As on the web: a cancelled booking stays listed, struck through.
            if (segment.isCancelled) {
                Text(stringResource(R.string.cancelled).uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
            }
            Text(
                segment.title,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Medium,
                textDecoration = if (segment.isCancelled) TextDecoration.LineThrough else null,
            )
            routeLine(segment)?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = muted) }
            timesLine(segment)?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = muted) }
            if (flightLines.isNotEmpty()) {
                Text(flightLines.joinToString(" · "), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.tertiary)
            }
            referenceLine(segment)?.let { line ->
                // A long press on the line copies the reference too, as ⋮ does.
                val copy = reference?.let { ref -> Modifier.longPressUnlessPinch(stringResource(R.string.copy_reference)) { copyReference(context, ref) } } ?: Modifier
                Text(line, style = MaterialTheme.typography.bodySmall, color = muted, modifier = Modifier.padding(top = 4.dp).then(copy))
            }
            // One program a line, so whose each number is stays plain.
            if (programs.isNotEmpty()) {
                Text(programs.joinToString("\n", transform = ::loyaltyLine), style = MaterialTheme.typography.bodySmall, color = muted, modifier = Modifier.padding(top = 4.dp))
            }
            segment.notes?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = muted, modifier = Modifier.padding(top = 4.dp)) }
            Verdict(segment)
        }
        if (actions != null || hasSources || reference != null) {
            Box {
                IconButton(onClick = { menu = true }, modifier = Modifier.size(32.dp)) {
                    Icon(Icons.Filled.MoreVert, contentDescription = stringResource(R.string.booking_actions), tint = muted)
                }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, modifier = Modifier.pinchFontSizeHost()) {
                    reference?.let { ref ->
                        DropdownMenuItem(text = { Text(stringResource(R.string.copy_reference)) }, onClick = { menu = false; copyReference(context, ref) })
                    }
                    if (hasSources) {
                        DropdownMenuItem(text = { Text(stringResource(R.string.sources)) }, onClick = { menu = false; showingSources = true })
                    }
                    if (actions != null) {
                        DropdownMenuItem(text = { Text(stringResource(R.string.edit)) }, onClick = { menu = false; actions.onEdit(segment) })
                        if (segment.isCancelled) {
                            actions.onRestore?.let { restore ->
                                DropdownMenuItem(text = { Text(stringResource(R.string.restore)) }, onClick = { menu = false; restore(segment) })
                            }
                        }
                        actions.onMove?.let { move ->
                            DropdownMenuItem(text = { Text(stringResource(R.string.move_to)) }, onClick = { menu = false; move(segment) })
                        }
                        DropdownMenuItem(text = { Text(stringResource(R.string.delete)) }, onClick = { menu = false; actions.onDelete(segment) })
                    }
                }
            }
        }
    }
}

/**
 * Every email, TripIt trip or calendar event the booking was read from, as
 * the web's trip page lists them, then the sender. An email the viewer
 * imported opens in Gmail; others' are in a mailbox the viewer can't open.
 */
@Composable
private fun SourcesDialog(segment: Segment, emailLink: (SourceRef) -> String?, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val openLabel = stringResource(R.string.open_in_gmail)
    AppAlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(R.string.sources)) },
        text = {
            Column(modifier = Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState())) {
                for (source in segment.sources) {
                    val kind = stringResource(sourceKindLabel(source.kind))
                    val link = emailLink(source)
                    val open = if (link != null) {
                        Modifier.clickable(onClickLabel = openLabel, role = Role.Button) { openLink(context, link, "a booking's email") }
                    } else {
                        Modifier
                    }
                    Column(modifier = Modifier.fillMaxWidth().then(open).padding(vertical = 8.dp)) {
                        Text(
                            source.label ?: kind,
                            style = MaterialTheme.typography.bodyLarge,
                            // Underlined as a link: the theme's primary is near-black, as on the web.
                            textDecoration = if (link != null) TextDecoration.Underline else null,
                        )
                        if (source.label != null) Text(kind, style = MaterialTheme.typography.bodySmall, color = muted)
                    }
                }
                segment.sender?.let {
                    Text(stringResource(R.string.from_sender, it), style = MaterialTheme.typography.bodyMedium, color = muted, modifier = Modifier.padding(vertical = 8.dp))
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.close)) } },
    )
}

/**
 * Puts a booking's reference, alone, on the clipboard. No toast: Android 13
 * and later (all the app runs on) confirm a copy themselves.
 */
private fun copyReference(context: Context, reference: String) {
    val clipboard = context.getSystemService(ClipboardManager::class.java)
    if (clipboard == null) {
        TravelmoLog.warning("No clipboard to copy a booking reference to")
        return
    }
    clipboard.setPrimaryClip(ClipData.newPlainText(context.getString(R.string.booking_reference), reference))
}

@StringRes
private fun sourceKindLabel(kind: SourceKind): Int = when (kind) {
    SourceKind.GMAIL -> R.string.source_gmail
    SourceKind.TRIPIT -> R.string.source_tripit
    SourceKind.ICS -> R.string.source_ics
    SourceKind.FORWARD -> R.string.source_forward
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

/** The icon for a booking's type, from scripts/segment-icons.mjs. */
@DrawableRes
fun segmentIcon(type: SegmentType): Int = when (type) {
    SegmentType.FLIGHT -> R.drawable.ic_segment_flight
    SegmentType.TRAIN -> R.drawable.ic_segment_train
    SegmentType.BUS -> R.drawable.ic_segment_bus
    SegmentType.FERRY -> R.drawable.ic_segment_ferry
    SegmentType.LODGING -> R.drawable.ic_segment_lodging
    SegmentType.CAR_RENTAL -> R.drawable.ic_segment_car_rental
    SegmentType.ACTIVITY -> R.drawable.ic_segment_activity
    SegmentType.OTHER -> R.drawable.ic_segment_other
}
