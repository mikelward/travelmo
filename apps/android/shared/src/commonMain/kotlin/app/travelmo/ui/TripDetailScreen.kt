package app.travelmo.ui

import app.travelmo.shared.split_move
import app.travelmo.shared.split_trip_hint
import app.travelmo.shared.split_trip_title
import app.travelmo.shared.split
import app.travelmo.shared.travelers_hint
import app.travelmo.shared.travelers_menu
import app.travelmo.shared.travelers_title
import app.travelmo.core.compareInstants
import app.travelmo.core.sourceGroups
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
import app.travelmo.shared.ic_segment_train
import app.travelmo.shared.ic_segment_other
import app.travelmo.shared.ic_segment_lodging
import app.travelmo.shared.ic_segment_flight
import app.travelmo.shared.ic_segment_ferry
import app.travelmo.shared.ic_segment_car_rental
import app.travelmo.shared.ic_segment_bus
import app.travelmo.shared.ic_segment_activity
import app.travelmo.shared.ic_segment_meal
import app.travelmo.shared.booking_reference
import org.jetbrains.compose.resources.painterResource
import org.jetbrains.compose.resources.DrawableResource
import org.jetbrains.compose.resources.pluralStringResource
import app.travelmo.shared.never_import_sender
import app.travelmo.shared.always_import_sender
import app.travelmo.shared.sender_cleanup_text
import app.travelmo.shared.sender_cleanup_title
import app.travelmo.shared.this_and_that
import app.travelmo.shared.bookings_count
import app.travelmo.shared.trips_count
import org.jetbrains.compose.resources.StringResource
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
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.travelmo.core.journeyGapKey
import app.travelmo.core.tripTravelers
import app.travelmo.core.namedTravelers
import app.travelmo.core.MixedTrip
import app.travelmo.core.mixedTrip
import app.travelmo.core.watching
import androidx.lifecycle.repeatOnLifecycle
import app.travelmo.core.MAX_TRIP_REMINDERS
import app.travelmo.core.PersonWarning
import app.travelmo.core.RideCompany
import app.travelmo.core.RideNeed
import app.travelmo.core.Segment
import app.travelmo.core.FlightCheckIn
import app.travelmo.core.flightCheckInState
import app.travelmo.core.SegmentType
import app.travelmo.core.SourceKind
import app.travelmo.core.SourceRef
import app.travelmo.core.Trip
import app.travelmo.core.displayTitles
import app.travelmo.core.sourceSearch
import app.travelmo.core.fittedRange
import app.travelmo.core.formatDate
import app.travelmo.core.localDate
import app.travelmo.core.localTime
import app.travelmo.core.formatDateRange
import app.travelmo.core.isCancelled
import app.travelmo.core.directionsUrl
import app.travelmo.core.nearbyTrips
import app.travelmo.core.otherTrips
import app.travelmo.core.rideNeedKey
import app.travelmo.core.bookingHeading
import app.travelmo.core.headedRouteLine
import app.travelmo.core.segmentsByDay
import app.travelmo.core.sharedWithAny
import app.travelmo.core.SenderCleanup
import app.travelmo.core.shownEnd
import app.travelmo.core.shownStart
import app.travelmo.core.timesLine
import app.travelmo.core.tripWarnings
import app.travelmo.shared.Res
import app.travelmo.shared.add_booking
import app.travelmo.shared.back
import app.travelmo.shared.badge_shared
import app.travelmo.shared.watching_hint
import app.travelmo.shared.booking_actions
import app.travelmo.shared.cancel
import app.travelmo.shared.cancelled
import app.travelmo.shared.checked_in
import app.travelmo.shared.checked_in_action
import app.travelmo.shared.undo
import app.travelmo.shared.choose_trip
import app.travelmo.shared.close
import app.travelmo.shared.copy_reference
import app.travelmo.shared.delete
import app.travelmo.shared.delete_booking_text
import app.travelmo.shared.delete_booking_title
import app.travelmo.shared.delete_trip
import app.travelmo.shared.delete_trip_text
import app.travelmo.shared.delete_trip_title
import app.travelmo.shared.deleting_interrupted
import app.travelmo.shared.edit
import app.travelmo.shared.finish_deleting
import app.travelmo.shared.fit_dates
import app.travelmo.shared.from_sender
import app.travelmo.shared.keep
import app.travelmo.shared.mark_cancelled
import app.travelmo.shared.mark_trip_cancelled
import app.travelmo.shared.merge_into
import app.travelmo.shared.merge_text
import app.travelmo.shared.merge_title
import app.travelmo.shared.directions
import app.travelmo.shared.booking_details
import app.travelmo.shared.more_trips
import app.travelmo.shared.move_booking_title
import app.travelmo.shared.new_trip
import app.travelmo.shared.merge_booking_hint
import app.travelmo.shared.merge_booking_title
import app.travelmo.shared.merge_booking_with
import app.travelmo.shared.move_to
import app.travelmo.shared.only_you
import app.travelmo.shared.open_in_gmail
import app.travelmo.shared.rename
import app.travelmo.shared.rename_trip
import app.travelmo.shared.restore
import app.travelmo.shared.save
import app.travelmo.shared.share
import app.travelmo.shared.shared_with
import app.travelmo.shared.source_fastmail
import app.travelmo.shared.source_forward
import app.travelmo.shared.source_gmail
import app.travelmo.shared.source_ics
import app.travelmo.shared.source_imap
import app.travelmo.shared.source_tripit
import app.travelmo.shared.sources
import app.travelmo.shared.stop_sharing_with
import app.travelmo.shared.trip_cancelled
import app.travelmo.shared.trip_loading
import app.travelmo.shared.trip_name
import app.travelmo.shared.trip_no_bookings
import app.travelmo.shared.trip_not_found
import app.travelmo.ui.theme.TextButtonInset
import app.travelmo.ui.theme.TravelmoTheme
import kotlinx.coroutines.delay
import org.jetbrains.compose.resources.stringResource

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
    onOpenBooking: (segmentId: String) -> Unit = {},
) {
    val tripFlow = remember(tripId) { viewModel.trip(tripId) }
    val segmentsFlow = remember(tripId) { viewModel.segments(tripId) }
    val initialTrip = remember(tripId) { viewModel.peekTrip(tripId) }
    val initialSegments = remember(tripId) { viewModel.peekSegments(tripId).orEmpty() }
    val trip by tripFlow.collectAsStateWithLifecycle(initialValue = initialTrip)
    val trips by viewModel.trips.collectAsStateWithLifecycle()
    val titles by viewModel.titles.collectAsStateWithLifecycle()
    val segments by segmentsFlow.collectAsStateWithLifecycle(initialValue = initialSegments)
    val flightStatusesFlow = remember(tripId) { viewModel.flightStatuses(tripId) }
    val flightStatuses by flightStatusesFlow.collectAsStateWithLifecycle(initialValue = emptyMap())
    val checkedInFlow = remember(tripId) { viewModel.checkedIn(tripId) }
    val checkedIn by checkedInFlow.collectAsStateWithLifecycle(initialValue = null)
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
    val people by viewModel.people.collectAsStateWithLifecycle()
    val travelers by viewModel.travelers.collectAsStateWithLifecycle()
    val rideSettings by viewModel.rideSettings.collectAsStateWithLifecycle()
    val standingReminders by viewModel.standingReminders.collectAsStateWithLifecycle()
    val myChecklistFlow = remember(tripId) { viewModel.myChecklist(tripId) }
    val myChecklist by myChecklistFlow.collectAsStateWithLifecycle(initialValue = null)
    val addresses by viewModel.addresses.collectAsStateWithLifecycle()
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    val looks by viewModel.looks.collectAsStateWithLifecycle()
    val cleanup by viewModel.senderCleanup.collectAsStateWithLifecycle()
    var deleting by remember { mutableStateOf<Segment?>(null) }
    var moving by remember { mutableStateOf<Segment?>(null) }
    var merging by remember { mutableStateOf<Segment?>(null) }
    var renaming by rememberSaveable { mutableStateOf(false) }
    var splitting by rememberSaveable { mutableStateOf(false) }
    var editingTravelers by rememberSaveable { mutableStateOf(false) }
    val current = trip
    val isOwner = current != null && current.ownerUid == uid
    val canEdit = current != null && !current.deleting && (isOwner || sharedWithAny(current.sharedWith, addresses))
    val canManage = isOwner && !current.deleting
    val targets = remember(trips, tripId) { otherTrips(trips.orEmpty(), tripId) }

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
                action == "delete" || action == "sender-cleanup/leave" -> onBack()
                action.startsWith("merge/") -> onMerged(action.removePrefix("merge/"))
                action == "split" -> viewModel.splitTarget(token)?.let(onMerged)
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
        cancel = { viewModel.cancelTrip("${prefix}cancel", tripId) },
        restore = { viewModel.restoreTrip("${prefix}restore", tripId) },
    )
    Scaffold(
        topBar = {
            AppTopBar(
                trip?.title ?: "",
                navigation = TopBarNavigation.Back(onBack),
                // Adding a booking leads the trip's own menu, for those who may edit it.
                menuItems = { close ->
                    current?.takeIf { canEdit }?.let { editable ->
                        DropdownMenuItem(text = { Text(stringResource(Res.string.add_booking)) }, onClick = { close(); onAddBooking(editable.start) })
                    }
                    if (canManage) {
                        DropdownMenuItem(text = { Text(stringResource(Res.string.rename)) }, enabled = !busy, onClick = { close(); renaming = true })
                        if (segments.size > 1) {
                            DropdownMenuItem(text = { Text(stringResource(Res.string.split)) }, enabled = !busy, onClick = { close(); splitting = true })
                        }
                        if (current != null && namedTravelers(segments, current.removedTravelers).isNotEmpty()) {
                            DropdownMenuItem(text = { Text(stringResource(Res.string.travelers_menu)) }, enabled = !busy, onClick = { close(); editingTravelers = true })
                        }
                    }
                },
            )
        },
    ) { padding ->
        if (renaming && current != null) {
            RenameDialog(current.title, onDismiss = { renaming = false }) { title ->
                renaming = false
                actions.rename(title)
            }
        }
        if (splitting && segments.size > 1) {
            SplitDialog(segments, onDismiss = { splitting = false }) { ids ->
                splitting = false
                viewModel.splitTrip("${prefix}split", tripId, ids)
            }
        }
        if (editingTravelers && current != null) {
            TravelersDialog(segments, current.removedTravelers, onDismiss = { editingTravelers = false }) { removed ->
                editingTravelers = false
                viewModel.setRemovedTravelers("${prefix}travelers", tripId, removed)
            }
        }
        deleting?.let { segment ->
            AppAlertDialog(
                onDismissRequest = { deleting = null },
                title = { Text(stringResource(Res.string.delete_booking_title)) },
                text = { Text(stringResource(Res.string.delete_booking_text, segment.title)) },
                confirmButton = {
                    TextButton(onClick = {
                        deleting = null
                        viewModel.deleteSegment("${prefix}segment/${segment.id}/delete", tripId, segment.id)
                    }) { Text(stringResource(Res.string.delete)) }
                },
                dismissButton = { TextButton(onClick = { deleting = null }) { Text(stringResource(Res.string.keep)) } },
            )
        }
        SenderCleanupDialog(viewModel, cleanup) { plan ->
            val leave = if (plan.trips.any { it.id == tripId }) "leave" else "stay"
            viewModel.removeSenderBookings("${prefix}sender-cleanup/$leave")
        }
        merging?.let { segment ->
            MergeDialog(segments.filter { it.id != segment.id && it.type == segment.type }, onDismiss = { merging = null }) { other ->
                merging = null
                viewModel.mergeSegments("${prefix}segment/${segment.id}/merge", tripId, segment.id, other.id)
            }
        }
        moving?.let { segment ->
            MoveDialog(
                segment,
                targets,
                onDismiss = { moving = null },
                onMoveToNew = if (isOwner) {
                    {
                        moving = null
                        viewModel.moveSegmentToNewTrip("${prefix}segment/${segment.id}/move", tripId, segment.id)
                    }
                } else {
                    null
                },
            ) { target ->
                moving = null
                viewModel.moveSegment("${prefix}segment/${segment.id}/move", tripId, segment.id, target.id)
            }
        }
        // Watching it, what is the user's own leaves it out: warnings, check-in, rides and the checklist.
        val today by viewModel.clockToday.collectAsStateWithLifecycle(initialValue = viewModel.today())
        val upcomingOrCurrent = current == null || current.shownEnd >= today
        val nowFlow = remember(upcomingOrCurrent) {
            if (upcomingOrCurrent) viewModel.clockNow else kotlinx.coroutines.flow.flowOf(viewModel.now())
        }
        val currentNow by nowFlow.collectAsStateWithLifecycle(initialValue = viewModel.now())
        val removedTravelers = current?.removedTravelers.orEmpty()
        val onlyWatching = remember(segments, travelers, removedTravelers) { watching(tripTravelers(segments, removedTravelers), travelers, removedTravelers) }
        // Bookings that look like two trips in one, unless the owner said it is one.
        val oneTrip = current?.oneTrip == true
        val mixed = remember(segments, oneTrip, removedTravelers) { if (oneTrip) null else mixedTrip(segments, removedTravelers) }
        val warnings = remember(onlyWatching, people, current, segments, today) {
            if (onlyWatching || current == null) emptyList() else tripWarnings(people, current, segments, today)
        }
        val rideNeedsBySegment = remember(onlyWatching, segments, rideSettings, currentNow) {
            if (onlyWatching) emptyMap() else viewModel.rideNeedsFor(segments, rideSettings, currentNow).groupBy { it.segmentId }
        }
        val gaps = remember(current, segments, rideSettings) {
            if (current == null) emptyList() else viewModel.journeyGapsFor(current, segments, rideSettings)
        }
        val checklistEntries = remember(onlyWatching, current, segments, standingReminders, myChecklist, rideSettings, today) {
            if (onlyWatching || current == null) null else viewModel.checklistFor(current, segments, standingReminders, myChecklist, rideSettings, today)
        }
        when {
            current != null -> TripBody(
                current, segments, shared = current.ownerUid != uid, errors = errors, busy = busy,
                watching = onlyWatching,
                warnings = warnings, today = today,
                flightLines = { segment -> viewModel.flightLines(segment, flightStatuses, currentNow) },
                checkIn = { segment ->
                    checkedIn?.takeUnless { onlyWatching }?.let { flightCheckInState(segment, it, currentNow) }?.let { state ->
                        SegmentCheckIn(state) { on -> viewModel.setCheckedIn("${prefix}checked-in/${segment.id}", tripId, segment.id, on) }
                    }
                },
                onOpenBooking = { onOpenBooking(it.id) },
                rides = RideSuggestions(
                    needs = rideNeedsBySegment,
                    companies = rideSettings?.companies.orEmpty(),
                    onHide = { need -> viewModel.hideRideNeed("${prefix}ride/${rideNeedKey(need)}", need) },
                ),
                mixedTrip = mixed?.let { found ->
                    MixedTripActions(
                        found,
                        onSplit = if (canManage && segments.size > 1) { { splitting = true } } else null,
                        onTravelers = if (canManage && found is MixedTrip.Travelers) { { editingTravelers = true } } else null,
                        onOneTrip = if (canManage) { { viewModel.markOneTrip("${prefix}one-trip", tripId) } } else null,
                    )
                },
                journeyGap = gaps.takeIf { it.isNotEmpty() }?.let { foundGaps ->
                    JourneyGapActions(
                        foundGaps,
                        lookOf = { gap ->
                            GapLook(
                                found = looks[journeyGapKey(tripId, gap)],
                                outcome = outcomes[viewModel.lookToken(tripId, gap)],
                            )
                        },
                        onLook = if (viewModel.canLook) { gap -> viewModel.lookForJourney(tripId, gap) } else null,
                        onAdd = if (canEdit) onAddBooking else null,
                        onOneWay = { viewModel.markOneWay("${prefix}one-way", tripId) },
                    )
                },
                bookingActions = if (canEdit) {
                    BookingActions(
                        onEdit = { onEditBooking(it.id) },
                        onDelete = { deleting = it },
                        // A new trip only for the owner: a sharee's would take the booking from the owner's sight.
                        onMove = if (targets.isEmpty() && !isOwner) null else { segment -> moving = segment },
                        onMerge = { segment -> merging = segment },
                        canMerge = { segment -> segments.any { it.id != segment.id && it.type == segment.type } },
                        onRestore = { segment -> viewModel.restoreSegment("${prefix}segment/${segment.id}/restore", tripId, segment.id) },
                        onMarkCancelled = { segment -> viewModel.cancelSegment("${prefix}segment/${segment.id}/cancel", tripId, segment.id) },
                        // One cancelled with its trip comes back with the trip.
                        canRestore = { segment -> current.cancelledAt == null || segment.userCancelled != "trip" },
                    )
                } else {
                    null
                },
                tripActions = if (isOwner) actions else null,
                // The viewer's own reminders before the trip, theirs alone, shared trip or not.
                checklist = checklistEntries?.let { entries ->
                    Checklist(
                        entries = entries,
                        onTick = { entry, done -> viewModel.setReminderDone("${prefix}checklist/${entry.id}/done", tripId, entry.id, done) },
                        onRemove = { entry -> viewModel.removeReminder("${prefix}checklist/${entry.id}/remove", tripId, entry.slot) },
                        onAdd = { reminder -> viewModel.saveReminder("${prefix}checklist/add", tripId, reminder) },
                        canAdd = myChecklist?.added.orEmpty().size < MAX_TRIP_REMINDERS,
                    )
                },
                canManage = canManage,
                targets = targets,
                titles = titles,
                modifier = Modifier.padding(padding),
            )
            trips == null -> Text(stringResource(Res.string.trip_loading), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(padding).padding(16.dp))
            else -> Text(stringResource(Res.string.trip_not_found), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(padding).padding(16.dp))
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
    /** Offers the trip's other bookings of its kind to merge into it; offered only where [canMerge]. */
    val onMerge: ((Segment) -> Unit)? = null,
    val canMerge: (Segment) -> Boolean = { false },
    val onRestore: ((Segment) -> Unit)? = null,
    /** Says it didn't happen; offered only while it's booked. */
    val onMarkCancelled: ((Segment) -> Unit)? = null,
    val canRestore: (Segment) -> Boolean = { true },
)

/** The owner's sender rules, offered from a booking's Sources; each null where it already stands. */
class SenderOffers(val always: (() -> Unit)?, val never: (() -> Unit)?)

/** What the owner can do to the trip. */
class TripActions(
    val rename: (String) -> Unit,
    val fit: () -> Unit,
    val share: (String) -> Unit,
    val unshare: (String) -> Unit,
    val delete: () -> Unit,
    val merge: (String) -> Unit,
    val cancel: () -> Unit = {},
    val restore: () -> Unit = {},
)

@Composable
private fun TripBody(
    trip: Trip,
    segments: List<Segment>,
    shared: Boolean,
    /** Whether the user is only watching this trip: none of its travelers is them. */
    watching: Boolean = false,
    /** What failed, by its write's token, so two alike messages still get their own rows. */
    errors: List<Pair<String, String>>,
    busy: Boolean,
    warnings: List<PersonWarning>,
    today: String,
    /** A flight's live gates and carousel. */
    flightLines: (Segment) -> List<String>,
    /** A flight's "I've checked in", the viewer's own: offered, or marked with an undo. */
    checkIn: (Segment) -> SegmentCheckIn? = { null },
    bookingActions: BookingActions?,
    /** Opens a booking's details. */
    onOpenBooking: (Segment) -> Unit,
    rides: RideSuggestions,
    /** A journey the trip seems to be missing; null when nothing is. */
    mixedTrip: MixedTripActions? = null,
    journeyGap: JourneyGapActions? = null,
    tripActions: TripActions?,
    checklist: Checklist?,
    canManage: Boolean,
    targets: List<Trip>,
    /** Every trip's title as [displayTitles] shows it among the others. */
    titles: Map<String, String>,
    modifier: Modifier = Modifier,
) {
    val days = remember(segments) { segmentsByDay(segments) }
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    var confirmingDelete by rememberSaveable { mutableStateOf(false) }
    if (confirmingDelete && tripActions != null) {
        AppAlertDialog(
            onDismissRequest = { confirmingDelete = false },
            title = { Text(stringResource(Res.string.delete_trip_title)) },
            text = { Text(stringResource(Res.string.delete_trip_text, trip.title)) },
            confirmButton = {
                TextButton(onClick = {
                    confirmingDelete = false
                    tripActions.delete()
                }) { Text(stringResource(Res.string.delete)) }
            },
            dismissButton = { TextButton(onClick = { confirmingDelete = false }) { Text(stringResource(Res.string.keep)) } },
        )
    }
    val list = rememberLazyListState()
    LazyColumn(modifier = modifier.fillMaxSize().scrollEdgeCue(list, scrollCueColors()), state = list, contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 24.dp)) {
        item(key = "dates") {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(formatDateRange(trip.shownStart, trip.shownEnd), style = MaterialTheme.typography.bodyLarge, color = muted)
                if (shared) Text(stringResource(Res.string.badge_shared).uppercase(), style = MaterialTheme.typography.labelSmall, color = TravelmoTheme.colors.shared)
            }
            if (watching) Text(stringResource(Res.string.watching_hint), style = MaterialTheme.typography.bodyLarge, color = muted)
            if (canManage && tripActions != null) {
                // Fitting the dates sits by them, offered only when the bookings span less
                // than the trip; Rename is in the ⋮ menu. Shifted by the button's own padding
                // so its label lines up with the dates.
                fittedRange(trip, segments)?.let { range ->
                    TextButton(onClick = tripActions.fit, enabled = !busy, modifier = Modifier.offset(x = -TextButtonInset)) {
                        Text(stringResource(Res.string.fit_dates, formatDateRange(range.first, range.second)))
                    }
                }
            }
        }
        if (trip.deleting && tripActions != null) {
            item(key = "interrupted") { InterruptedDeletion(busy, tripActions.delete) }
        }
        if (trip.cancelledAt != null) {
            item(key = "cancelled") {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 8.dp)) {
                    Text(stringResource(Res.string.trip_cancelled), style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.error)
                    if (canManage && tripActions != null) {
                        TextButton(onClick = tripActions.restore, enabled = !busy) { Text(stringResource(Res.string.restore)) }
                    }
                }
            }
        }
        for ((token, message) in errors) {
            item(key = "error-$token") { Text(message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(top = 8.dp)) }
        }
        if (warnings.isNotEmpty()) {
            item(key = "warnings") { DocumentWarnings(warnings, today) }
        }
        mixedTrip?.let { actions -> item(key = "mixed-trip") { MixedTripNotice(actions, busy) } }
        journeyGap?.let { actions -> item(key = "journey-gap") { JourneyGapNotice(actions, busy) } }
        if (checklist != null) {
            item(key = "before-you-go") { BeforeYouGo(checklist, today) }
        }
        if (days.isEmpty()) {
            item(key = "empty") {
                Text(stringResource(Res.string.trip_no_bookings), color = muted, modifier = Modifier.padding(top = 16.dp))
            }
        }
        for ((date, items) in days) {
            item(key = "day-$date") {
                Text(formatDate(date), style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 20.dp, bottom = 12.dp))
            }
            // One card per day, a rule between its bookings: each booking draws its part of the card.
            itemsIndexed(items, key = { _, it -> it.id }) { index, segment ->
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .sectionPart(first = index == 0, last = index == items.lastIndex, color = MaterialTheme.colorScheme.outlineVariant),
                ) {
                    SegmentRow(segment, bookingActions, flightLines = flightLines(segment), checkIn = checkIn(segment), onOpen = { onOpenBooking(segment) })
                    for (need in rides.needs[segment.id].orEmpty()) {
                        RideSuggestion(need.kind, segment, rides.companies, onHide = { rides.onHide(need) }, modifier = Modifier.padding(horizontal = 16.dp))
                    }
                }
            }
        }
        if (canManage && tripActions != null) {
            item(key = "sharing") { Sharing(trip, busy, tripActions) }
            if (targets.isNotEmpty()) {
                item(key = "merge") { MergeInto(targets, titles, busy, tripActions.merge) }
            }
            if (trip.cancelledAt == null) {
                item(key = "cancel") {
                    TextButton(onClick = tripActions.cancel, enabled = !busy, modifier = Modifier.padding(top = 24.dp).offset(x = -TextButtonInset)) {
                        Text(stringResource(Res.string.mark_trip_cancelled))
                    }
                }
            }
            item(key = "delete") {
                TextButton(onClick = { confirmingDelete = true }, enabled = !busy, modifier = Modifier.padding(top = if (trip.cancelledAt == null) 0.dp else 24.dp).offset(x = -TextButtonInset)) {
                    Text(stringResource(Res.string.delete_trip), color = MaterialTheme.colorScheme.error)
                }
            }
        } else if (trip.sharedWith.isNotEmpty()) {
            item(key = "shared-with") {
                SectionTitle(stringResource(Res.string.shared_with))
                for (address in trip.sharedWith) Text(address, style = MaterialTheme.typography.bodyLarge)
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
        Text(stringResource(Res.string.deleting_interrupted), style = MaterialTheme.typography.bodyLarge)
        Button(onClick = finish, enabled = !busy, modifier = Modifier.padding(top = 8.dp)) { Text(stringResource(Res.string.finish_deleting)) }
    }
}

/** Who the trip is shared with, each removable, and an address to add. */
@Composable
private fun Sharing(trip: Trip, busy: Boolean, actions: TripActions) {
    var address by rememberSaveable { mutableStateOf("") }
    Column {
        SectionTitle(stringResource(Res.string.shared_with))
        if (trip.sharedWith.isEmpty()) {
            Text(stringResource(Res.string.only_you), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        for (email in trip.sharedWith) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Text(email, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                IconButton(onClick = { actions.unshare(email) }, enabled = !busy) {
                    Icon(Icons.Filled.Close, contentDescription = stringResource(Res.string.stop_sharing_with, email))
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
            Button(onClick = { actions.share(address); address = "" }, enabled = !busy && address.isNotBlank()) { Text(stringResource(Res.string.share)) }
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
        SectionTitle(stringResource(Res.string.merge_title))
        Text(stringResource(Res.string.merge_text), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        ExposedDropdownMenuBox(expanded = open, onExpandedChange = { open = it }, modifier = Modifier.padding(top = 8.dp)) {
            OutlinedTextField(
                value = target?.let { tripChoice(it) } ?: "",
                onValueChange = {},
                readOnly = true,
                placeholder = { Text(stringResource(Res.string.choose_trip)) },
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
            Text(stringResource(Res.string.merge_into, target?.let { titles[it.id] ?: it.title } ?: "…"))
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
        title = { Text(stringResource(Res.string.rename_trip)) },
        text = { OutlinedTextField(value = title, onValueChange = { title = it }, singleLine = true, label = { Text(stringResource(Res.string.trip_name)) }) },
        confirmButton = { TextButton(onClick = { onRename(title) }) { Text(stringResource(Res.string.save)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(Res.string.cancel)) } },
    )
}

/**
 * Split…: some of the trip's bookings into a new trip of their own, picked one by one or all those from one email at
 * once (sourceGroups), as when someone else's forwarded itinerary was filed into the user's own trip. As the web's.
 */
@Composable
private fun SplitDialog(segments: List<Segment>, onDismiss: () -> Unit, onSplit: (List<String>) -> Unit) {
    var picked by rememberSaveable { mutableStateOf(emptySet<String>()) }
    val groups = remember(segments) { sourceGroups(segments) }
    val sorted = remember(segments) { segments.sortedWith { a, b -> compareInstants(a.start, b.start) } }
    AppAlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(Res.string.split_trip_title)) },
        text = {
            LazyColumn(modifier = Modifier.heightIn(max = 420.dp)) {
                item(key = "hint") {
                    Text(stringResource(Res.string.split_trip_hint), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                items(groups, key = { "source/${it.source.kind.wire}/${it.source.id}" }) { group ->
                    val all = group.segmentIds.all { it in picked }
                    FilterChip(
                        selected = all,
                        onClick = { picked = if (all) picked - group.segmentIds.toSet() else picked + group.segmentIds },
                        label = { Text("${group.source.label ?: stringResource(sourceKindLabel(group.source.kind))} (${group.segmentIds.size})", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        modifier = Modifier.padding(top = 8.dp),
                    )
                }
                items(sorted, key = { it.id }) { segment ->
                    val on = segment.id in picked
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.fillMaxWidth().toggleable(value = on, role = Role.Checkbox) { picked = if (it) picked + segment.id else picked - segment.id }.padding(vertical = 6.dp),
                    ) {
                        Checkbox(checked = on, onCheckedChange = null)
                        Column(modifier = Modifier.padding(start = 12.dp)) {
                            Text(bookingHeading(segment).headline, style = MaterialTheme.typography.bodyLarge)
                            Text(formatDate(localDate(segment.start)), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onSplit(sorted.map { it.id }.filter { it in picked }) }, enabled = picked.isNotEmpty() && picked.size < segments.size) {
                Text(pluralStringResource(Res.plurals.split_move, picked.size, picked.size))
            }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(Res.string.cancel)) } },
    )
}

/**
 * Travelers…: every name the trip's bookings give, ticked unless the owner took it off. Unticking a wrongly named
 * passenger, the user among them, makes it a trip they're only watching. As the web's.
 */
@Composable
private fun TravelersDialog(segments: List<Segment>, removed: List<String>, onDismiss: () -> Unit, onSave: (List<String>) -> Unit) {
    val names = remember(segments, removed) { namedTravelers(segments, removed) }
    // Unticked: only those the owner took off, as people write them; a name on nothing but a cancelled booking is
    // still on the trip.
    var off by rememberSaveable { mutableStateOf(namedTravelers(emptyList(), removed).toSet()) }
    AppAlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(Res.string.travelers_title)) },
        text = {
            LazyColumn(modifier = Modifier.heightIn(max = 420.dp)) {
                item(key = "hint") {
                    Text(stringResource(Res.string.travelers_hint), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                items(names, key = { it }) { name ->
                    val on = name !in off
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.fillMaxWidth().toggleable(value = on, role = Role.Checkbox) { off = if (it) off - name else off + name }.padding(vertical = 6.dp),
                    ) {
                        Checkbox(checked = on, onCheckedChange = null)
                        Text(name, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(start = 12.dp))
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = { onSave(names.filter { it in off }) }) { Text(stringResource(Res.string.save)) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(Res.string.cancel)) } },
    )
}

/** The trip's other bookings of a kind, one tap each to merge into the one whose menu was used. */
@Composable
private fun MergeDialog(others: List<Segment>, onDismiss: () -> Unit, onMerge: (Segment) -> Unit) {
    AppAlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(Res.string.merge_booking_title)) },
        text = {
            LazyColumn(modifier = Modifier.heightIn(max = 360.dp)) {
                item(key = "hint") {
                    Text(stringResource(Res.string.merge_booking_hint), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                items(others, key = { it.id }) { other ->
                    Column(modifier = Modifier.fillMaxWidth().clickable { onMerge(other) }.padding(vertical = 12.dp)) {
                        Text(bookingHeading(other).headline, style = MaterialTheme.typography.bodyLarge)
                        Text("${formatDate(localDate(other.start))} ${localTime(other.start)}", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(Res.string.cancel)) } },
    )
}

/** Where a booking can move, one tap each: a new trip first, then the trips around its dates, the rest behind More. */
@Composable
private fun MoveDialog(segment: Segment, targets: List<Trip>, onDismiss: () -> Unit, onMoveToNew: (() -> Unit)?, onMove: (Trip) -> Unit) {
    var all by rememberSaveable(segment.id) { mutableStateOf(false) }
    val shown = if (all) targets else nearbyTrips(targets, segment)
    AppAlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(Res.string.move_booking_title, segment.title)) },
        text = {
            // A long travel history scrolls rather than running off the dialog.
            LazyColumn(modifier = Modifier.heightIn(max = 360.dp)) {
                if (onMoveToNew != null) {
                    item(key = "new") {
                        Text(stringResource(Res.string.new_trip), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.fillMaxWidth().clickable { onMoveToNew() }.padding(vertical = 12.dp))
                    }
                }
                items(shown, key = { it.id }) { t ->
                    Text(tripChoice(t), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.fillMaxWidth().clickable { onMove(t) }.padding(vertical = 12.dp))
                }
                if (shown.size < targets.size) {
                    item(key = "more") {
                        TextButton(onClick = { all = true }, modifier = Modifier.offset(x = -TextButtonInset)) { Text(stringResource(Res.string.more_trips)) }
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(Res.string.cancel)) } },
    )
}

/** A flight's "I've checked in" as its row shows it, and the change a tap asks for. */
class SegmentCheckIn(val state: FlightCheckIn, val onChange: (checkedIn: Boolean) -> Unit)

/**
 * One booking: its kind, title, route, times, a flight's gates and check-in,
 * and its verdict; a tap opens its details ([onOpen]), which carry the rest.
 * The ⋮ menu has Directions and Copy reference for anyone, the actions when
 * the viewer may edit.
 */
@Composable
fun SegmentRow(
    segment: Segment,
    actions: BookingActions? = null,
    flightLines: List<String> = emptyList(),
    checkIn: SegmentCheckIn? = null,
    onOpen: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    val chrome = LocalAppChrome.current
    val referenceLabel = stringResource(Res.string.booking_reference)
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    var menu by remember { mutableStateOf(false) }
    val reference = segment.confirmation?.trim()?.takeIf { it.isNotEmpty() }
    val heading = bookingHeading(segment)
    val open = onOpen?.let { Modifier.clickable(onClickLabel = stringResource(Res.string.booking_details), onClick = it) } ?: Modifier
    Row(modifier = modifier.fillMaxWidth().then(open).padding(horizontal = 16.dp, vertical = 12.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        // The kind of booking, and below it its brand's logo (BookingLogo), centred under it.
        Column(modifier = Modifier.padding(top = 2.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Icon(
                painterResource(segmentIcon(segment.type)),
                contentDescription = segment.type.label,
                tint = muted,
                modifier = Modifier.size(24.dp),
            )
            BookingLogo(segment, heading, 24.dp)
        }
        Column(modifier = Modifier.weight(1f)) {
            // As on the web: a cancelled booking stays listed, struck through.
            if (segment.isCancelled) {
                Text(stringResource(Res.string.cancelled).uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
            }
            // A flight is headed by its airline, its flight number leading the route (bookingHeading).
            Text(
                heading.headline,
                style = MaterialTheme.typography.bodyLarge,
                fontWeight = FontWeight.Medium,
                textDecoration = if (segment.isCancelled) TextDecoration.LineThrough else null,
            )
            headedRouteLine(segment, heading)?.let { Text(it, style = MaterialTheme.typography.bodyLarge, color = muted) }
            timesLine(segment)?.let { Text(it, style = MaterialTheme.typography.bodyLarge, color = muted) }
            if (flightLines.isNotEmpty()) {
                Text(flightLines.joinToString(" · "), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.tertiary)
            }
            when (checkIn?.state) {
                FlightCheckIn.OFFER -> TextButton(onClick = { checkIn.onChange(true) }, modifier = Modifier.offset(x = -TextButtonInset)) {
                    Text(stringResource(Res.string.checked_in_action))
                }
                FlightCheckIn.DONE -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(Res.string.checked_in), style = MaterialTheme.typography.bodyLarge)
                    TextButton(onClick = { checkIn.onChange(false) }) { Text(stringResource(Res.string.undo)) }
                }
                null -> Unit
            }
            Verdict(segment)
        }
        val directions = directionsUrl(segment)
        if (actions != null || reference != null || directions != null) {
            Box {
                IconButton(onClick = { menu = true }, modifier = Modifier.size(32.dp)) {
                    Icon(Icons.Filled.MoreVert, contentDescription = stringResource(Res.string.booking_actions), tint = muted)
                }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, modifier = Modifier.pinchFontSizeHost()) {
                    directions?.let { url ->
                        DropdownMenuItem(text = { Text(stringResource(Res.string.directions)) }, onClick = { menu = false; chrome.openLink(url, "directions") })
                    }
                    reference?.let { ref ->
                        DropdownMenuItem(text = { Text(stringResource(Res.string.copy_reference)) }, onClick = { menu = false; chrome.copyToClipboard(referenceLabel, ref) })
                    }
                    if (actions != null) {
                        DropdownMenuItem(text = { Text(stringResource(Res.string.edit)) }, onClick = { menu = false; actions.onEdit(segment) })
                        if (segment.isCancelled) {
                            actions.onRestore?.takeIf { actions.canRestore(segment) }?.let { restore ->
                                DropdownMenuItem(text = { Text(stringResource(Res.string.restore)) }, onClick = { menu = false; restore(segment) })
                            }
                        } else {
                            actions.onMarkCancelled?.let { cancel ->
                                DropdownMenuItem(text = { Text(stringResource(Res.string.mark_cancelled)) }, onClick = { menu = false; cancel(segment) })
                            }
                        }
                        actions.onMerge?.takeIf { actions.canMerge(segment) }?.let { merge ->
                            DropdownMenuItem(text = { Text(stringResource(Res.string.merge_booking_with)) }, onClick = { menu = false; merge(segment) })
                        }
                        actions.onMove?.let { move ->
                            DropdownMenuItem(text = { Text(stringResource(Res.string.move_to)) }, onClick = { menu = false; move(segment) })
                        }
                        DropdownMenuItem(text = { Text(stringResource(Res.string.delete)) }, onClick = { menu = false; actions.onDelete(segment) })
                    }
                }
            }
        }
    }
}

/**
 * Every email, TripIt trip or calendar event the booking was read from, as
 * the web lists them, then the sender with the owner's offers. A Gmail email
 * the viewer imported opens in Gmail; others' are in a mailbox the viewer
 * can't open, and Fastmail and IMAP mailboxes have no link to a message.
 */
@Composable
internal fun SourcesList(segment: Segment, emailLink: (SourceRef) -> String?, senderOffers: SenderOffers?) {
    val chrome = LocalAppChrome.current
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val openLabel = stringResource(Res.string.open_in_gmail)
    Column {
        for (source in segment.sources) {
            val kind = stringResource(sourceKindLabel(source.kind))
            val link = emailLink(source)
            val open = if (link != null) {
                Modifier.clickable(onClickLabel = openLabel, role = Role.Button) {
                    chrome.openGmailSearch(sourceSearch(segment, source), link)
                }
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
                if (source.label != null) Text(kind, style = MaterialTheme.typography.bodyLarge, color = muted)
            }
        }
        segment.sender?.let {
            Text(stringResource(Res.string.from_sender, it), style = MaterialTheme.typography.bodyLarge, color = muted, modifier = Modifier.padding(vertical = 8.dp))
            Row(modifier = Modifier.offset(x = -TextButtonInset)) {
                senderOffers?.always?.let { always -> TextButton(onClick = always) { Text(stringResource(Res.string.always_import_sender)) } }
                senderOffers?.never?.let { never -> TextButton(onClick = never) { Text(stringResource(Res.string.never_import_sender)) } }
            }
        }
    }
}

/**
 * After "Never import this sender": offers to delete what it already
 * imported ([plan]), or keep it. [remove] runs the deletion under the
 * screen's own token.
 */
@Composable
internal fun SenderCleanupDialog(viewModel: TripsViewModel, cleanup: Pair<String, SenderCleanup>?, remove: (SenderCleanup) -> Unit) {
    val (domain, plan) = cleanup ?: return
    // "2 trips and 1 booking": trips go whole.
    val trips = plan.trips.size.takeIf { it > 0 }?.let { pluralStringResource(Res.plurals.trips_count, it, it) }
    val bookings = plan.segments.size.takeIf { it > 0 }?.let { pluralStringResource(Res.plurals.bookings_count, it, it) }
    val what = if (trips != null && bookings != null) stringResource(Res.string.this_and_that, trips, bookings) else trips ?: bookings.orEmpty()
    AppAlertDialog(
        onDismissRequest = { viewModel.keepSenderBookings() },
        title = { Text(stringResource(Res.string.sender_cleanup_title)) },
        text = { Text(stringResource(Res.string.sender_cleanup_text, domain, what)) },
        confirmButton = { TextButton(onClick = { remove(plan) }) { Text(stringResource(Res.string.delete)) } },
        dismissButton = { TextButton(onClick = { viewModel.keepSenderBookings() }) { Text(stringResource(Res.string.keep)) } },
    )
}

private fun sourceKindLabel(kind: SourceKind): StringResource = when (kind) {
    SourceKind.GMAIL -> Res.string.source_gmail
    SourceKind.TRIPIT -> Res.string.source_tripit
    SourceKind.ICS -> Res.string.source_ics
    SourceKind.FORWARD -> Res.string.source_forward
    SourceKind.FASTMAIL -> Res.string.source_fastmail
    SourceKind.IMAP -> Res.string.source_imap
}

/** The traveler's stars and heart, shown when there are any. */
@Composable
internal fun Verdict(segment: Segment) {
    val rating = segment.rating ?: 0
    if (rating == 0 && !segment.favorite) return
    Row(modifier = Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        if (rating > 0) {
            Text(
                "★".repeat(rating) + "☆".repeat(5 - rating),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.tertiary,
            )
        }
        if (segment.favorite) Text("♥", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.error)
    }
}

/** The icon for a booking's type, from scripts/segment-icons.mjs. */
fun segmentIcon(type: SegmentType): DrawableResource = when (type) {
    SegmentType.FLIGHT -> Res.drawable.ic_segment_flight
    SegmentType.TRAIN -> Res.drawable.ic_segment_train
    SegmentType.BUS -> Res.drawable.ic_segment_bus
    SegmentType.FERRY -> Res.drawable.ic_segment_ferry
    SegmentType.LODGING -> Res.drawable.ic_segment_lodging
    SegmentType.CAR_RENTAL -> Res.drawable.ic_segment_car_rental
    SegmentType.ACTIVITY -> Res.drawable.ic_segment_activity
    SegmentType.MEAL -> Res.drawable.ic_segment_meal
    SegmentType.OTHER -> Res.drawable.ic_segment_other
}
