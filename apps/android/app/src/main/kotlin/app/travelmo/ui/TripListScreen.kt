package app.travelmo.ui

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.travelmo.R
import app.travelmo.core.Segment
import app.travelmo.core.Trip
import app.travelmo.core.checkInLine
import app.travelmo.core.eventVerb
import app.travelmo.core.formatDate
import app.travelmo.core.formatDateRange
import app.travelmo.core.localDate
import app.travelmo.core.localTime
import app.travelmo.core.relativeTime
import app.travelmo.core.tripStatus
import app.travelmo.ui.theme.SharedBadge

/** Now, Upcoming and Past, each card with what comes next (SPEC.md "The trip list"). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TripListScreen(viewModel: TripsViewModel, uid: String, onOpenTrip: (String) -> Unit, onOpenSettings: () -> Unit) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.app_name)) },
                actions = {
                    IconButton(onClick = onOpenSettings) {
                        Icon(Icons.Filled.Settings, contentDescription = stringResource(R.string.settings))
                    }
                },
            )
        },
    ) { padding ->
        val groups = state.groups
        when {
            groups == null -> Message(stringResource(R.string.trips_loading), Modifier.padding(padding))
            groups.current.isEmpty() && groups.upcoming.isEmpty() && groups.past.isEmpty() ->
                Column(Modifier.fillMaxSize().padding(padding).padding(top = 64.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(stringResource(R.string.trips_empty), color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(stringResource(R.string.trips_empty_hint), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
                }
            else -> LazyColumn(
                modifier = Modifier.fillMaxSize().padding(padding),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                section(R.string.section_now, groups.current, state, uid, onOpenTrip)
                section(R.string.section_upcoming, groups.upcoming, state, uid, onOpenTrip)
                section(R.string.section_past, groups.past, state, uid, onOpenTrip)
            }
        }
    }
}

@Composable
private fun Message(text: String, modifier: Modifier = Modifier) {
    Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = modifier.padding(16.dp))
}

private fun androidx.compose.foundation.lazy.LazyListScope.section(title: Int, trips: List<Trip>, state: TripListState, uid: String, onOpenTrip: (String) -> Unit) {
    if (trips.isEmpty()) return
    item(key = "section-$title") {
        Text(
            stringResource(title),
            style = MaterialTheme.typography.titleMedium,
            modifier = Modifier.padding(top = 8.dp),
        )
    }
    items(trips, key = { it.id }) { trip ->
        TripCard(trip = trip, shared = trip.ownerUid != uid, segments = state.segmentsByTrip[trip.id], now = state.now, onClick = { onOpenTrip(trip.id) })
    }
}

/** One trip: the title, its dates, and for the trips with listeners what comes next. */
@Composable
fun TripCard(trip: Trip, shared: Boolean, segments: List<Segment>?, now: String, onClick: () -> Unit) {
    val badge = when {
        trip.deleting -> stringResource(R.string.badge_deleting) to MaterialTheme.colorScheme.onSurfaceVariant
        shared -> stringResource(R.string.badge_shared) to SharedBadge
        else -> null
    }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(12.dp))
            .clickable(onClick = onClick)
            .alpha(if (trip.deleting) 0.6f else 1f)
            .padding(16.dp),
    ) {
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Text(
                trip.title,
                style = MaterialTheme.typography.titleLarge,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            badge?.let { (text, color) -> Text(text.uppercase(), style = MaterialTheme.typography.labelSmall, color = color) }
        }
        Text(formatDateRange(trip.start, trip.end), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
        if (segments != null) StatusLines(segments, now)
    }
}

/** The stay under way, the next event with how soon, and the flight's check-in window. */
@Composable
private fun StatusLines(segments: List<Segment>, now: String) {
    val status = tripStatus(segments, now)
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    status.stay?.let { stay ->
        val until = stay.end?.let { " · until ${formatDate(localDate(it))} ${localTime(it)}" } ?: ""
        Text(stringResource(R.string.staying_at, stay.title) + until, style = MaterialTheme.typography.bodyMedium, color = muted, modifier = Modifier.padding(top = 8.dp))
    }
    status.next?.let { event ->
        val soon = relativeTime(now, event.at)?.let { " · $it" } ?: ""
        Row(modifier = Modifier.padding(top = 8.dp)) {
            Text(eventVerb(event), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
            Text(
                " ${event.segment.title} · ${formatDate(localDate(event.at))} ${localTime(event.at)}$soon",
                style = MaterialTheme.typography.bodyMedium,
                color = muted,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
    status.checkIn?.let { checkIn ->
        Text(
            checkInLine(checkIn),
            style = MaterialTheme.typography.bodyMedium,
            color = if (checkIn.open) MaterialTheme.colorScheme.tertiary else muted,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
}

