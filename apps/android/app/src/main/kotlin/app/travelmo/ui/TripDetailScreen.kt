package app.travelmo.ui

import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.travelmo.R
import app.travelmo.core.Segment
import app.travelmo.core.Trip
import app.travelmo.core.formatDate
import app.travelmo.core.formatDateRange
import app.travelmo.core.referenceLine
import app.travelmo.core.routeLine
import app.travelmo.core.segmentsByDay
import app.travelmo.core.timesLine
import app.travelmo.ui.theme.SharedBadge

/** A trip's bookings by day, read-only for now, as the web's trip page lists them. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TripDetailScreen(viewModel: TripsViewModel, tripId: String, uid: String, onBack: () -> Unit) {
    val tripFlow = remember(tripId) { viewModel.trip(tripId) }
    val segmentsFlow = remember(tripId) { viewModel.segments(tripId) }
    val trip by tripFlow.collectAsStateWithLifecycle(initialValue = null)
    val segments by segmentsFlow.collectAsStateWithLifecycle(initialValue = emptyList())
    val loaded by viewModel.state.collectAsStateWithLifecycle()
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
    ) { padding ->
        val current = trip
        when {
            current != null -> TripBody(current, segments, shared = current.ownerUid != uid, modifier = Modifier.padding(padding))
            loaded.groups == null -> Text(stringResource(R.string.trip_loading), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(padding).padding(16.dp))
            else -> Text(stringResource(R.string.trip_not_found), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(padding).padding(16.dp))
        }
    }
}

@Composable
private fun TripBody(trip: Trip, segments: List<Segment>, shared: Boolean, modifier: Modifier = Modifier) {
    val days = segmentsByDay(segments)
    LazyColumn(modifier = modifier.fillMaxSize(), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp)) {
        item(key = "dates") {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(formatDateRange(trip.start, trip.end), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (shared) Text(stringResource(R.string.badge_shared).uppercase(), style = MaterialTheme.typography.labelSmall, color = SharedBadge)
            }
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
                SegmentRow(segment)
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

/** One booking: its kind, title, route, times, reference, verdict, sources and sender. */
@Composable
fun SegmentRow(segment: Segment) {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
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
            segment.notes?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = muted, modifier = Modifier.padding(top = 4.dp)) }
            Verdict(segment)
            if (segment.sourceCount > 0) {
                Text(
                    pluralStringResource(R.plurals.sources, segment.sourceCount, segment.sourceCount),
                    style = MaterialTheme.typography.bodySmall,
                    color = muted,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
            segment.sender?.let { Text(stringResource(R.string.from_sender, it), style = MaterialTheme.typography.bodySmall, color = muted, modifier = Modifier.padding(top = 4.dp)) }
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
