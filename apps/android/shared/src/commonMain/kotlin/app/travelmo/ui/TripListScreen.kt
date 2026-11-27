package app.travelmo.ui

import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextDecoration
import org.jetbrains.compose.resources.StringResource
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.navigationevent.NavigationEventInfo
import androidx.navigationevent.compose.NavigationBackHandler
import androidx.navigationevent.compose.rememberNavigationEventState
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.drawOutline
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.travelmo.core.ListWarning
import app.travelmo.core.FlightStatus
import app.travelmo.core.Segment
import app.travelmo.core.Trip
import app.travelmo.core.TripGroups
import app.travelmo.core.WarningWhen
import app.travelmo.core.tripCancelled
import app.travelmo.core.tripSetting
import app.travelmo.core.checkInLine
import app.travelmo.core.displayTitles
import app.travelmo.core.formatDate
import app.travelmo.core.formatDateRange
import app.travelmo.core.localDate
import app.travelmo.core.localTime
import app.travelmo.core.shownEnd
import app.travelmo.core.shownStart
import app.travelmo.core.tripNextUp
import app.travelmo.core.tripStatus
import app.travelmo.core.warningText
import app.travelmo.shared.Res
import app.travelmo.shared.all_trips_hidden
import app.travelmo.shared.badge_deleting
import app.travelmo.shared.badge_shared
import app.travelmo.shared.badge_watching
import app.travelmo.shared.checked_in_action
import app.travelmo.shared.no_trips_match
import app.travelmo.shared.searching_bookings
import app.travelmo.shared.section_now
import app.travelmo.shared.section_past
import app.travelmo.shared.section_upcoming
import app.travelmo.shared.staying_at
import app.travelmo.shared.cancelled
import app.travelmo.shared.trips_empty
import app.travelmo.shared.trips_empty_hint
import app.travelmo.shared.trips_loading
import app.travelmo.ui.theme.TextButtonInset
import app.travelmo.ui.theme.TravelmoTheme
import org.jetbrains.compose.resources.stringResource

/** Now, Upcoming and Past, each card with what comes next (SPEC.md "The trip list"). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TripListScreen(viewModel: TripsViewModel, uid: String, onOpenTrip: (String) -> Unit, onOpenSettings: () -> Unit, bottomBar: @Composable () -> Unit = {}) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val searchText by viewModel.searchText.collectAsStateWithLifecycle()
    val found by viewModel.searchResult.collectAsStateWithLifecycle()
    val filters by viewModel.listFilters.collectAsStateWithLifecycle()
    val hidden by viewModel.hiddenTrips.collectAsStateWithLifecycle()
    val watching by viewModel.watchingTrips.collectAsStateWithLifecycle()
    val missingOf = { trip: Trip -> state.missing[trip.id] }
    val crashed = crashPending()
    // The cards' "I've checked in" writes: a finished one is acknowledged, a
    // failed one says so above the trips until the next tap replaces it.
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    val checkIns = outcomes.filterKeys { it.startsWith(CHECKED_IN_TOKEN) }
    val checkInFailed = checkIns.values.firstNotNullOfOrNull { (it as? Outcome.Failed)?.message }
    LaunchedEffect(checkIns) {
        for ((token, outcome) in checkIns) if (outcome is Outcome.Done) viewModel.outcomeSeen(token)
    }
    // Search opens in the top bar, over the wordmark; it stays open while it holds a search.
    var searching by rememberSaveable { mutableStateOf(searchText.isNotEmpty()) }
    val closeSearch = {
        viewModel.searchTrips("")
        searching = false
    }
    // Back leaves the search before it leaves the list.
    NavigationBackHandler(rememberNavigationEventState(NavigationEventInfo.None), isBackEnabled = searching, onBackCompleted = { closeSearch() })
    val focus = LocalFocusManager.current
    // Add a trip: the dialog while open, and the new trip's id once asked for, its write's token named by it.
    var addingTrip by rememberSaveable { mutableStateOf(false) }
    val newTrips = outcomes.filterKeys { it.startsWith(NEW_TRIP_TOKEN) }
    LaunchedEffect(newTrips) {
        for ((token, outcome) in newTrips) if (outcome is Outcome.Done) {
            viewModel.outcomeSeen(token)
            addingTrip = false
            onOpenTrip(token.removePrefix(NEW_TRIP_TOKEN))
        }
    }
    if (addingTrip) {
        val saving = newTrips.values.any { it is Outcome.Busy }
        AddTripDialog(
            busy = saving,
            problem = newTrips.values.firstNotNullOfOrNull { (it as? Outcome.Failed)?.message },
            onDismiss = { if (viewModel.leaveAddTrip()) addingTrip = false },
        ) { title, start, end ->
            // A failed try is forgotten, so its message gives way to this one's.
            if (viewModel.leaveAddTrip()) viewModel.addTrip(viewModel.newTripId(), title, start, end)
        }
    }
    Scaffold(
        topBar = {
            TripListTopBar(
                searching = searching,
                onSearching = { open -> if (open) searching = true else closeSearch() },
                query = searchText,
                onQuery = viewModel::searchTrips,
                filters = filters,
                onFilters = viewModel::setListFilters,
                onOpenSettings = onOpenSettings,
                onAddTrip = { addingTrip = true },
            )
        },
        bottomBar = bottomBar,
        // A tap anywhere outside the search field takes the focus (and the keyboard) away from it.
        modifier = Modifier.pointerInput(Unit) { detectTapGestures(onTap = { focus.clearFocus() }) },
    ) { padding ->
        val groups = state.groups
        val list = rememberLazyListState()
        // So does scrolling the list.
        LaunchedEffect(list.isScrollInProgress) { if (list.isScrollInProgress) focus.clearFocus() }
        when {
            groups == null -> Column(Modifier.padding(padding)) {
                // The crash banner first, at the top of whatever the list shows.
                if (crashed) LastCrashBanner(Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp))
                Message(stringResource(Res.string.trips_loading))
            }
            groups.current.isEmpty() && groups.upcoming.isEmpty() && groups.past.isEmpty() ->
                Column(Modifier.fillMaxSize().padding(padding)) {
                    if (crashed) LastCrashBanner(Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp))
                    Column(Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, top = 64.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(stringResource(Res.string.trips_empty), color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
                        Text(stringResource(Res.string.trips_empty_hint), color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 8.dp))
                    }
                }
            else -> {
                val result = found
                val kept = remember(groups, hidden) { groups.without(hidden) }
                val shown = remember(kept, result) { if (result == null) kept else kept.only(result.ids) }
                LazyColumn(
                    modifier = Modifier.fillMaxSize().padding(padding).scrollEdgeCue(list, scrollCueColors()),
                    state = list,
                    contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                ) {
                    val titles = state.titles
                    // In the list, so it scrolls away with it rather than taking room from the trips.
                    if (crashed) item(key = "crash") { LastCrashBanner(Modifier.padding(bottom = 12.dp)) }
                    if (result == null && hidden.isNotEmpty() && kept.current.isEmpty() && kept.upcoming.isEmpty() && kept.past.isEmpty()) {
                        item(key = "all-hidden") { Message(stringResource(Res.string.all_trips_hidden)) }
                    }
                    if (result != null && !result.bookingsSearched) item(key = "searching") { Message(stringResource(Res.string.searching_bookings)) }
                    // Judged by what is shown: a search can find only trips the filters hide.
                    val nothingShown = shown.current.isEmpty() && shown.upcoming.isEmpty() && shown.past.isEmpty()
                    if (result != null && result.bookingsSearched && nothingShown) item(key = "no-match") { Message(stringResource(Res.string.no_trips_match)) }
                    if (checkInFailed != null) {
                        item(key = "checked-in-failed") {
                            Text(checkInFailed, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(bottom = 12.dp))
                        }
                    }
                    // Document warnings once, at the top, each for the earliest trip
                    // it bears on and opening it, rather than repeated on every card.
                    if (state.warnings.isNotEmpty()) {
                        item(key = "warnings") {
                            Box(Modifier.padding(bottom = 12.dp)) { ListWarnings(state.warnings, titles, today = state.now.substring(0, 10), onOpenTrip = onOpenTrip) }
                        }
                    }
                    // What comes next is said only for a trip under way; an upcoming
                    // trip's card is its title and dates.
                    val onCheckedIn = { tripId: String, segmentId: String -> viewModel.setCheckedIn("$CHECKED_IN_TOKEN$tripId/$segmentId", tripId, segmentId, true) }
                    section(Res.string.section_now, shown.current, titles, state, uid, showNext = true, onOpenTrip, onCheckedIn, missingOf, watching)
                    section(Res.string.section_upcoming, shown.upcoming, titles, state, uid, showNext = false, onOpenTrip, onCheckedIn, missingOf, watching)
                    section(Res.string.section_past, shown.past, titles, state, uid, showNext = false, onOpenTrip, onCheckedIn, missingOf, watching)
                }
            }
        }
    }
}

/** The prefix of the cards' "I've checked in" write tokens. */
private const val CHECKED_IN_TOKEN = "list/checked-in/"

private fun TripGroups.without(ids: Set<String>) =
    if (ids.isEmpty()) this else TripGroups(current.filter { it.id !in ids }, upcoming.filter { it.id !in ids }, past.filter { it.id !in ids })

private fun TripGroups.only(ids: Set<String>) =
    TripGroups(current.filter { it.id in ids }, upcoming.filter { it.id in ids }, past.filter { it.id in ids })

@Composable
private fun Message(text: String, modifier: Modifier = Modifier) {
    Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = modifier.padding(16.dp))
}

private fun androidx.compose.foundation.lazy.LazyListScope.section(
    title: StringResource,
    trips: List<Trip>,
    titles: Map<String, String>,
    state: TripListState,
    uid: String,
    showNext: Boolean,
    onOpenTrip: (String) -> Unit,
    onCheckedIn: (tripId: String, segmentId: String) -> Unit,
    missingOf: (Trip) -> String?,
    /** The trips the user is only watching. */
    watching: Set<String>,
) {
    if (trips.isEmpty()) return
    item(key = "section-$title") {
        Text(
            stringResource(title),
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(top = 8.dp, bottom = 12.dp),
        )
    }
    // One card per section, a rule between its trips: each trip draws its part of the card.
    itemsIndexed(trips, key = { _, trip -> trip.id }) { index, trip ->
        TripCard(
            trip = trip, title = titles[trip.id] ?: trip.title, shared = trip.ownerUid != uid, segments = state.segmentsByTrip[trip.id], now = state.now, showNext = showNext,
            flightStatuses = state.flightStatuses, checkedIn = state.checkedIn[trip.id].orEmpty(),
            onCheckedIn = { segmentId -> onCheckedIn(trip.id, segmentId) },
            missing = missingOf(trip),
            watching = trip.id in watching,
            onClick = { onOpenTrip(trip.id) },
            modifier = Modifier.padding(bottom = if (index == trips.lastIndex) 12.dp else 0.dp)
                .sectionPart(first = index == 0, last = index == trips.lastIndex, color = MaterialTheme.colorScheme.outlineVariant),
        )
    }
}

/**
 * This row's part of its section or day card: the card's rounded top if [first], its rounded bottom if [last], its
 * sides, and the rule above it otherwise. The rule is the top edge, so the one below a row is the next row's.
 */
internal fun Modifier.sectionPart(first: Boolean, last: Boolean, color: Color): Modifier {
    val radius = 12.dp
    val shape = RoundedCornerShape(topStart = if (first) radius else 0.dp, topEnd = if (first) radius else 0.dp, bottomStart = if (last) radius else 0.dp, bottomEnd = if (last) radius else 0.dp)
    return clip(shape).drawWithCache {
        val stroke = 1.dp.toPx()
        // Only the last row draws a bottom edge: above another row, the outline runs past the bottom, where the clip
        // hides it, and the next row's top edge is the rule between them.
        val height = if (last) size.height - stroke else size.height + stroke
        val outline = shape.createOutline(Size(size.width - stroke, height), layoutDirection, this)
        val style = Stroke(stroke)
        val half = stroke / 2
        onDrawWithContent {
            drawContent()
            translate(half, half) {
                drawOutline(outline, color, style = style)
            }
        }
    }
}

/**
 * One trip: the title (as [displayTitles] shows it among the list) and its dates, both struck through once it was
 * cancelled (by hand, or every booking once its [segments] are loaded), as a cancelled booking is; and with [showNext] (a trip under way) what comes next, with the live
 * status of its next flight from [flightStatuses].
 */
@Composable
fun TripCard(
    trip: Trip,
    title: String = trip.title,
    shared: Boolean,
    segments: List<Segment>?,
    now: String,
    showNext: Boolean = true,
    flightStatuses: Map<String, FlightStatus> = emptyMap(),
    checkedIn: Set<String> = emptySet(),
    onCheckedIn: ((segmentId: String) -> Unit)? = null,
    /** "No flight from Boston back to London found", the first journey a trip seems to miss (journeyGaps). */
    missing: String? = null,
    /** Whether the user is only watching it: none of its travelers is them. */
    watching: Boolean = false,
    onClick: () -> Unit,
    /** Its outline: the list draws one card per section ([sectionPart]). */
    modifier: Modifier = Modifier,
) {
    val badge = when {
        trip.deleting -> stringResource(Res.string.badge_deleting) to MaterialTheme.colorScheme.onSurfaceVariant
        watching -> stringResource(Res.string.badge_watching) to MaterialTheme.colorScheme.onSurfaceVariant
        shared -> stringResource(Res.string.badge_shared) to TravelmoTheme.colors.shared
        else -> null
    }
    val cancelled = tripCancelled(trip, segments)
    val cancelledLabel = stringResource(Res.string.cancelled)
    val struck = if (cancelled) TextDecoration.LineThrough else null
    val setting = remember(trip.setting, segments) { trip.setting ?: segments?.let(::tripSetting) }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .then(modifier)
            .clickable(onClick = onClick)
            // The strike-through, said: a screen reader doesn't read it.
            .semantics(mergeDescendants = true) { if (cancelled) stateDescription = cancelledLabel }
            .padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
        // The landmark beside the title and dates; what comes next runs below, in line with the title.
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            // Until the trip says what kind of place it goes to, its bookings do, where the list has them.
            TripLandmark(title, setting)
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Text(
                        title,
                        style = MaterialTheme.typography.titleLarge,
                        color = if (cancelled) MaterialTheme.colorScheme.onSurfaceVariant else Color.Unspecified,
                        textDecoration = struck,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f),
                    )
                    badge?.let { (text, color) -> Text(text.uppercase(), style = MaterialTheme.typography.labelSmall, color = color) }
                }
                Text(
                    formatDateRange(trip.shownStart, trip.shownEnd),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textDecoration = struck,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
        }
        Column(Modifier.padding(start = LANDMARK_INDENT)) {
            if (!cancelled && missing != null) {
                Text(missing, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.tertiary, modifier = Modifier.padding(top = 8.dp))
            }
            // A cancelled trip has nothing coming.
            if (!cancelled && segments != null) StatusLines(segments, now, showNext, flightStatuses, checkedIn, onCheckedIn, offerCheckIn = !watching)
        }
    }
}

/** The landmark's width and the gap after it, so lines below the title start where it does. */
private val LANDMARK_INDENT = 52.dp

/**
 * With [showNext], the stay under way, what comes next ([tripNextUp], with the
 * live status of its flight from [flightStatuses]), and the flight's check-in window until the user marks it [checkedIn].
 */
@Composable
private fun StatusLines(
    segments: List<Segment>,
    now: String,
    showNext: Boolean,
    flightStatuses: Map<String, FlightStatus>,
    checkedIn: Set<String>,
    onCheckedIn: ((segmentId: String) -> Unit)?,
    /** Whether to say the flight's check-in window: the traveler's to do, not someone watching the trip. */
    offerCheckIn: Boolean = true,
) {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    if (!showNext) return
    val status = remember(segments, now) { tripStatus(segments, now) }
    status.stay?.let { stay ->
        val until = stay.end?.let { " · until ${formatDate(localDate(it))} ${localTime(it)}" } ?: ""
        Text(stringResource(Res.string.staying_at, stay.title) + until, style = MaterialTheme.typography.bodyLarge, color = muted, modifier = Modifier.padding(top = 8.dp))
    }
    val next = remember(segments, now, flightStatuses) { tripNextUp(segments, now, flightStatuses) }
    next?.let { next ->
        // The booking, then in one muted style: when, a flight's next step, and what follows a landing.
        Text(
            next.title,
            style = MaterialTheme.typography.bodyLarge,
            fontWeight = FontWeight.Medium,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.padding(top = 8.dp),
        )
        Text(next.`when`, style = MaterialTheme.typography.bodyLarge, color = muted)
        next.step?.let { Text(it, style = MaterialTheme.typography.bodyLarge, color = muted) }
        next.then?.let { Text(it, style = MaterialTheme.typography.bodyLarge, color = muted) }
    }
    // Until the user says they checked in, which only an open window offers.
    status.checkIn?.takeIf { offerCheckIn && it.segment.id !in checkedIn }?.let { checkIn ->
        Text(
            checkInLine(checkIn),
            style = MaterialTheme.typography.bodyLarge,
            color = if (checkIn.open) MaterialTheme.colorScheme.tertiary else muted,
            modifier = Modifier.padding(top = 4.dp),
        )
        if (checkIn.open && onCheckedIn != null) {
            TextButton(onClick = { onCheckedIn(checkIn.segment.id) }, modifier = Modifier.offset(x = -TextButtonInset)) {
                Text(stringResource(Res.string.checked_in_action))
            }
        }
    }
}

/** The list's document warnings, one card at the top, each line opening its trip. */
@Composable
private fun ListWarnings(warnings: List<ListWarning>, titles: Map<String, String>, today: String, onOpenTrip: (String) -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .border(1.dp, MaterialTheme.colorScheme.tertiary.copy(alpha = 0.4f), shape)
            .background(MaterialTheme.colorScheme.tertiaryContainer.copy(alpha = 0.5f))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        for (w in warnings) {
            Text(
                warningText(w.warning, today, titles[w.trip.id] ?: w.trip.title),
                style = MaterialTheme.typography.bodyLarge,
                color = if (w.warning.warning.`when` == WarningWhen.BEFORE) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.tertiary,
                modifier = Modifier.fillMaxWidth().clickable { onOpenTrip(w.trip.id) },
            )
        }
    }
}
