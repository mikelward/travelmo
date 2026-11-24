package app.travelmo.ui

import org.jetbrains.compose.resources.StringResource
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
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
import app.travelmo.core.allCancelled
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
import app.travelmo.shared.hide_cancelled
import app.travelmo.shared.hide_local_events
import app.travelmo.shared.badge_deleting
import app.travelmo.shared.badge_shared
import app.travelmo.shared.checked_in_action
import app.travelmo.shared.no_trips_match
import app.travelmo.shared.search_trips
import app.travelmo.shared.searching_bookings
import app.travelmo.shared.section_now
import app.travelmo.shared.section_past
import app.travelmo.shared.section_upcoming
import app.travelmo.shared.staying_at
import app.travelmo.shared.trip_all_cancelled
import app.travelmo.shared.trip_cancelled
import app.travelmo.shared.trips_empty
import app.travelmo.shared.trips_empty_hint
import app.travelmo.shared.trips_loading
import app.travelmo.ui.theme.Brand
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
    val crashed = crashPending()
    // The cards' "I've checked in" writes: a finished one is acknowledged, a
    // failed one says so above the trips until the next tap replaces it.
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    val checkIns = outcomes.filterKeys { it.startsWith(CHECKED_IN_TOKEN) }
    val checkInFailed = checkIns.values.firstNotNullOfOrNull { (it as? Outcome.Failed)?.message }
    LaunchedEffect(checkIns) {
        for ((token, outcome) in checkIns) if (outcome is Outcome.Done) viewModel.outcomeSeen(token)
    }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Brand() },
                actions = {
                    SettingsButton(onClick = onOpenSettings)
                    AppMenu()
                },
            )
        },
        bottomBar = bottomBar,
    ) { padding ->
        val groups = state.groups
        val list = rememberLazyListState()
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
            else -> LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding).scrollEdgeCue(list, scrollCueColors()),
                state = list,
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                val titles = displayTitles(groups.current + groups.upcoming + groups.past)
                // In the list, so it scrolls away with it rather than taking room from the trips.
                if (crashed) item(key = "crash") { LastCrashBanner() }
                // Searching every trip's bookings too (SPEC "Searching trips").
                item(key = "search") {
                    OutlinedTextField(
                        value = searchText,
                        onValueChange = viewModel::searchTrips,
                        label = { Text(stringResource(Res.string.search_trips)) },
                        leadingIcon = { Icon(Icons.Filled.Search, contentDescription = null) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
                // What to leave out, kept on this phone (SPEC "Filtering the trip list").
                item(key = "filters") {
                    // Wrapping, so a large text size keeps each label on one line.
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(
                            selected = filters.hideCancelled,
                            onClick = { viewModel.setListFilters(filters.copy(hideCancelled = !filters.hideCancelled)) },
                            label = { Text(stringResource(Res.string.hide_cancelled)) },
                        )
                        FilterChip(
                            selected = filters.hideLocal,
                            onClick = { viewModel.setListFilters(filters.copy(hideLocal = !filters.hideLocal)) },
                            label = { Text(stringResource(Res.string.hide_local_events)) },
                        )
                    }
                }
                val result = found
                val kept = groups.without(hidden)
                val shown = if (result == null) kept else kept.only(result.ids)
                if (result == null && hidden.isNotEmpty() && kept.current.isEmpty() && kept.upcoming.isEmpty() && kept.past.isEmpty()) {
                    item(key = "all-hidden") { Message(stringResource(Res.string.all_trips_hidden), Modifier) }
                }
                if (result != null && !result.bookingsSearched) item(key = "searching") { Message(stringResource(Res.string.searching_bookings), Modifier) }
                // Judged by what is shown: a search can find only trips the filters hide.
                val nothingShown = shown.current.isEmpty() && shown.upcoming.isEmpty() && shown.past.isEmpty()
                if (result != null && result.bookingsSearched && nothingShown) item(key = "no-match") { Message(stringResource(Res.string.no_trips_match), Modifier) }
                if (checkInFailed != null) {
                    item(key = "checked-in-failed") {
                        Text(checkInFailed, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
                    }
                }
                // Document warnings once, at the top, each for the earliest trip
                // it bears on and opening it, rather than repeated on every card.
                if (state.warnings.isNotEmpty()) {
                    item(key = "warnings") {
                        ListWarnings(state.warnings, titles, today = state.now.substring(0, 10), onOpenTrip = onOpenTrip)
                    }
                }
                // What comes next is said only for a trip under way; an upcoming
                // trip's card is its title and dates.
                val onCheckedIn = { tripId: String, segmentId: String -> viewModel.setCheckedIn("$CHECKED_IN_TOKEN$tripId/$segmentId", tripId, segmentId, true) }
                section(Res.string.section_now, shown.current, titles, state, uid, showNext = true, onOpenTrip, onCheckedIn)
                section(Res.string.section_upcoming, shown.upcoming, titles, state, uid, showNext = false, onOpenTrip, onCheckedIn)
                section(Res.string.section_past, shown.past, titles, state, uid, showNext = false, onOpenTrip, onCheckedIn)
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
) {
    if (trips.isEmpty()) return
    item(key = "section-$title") {
        Text(
            stringResource(title),
            style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.padding(top = 8.dp),
        )
    }
    items(trips, key = { it.id }) { trip ->
        TripCard(
            trip = trip, title = titles[trip.id] ?: trip.title, shared = trip.ownerUid != uid, segments = state.segmentsByTrip[trip.id], now = state.now, showNext = showNext,
            flightStatuses = state.flightStatuses, checkedIn = state.checkedIn[trip.id].orEmpty(),
            onCheckedIn = { segmentId -> onCheckedIn(trip.id, segmentId) },
            onClick = { onOpenTrip(trip.id) },
        )
    }
}

/**
 * One trip: the title (as [displayTitles] shows it among the list), its dates, whether every booking was
 * cancelled when its [segments] are loaded, and with [showNext] (a trip under way) what comes next, with the live
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
    onClick: () -> Unit,
) {
    val badge = when {
        trip.deleting -> stringResource(Res.string.badge_deleting) to MaterialTheme.colorScheme.onSurfaceVariant
        shared -> stringResource(Res.string.badge_shared) to TravelmoTheme.colors.shared
        else -> null
    }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Text(
                title,
                style = MaterialTheme.typography.titleLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            badge?.let { (text, color) -> Text(text.uppercase(), style = MaterialTheme.typography.labelMedium, color = color) }
        }
        Text(formatDateRange(trip.shownStart, trip.shownEnd), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
        if (trip.cancelledAt != null) {
            // A cancelled trip has nothing coming.
            Text(stringResource(Res.string.trip_cancelled), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp))
        } else if (segments != null) StatusLines(segments, now, showNext, flightStatuses, checkedIn, onCheckedIn)
    }
}

/**
 * Whether every booking was cancelled, then with [showNext] the stay under way, what comes next ([tripNextUp], with the
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
) {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    if (allCancelled(segments)) {
        Text(stringResource(Res.string.trip_all_cancelled), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp))
        return
    }
    if (!showNext) return
    val status = tripStatus(segments, now)
    status.stay?.let { stay ->
        val until = stay.end?.let { " · until ${formatDate(localDate(it))} ${localTime(it)}" } ?: ""
        Text(stringResource(Res.string.staying_at, stay.title) + until, style = MaterialTheme.typography.bodyLarge, color = muted, modifier = Modifier.padding(top = 8.dp))
    }
    tripNextUp(segments, now, flightStatuses)?.let { next ->
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
    status.checkIn?.takeIf { it.segment.id !in checkedIn }?.let { checkIn ->
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
