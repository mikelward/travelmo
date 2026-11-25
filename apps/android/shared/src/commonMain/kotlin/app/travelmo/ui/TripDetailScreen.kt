package app.travelmo.ui

import app.travelmo.shared.ic_segment_train
import app.travelmo.shared.ic_segment_other
import app.travelmo.shared.ic_segment_lodging
import app.travelmo.shared.ic_segment_flight
import app.travelmo.shared.ic_segment_ferry
import app.travelmo.shared.ic_segment_car_rental
import app.travelmo.shared.ic_segment_bus
import app.travelmo.shared.ic_segment_activity
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
import app.travelmo.core.effectiveDecision
import app.travelmo.core.SenderList
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
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
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
import androidx.compose.material3.HorizontalDivider
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
import app.travelmo.core.tripTravelers
import app.travelmo.core.watching
import androidx.lifecycle.repeatOnLifecycle
import app.travelmo.core.MAX_TRIP_REMINDERS
import app.travelmo.core.PersonWarning
import app.travelmo.core.ProfileEntry
import app.travelmo.core.RideCompany
import app.travelmo.core.RideNeed
import app.travelmo.core.Segment
import app.travelmo.core.FlightCheckIn
import app.travelmo.core.flightCheckInState
import app.travelmo.core.SegmentType
import app.travelmo.core.SourceKind
import app.travelmo.core.SourceRef
import app.travelmo.core.Trip
import app.travelmo.core.allLoyalty
import app.travelmo.core.displayTitles
import app.travelmo.core.emailLinkFor
import app.travelmo.core.sourceSearch
import app.travelmo.core.fittedRange
import app.travelmo.core.formatDate
import app.travelmo.core.formatDateRange
import app.travelmo.core.isCancelled
import app.travelmo.core.loyaltyLine
import app.travelmo.core.directionsUrl
import app.travelmo.core.nearbyTrips
import app.travelmo.core.otherTrips
import app.travelmo.core.programsFor
import app.travelmo.core.referenceLine
import app.travelmo.core.rideNeedKey
import app.travelmo.core.routeLine
import app.travelmo.core.segmentsByDay
import app.travelmo.core.sharedWithAny
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
import app.travelmo.shared.booking_for
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
import app.travelmo.shared.more_trips
import app.travelmo.shared.move_booking_title
import app.travelmo.shared.new_trip
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
) {
    val tripFlow = remember(tripId) { viewModel.trip(tripId) }
    val segmentsFlow = remember(tripId) { viewModel.segments(tripId) }
    val trip by tripFlow.collectAsStateWithLifecycle(initialValue = null)
    val trips by viewModel.trips.collectAsStateWithLifecycle()
    val segments by segmentsFlow.collectAsStateWithLifecycle(initialValue = emptyList())
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
    val loaded by viewModel.state.collectAsStateWithLifecycle()
    val people by viewModel.people.collectAsStateWithLifecycle()
    val travelers by viewModel.travelers.collectAsStateWithLifecycle()
    val ownProfile by viewModel.ownProfile.collectAsStateWithLifecycle()
    val gmailMailboxes by viewModel.gmailMailboxes.collectAsStateWithLifecycle()
    val rideSettings by viewModel.rideSettings.collectAsStateWithLifecycle()
    val standingReminders by viewModel.standingReminders.collectAsStateWithLifecycle()
    val myChecklistFlow = remember(tripId) { viewModel.myChecklist(tripId) }
    val myChecklist by myChecklistFlow.collectAsStateWithLifecycle(initialValue = null)
    val addresses by viewModel.addresses.collectAsStateWithLifecycle()
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    val patterns by viewModel.senderPatterns.collectAsStateWithLifecycle()
    val cleanup by viewModel.senderCleanup.collectAsStateWithLifecycle()
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
                action == "delete" || action == "sender-cleanup/leave" -> onBack()
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
                },
            )
        },
    ) { padding ->
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
        cleanup?.let { (domain, plan) ->
            // "2 trips and 1 booking": trips go whole.
            val trips = plan.trips.size.takeIf { it > 0 }?.let { pluralStringResource(Res.plurals.trips_count, it, it) }
            val bookings = plan.segments.size.takeIf { it > 0 }?.let { pluralStringResource(Res.plurals.bookings_count, it, it) }
            val what = if (trips != null && bookings != null) stringResource(Res.string.this_and_that, trips, bookings) else trips ?: bookings.orEmpty()
            AppAlertDialog(
                onDismissRequest = { viewModel.keepSenderBookings() },
                title = { Text(stringResource(Res.string.sender_cleanup_title)) },
                text = { Text(stringResource(Res.string.sender_cleanup_text, domain, what)) },
                confirmButton = {
                    TextButton(onClick = {
                        val leave = if (plan.trips.any { it.id == tripId }) "leave" else "stay"
                        viewModel.removeSenderBookings("${prefix}sender-cleanup/$leave")
                    }) { Text(stringResource(Res.string.delete)) }
                },
                dismissButton = { TextButton(onClick = { viewModel.keepSenderBookings() }) { Text(stringResource(Res.string.keep)) } },
            )
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
        when {
            current != null -> TripBody(
                current, segments, shared = current.ownerUid != uid, errors = errors, busy = busy,
                watching = watching(tripTravelers(segments), travelers),
                warnings = tripWarnings(people, current, segments, viewModel.today()), today = viewModel.today(),
                programsFor = { provider -> programsFor(provider, ownProfile?.let(::allLoyalty).orEmpty()) },
                flightLines = { segment -> viewModel.flightLines(segment, flightStatuses) },
                checkIn = { segment ->
                    checkedIn?.let { flightCheckInState(segment, it, viewModel.now()) }?.let { state ->
                        SegmentCheckIn(state) { on -> viewModel.setCheckedIn("${prefix}checked-in/${segment.id}", tripId, segment.id, on) }
                    }
                },
                emailLink = { source -> emailLinkFor(source, uid, ownsTrip = isOwner, mailboxes = gmailMailboxes) },
                rides = RideSuggestions(
                    needs = viewModel.rideNeedsFor(segments, rideSettings).groupBy { it.segmentId },
                    companies = rideSettings?.companies.orEmpty(),
                    onHide = { need -> viewModel.hideRideNeed("${prefix}ride/${rideNeedKey(need)}", need) },
                ),
                journeyGap = viewModel.journeyGapFor(current, segments, rideSettings)?.let { gap ->
                    JourneyGapActions(
                        gap,
                        onAdd = if (canEdit) { { onAddBooking(gap.date) } } else null,
                        onOneWay = { viewModel.markOneWay("${prefix}one-way", tripId) },
                    )
                },
                bookingActions = if (canEdit) {
                    BookingActions(
                        onEdit = { onEditBooking(it.id) },
                        onDelete = { deleting = it },
                        // A new trip only for the owner: a sharee's would take the booking from the owner's sight.
                        onMove = if (targets.isEmpty() && !isOwner) null else { segment -> moving = segment },
                        onRestore = { segment -> viewModel.restoreSegment("${prefix}segment/${segment.id}/restore", tripId, segment.id) },
                        onMarkCancelled = { segment -> viewModel.cancelSegment("${prefix}segment/${segment.id}/cancel", tripId, segment.id) },
                        // One cancelled with its trip comes back with the trip.
                        canRestore = { segment -> current.cancelledAt == null || segment.userCancelled != "trip" },
                    )
                } else {
                    null
                },
                tripActions = if (isOwner) actions else null,
                // Sender rules are the viewer's own, so the offers stand for the owner only: the import ran against their mailbox.
                senderOffers = { segment ->
                    segment.sender?.takeIf { isOwner }?.let { domain ->
                        val decision = effectiveDecision(patterns, domain)
                        SenderOffers(
                            always = if (decision != SenderList.ALLOW) { { viewModel.alwaysImportSender("${prefix}sender/always", domain) } } else null,
                            never = if (decision != SenderList.DENY) { { viewModel.neverImportSender("${prefix}sender/never", domain) } } else null,
                        )
                    }
                },
                // The viewer's own reminders before the trip, theirs alone, shared trip or not.
                checklist = viewModel.checklistFor(current, segments, standingReminders, myChecklist, rideSettings)?.let { entries ->
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
                titles = displayTitles(trips.orEmpty()),
                modifier = Modifier.padding(padding),
            )
            loaded.groups == null -> Text(stringResource(Res.string.trip_loading), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(padding).padding(16.dp))
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
    programsFor: (String?) -> List<ProfileEntry>,
    /** A flight's live gates and carousel. */
    flightLines: (Segment) -> List<String>,
    /** A flight's "I've checked in", the viewer's own: offered, or marked with an undo. */
    checkIn: (Segment) -> SegmentCheckIn? = { null },
    bookingActions: BookingActions?,
    emailLink: (SourceRef) -> String?,
    rides: RideSuggestions,
    /** A journey the trip seems to be missing; null when nothing is. */
    journeyGap: JourneyGapActions? = null,
    tripActions: TripActions?,
    senderOffers: (Segment) -> SenderOffers?,
    checklist: Checklist?,
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
                Text(formatDateRange(trip.shownStart, trip.shownEnd), style = MaterialTheme.typography.bodyMedium, color = muted)
                if (shared) Text(stringResource(Res.string.badge_shared).uppercase(), style = MaterialTheme.typography.labelSmall, color = TravelmoTheme.colors.shared)
            }
            if (watching) Text(stringResource(Res.string.watching_hint), style = MaterialTheme.typography.bodyMedium, color = muted)
            if (canManage && tripActions != null) {
                // Renaming and fitting the dates sit by the dates, as on the web;
                // fitting is offered only when the bookings span less than the trip.
                // Shifted by the buttons' own padding so their labels line up with the dates.
                Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier.offset(x = -TextButtonInset),
                ) {
                    TextButton(onClick = { renaming = true }, enabled = !busy) { Text(stringResource(Res.string.rename)) }
                    fittedRange(trip, segments)?.let { range ->
                        TextButton(onClick = tripActions.fit, enabled = !busy) { Text(stringResource(Res.string.fit_dates, formatDateRange(range.first, range.second))) }
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
                    Text(stringResource(Res.string.trip_cancelled), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.error)
                    if (canManage && tripActions != null) {
                        TextButton(onClick = tripActions.restore, enabled = !busy) { Text(stringResource(Res.string.restore)) }
                    }
                }
            }
        }
        for ((token, message) in errors) {
            item(key = "error-$token") { Text(message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 8.dp)) }
        }
        if (warnings.isNotEmpty()) {
            item(key = "warnings") { DocumentWarnings(warnings, today) }
        }
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
                Text(formatDate(date), style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 20.dp, bottom = 4.dp))
            }
            items(items, key = { it.id }) { segment ->
                SegmentRow(segment, bookingActions, programs = programsFor(segment.provider), emailLink = emailLink, flightLines = flightLines(segment), checkIn = checkIn(segment), senderOffers = senderOffers(segment))
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
        Text(stringResource(Res.string.deleting_interrupted), style = MaterialTheme.typography.bodyMedium)
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
            Text(stringResource(Res.string.only_you), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        for (email in trip.sharedWith) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Text(email, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
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
        Text(stringResource(Res.string.merge_text), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
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

/**
 * One booking: its kind, title, route, times, reference and verdict, and a ⋮
 * menu: copying the reference and the sources for anyone, the actions when
 * the viewer may edit. [emailLink] is the Gmail link of a source the viewer
 * imported, else null.
 */
/** A flight's "I've checked in" as its row shows it, and the change a tap asks for. */
class SegmentCheckIn(val state: FlightCheckIn, val onChange: (checkedIn: Boolean) -> Unit)

@Composable
fun SegmentRow(
    segment: Segment,
    actions: BookingActions? = null,
    programs: List<ProfileEntry> = emptyList(),
    emailLink: (SourceRef) -> String? = { null },
    flightLines: List<String> = emptyList(),
    checkIn: SegmentCheckIn? = null,
    senderOffers: SenderOffers? = null,
) {
    val chrome = LocalAppChrome.current
    val referenceLabel = stringResource(Res.string.booking_reference)
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    var menu by remember { mutableStateOf(false) }
    var showingSources by rememberSaveable(segment.id) { mutableStateOf(false) }
    val hasSources = segment.sources.isNotEmpty() || segment.sender != null
    val reference = segment.confirmation?.trim()?.takeIf { it.isNotEmpty() }
    if (showingSources && hasSources) {
        SourcesDialog(segment, emailLink, senderOffers, onDismiss = { showingSources = false })
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
                Text(stringResource(Res.string.cancelled).uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
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
            when (checkIn?.state) {
                FlightCheckIn.OFFER -> TextButton(onClick = { checkIn.onChange(true) }, modifier = Modifier.offset(x = -TextButtonInset)) {
                    Text(stringResource(Res.string.checked_in_action))
                }
                FlightCheckIn.DONE -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(Res.string.checked_in), style = MaterialTheme.typography.bodyMedium)
                    TextButton(onClick = { checkIn.onChange(false) }) { Text(stringResource(Res.string.undo)) }
                }
                null -> Unit
            }
            if (segment.travelers.isNotEmpty()) {
                Text(stringResource(Res.string.booking_for, segment.travelers.joinToString(", ")), style = MaterialTheme.typography.bodySmall, color = muted, modifier = Modifier.padding(top = 4.dp))
            }
            referenceLine(segment)?.let { line ->
                // A long press on the line copies the reference too, as ⋮ does.
                val copy = reference?.let { ref -> Modifier.longPressUnlessPinch(stringResource(Res.string.copy_reference)) { chrome.copyToClipboard(referenceLabel, ref) } } ?: Modifier
                Text(line, style = MaterialTheme.typography.bodySmall, color = muted, modifier = Modifier.padding(top = 4.dp).then(copy))
            }
            // One program a line, so whose each number is stays plain.
            if (programs.isNotEmpty()) {
                Text(programs.joinToString("\n", transform = ::loyaltyLine), style = MaterialTheme.typography.bodySmall, color = muted, modifier = Modifier.padding(top = 4.dp))
            }
            segment.notes?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = muted, modifier = Modifier.padding(top = 4.dp)) }
            Verdict(segment)
        }
        val directions = directionsUrl(segment)
        if (actions != null || hasSources || reference != null || directions != null) {
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
                    if (hasSources) {
                        DropdownMenuItem(text = { Text(stringResource(Res.string.sources)) }, onClick = { menu = false; showingSources = true })
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
 * the web's trip page lists them, then the sender. A Gmail email the viewer
 * imported opens in Gmail; others' are in a mailbox the viewer can't open,
 * and Fastmail and IMAP mailboxes have no link to a message.
 */
@Composable
private fun SourcesDialog(segment: Segment, emailLink: (SourceRef) -> String?, senderOffers: SenderOffers?, onDismiss: () -> Unit) {
    val chrome = LocalAppChrome.current
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val openLabel = stringResource(Res.string.open_in_gmail)
    AppAlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(Res.string.sources)) },
        text = {
            Column(modifier = Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState())) {
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
                        if (source.label != null) Text(kind, style = MaterialTheme.typography.bodySmall, color = muted)
                    }
                }
                segment.sender?.let {
                    Text(stringResource(Res.string.from_sender, it), style = MaterialTheme.typography.bodyMedium, color = muted, modifier = Modifier.padding(vertical = 8.dp))
                    senderOffers?.always?.let { always ->
                        TextButton(onClick = { always(); onDismiss() }) { Text(stringResource(Res.string.always_import_sender)) }
                    }
                    senderOffers?.never?.let { never ->
                        TextButton(onClick = { never(); onDismiss() }) { Text(stringResource(Res.string.never_import_sender)) }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(Res.string.close)) } },
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
fun segmentIcon(type: SegmentType): DrawableResource = when (type) {
    SegmentType.FLIGHT -> Res.drawable.ic_segment_flight
    SegmentType.TRAIN -> Res.drawable.ic_segment_train
    SegmentType.BUS -> Res.drawable.ic_segment_bus
    SegmentType.FERRY -> Res.drawable.ic_segment_ferry
    SegmentType.LODGING -> Res.drawable.ic_segment_lodging
    SegmentType.CAR_RENTAL -> Res.drawable.ic_segment_car_rental
    SegmentType.ACTIVITY -> Res.drawable.ic_segment_activity
    SegmentType.OTHER -> Res.drawable.ic_segment_other
}
