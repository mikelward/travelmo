package app.travelmo.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.travelmo.core.Trip
import app.travelmo.core.TripBar
import app.travelmo.core.addMonths
import app.travelmo.core.displayTitles
import app.travelmo.core.monthLabel
import app.travelmo.core.monthOf
import app.travelmo.core.monthWeeks
import app.travelmo.core.weekBars
import app.travelmo.shared.Res
import app.travelmo.shared.nav_calendar
import app.travelmo.shared.next_month
import app.travelmo.shared.no_trips_in
import app.travelmo.shared.previous_month
import app.travelmo.shared.today
import app.travelmo.shared.trips_loading
import app.travelmo.ui.theme.TravelmoTheme
import org.jetbrains.compose.resources.stringResource

private val weekdays = listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")

/**
 * A month of trips as bars across its weeks (SPEC.md "The trip list"), as the
 * web's /calendar. The month shown is the caller's ([month], null for the
 * current one), so it survives the screen leaving the composition.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CalendarScreen(
    viewModel: TripsViewModel,
    uid: String,
    month: String?,
    onMonthChange: (String) -> Unit,
    onOpenTrip: (String) -> Unit,
    onOpenSettings: () -> Unit,
    bottomBar: @Composable () -> Unit,
) {
    val trips by viewModel.trips.collectAsStateWithLifecycle()
    val today = viewModel.today()
    val month = month ?: monthOf(today)
    Scaffold(
        topBar = {
            AppTopBar(stringResource(Res.string.nav_calendar), onOpenSettings = onOpenSettings)
        },
        bottomBar = bottomBar,
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            MonthSwitcher(month = month, today = today, onMonthChange = onMonthChange)
            val all = trips
            if (all == null) {
                Text(stringResource(Res.string.trips_loading), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp))
            } else {
                val inMonth = all.filter { monthOf(it.start) <= month && monthOf(it.end) >= month }
                val scroll = rememberScrollState()
                Column(modifier = Modifier.fillMaxSize().scrollEdgeCue(scroll, scrollCueColors()).verticalScroll(scroll).padding(start = 16.dp, end = 16.dp, bottom = 12.dp)) {
                    MonthGrid(month = month, trips = inMonth, titles = displayTitles(all), today = today, uid = uid, onOpenTrip = onOpenTrip)
                    if (inMonth.isEmpty()) {
                        Text(
                            stringResource(Res.string.no_trips_in, monthLabel(month)),
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(top = 16.dp),
                        )
                    }
                }
            }
        }
    }
}

/**
 * The month shown, between the arrows to the previous and next ones, and
 * Today to come back to the current month. Below the top bar, which the
 * month's name and four buttons would crowd on a phone.
 */
@Composable
private fun MonthSwitcher(month: String, today: String, onMonthChange: (String) -> Unit) {
    Row(modifier = Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = { onMonthChange(addMonths(month, -1)) }) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(Res.string.previous_month))
        }
        Text(
            monthLabel(month),
            style = MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        IconButton(onClick = { onMonthChange(addMonths(month, 1)) }) {
            Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(Res.string.next_month), modifier = Modifier.scale(scaleX = -1f, scaleY = 1f))
        }
        TextButton(onClick = { onMonthChange(monthOf(today)) }, enabled = month != monthOf(today)) {
            Text(stringResource(Res.string.today))
        }
    }
}

@Composable
private fun MonthGrid(month: String, trips: List<Trip>, titles: Map<String, String>, today: String, uid: String, onOpenTrip: (String) -> Unit) {
    val shape = RoundedCornerShape(12.dp)
    Column(modifier = Modifier.fillMaxWidth().clip(shape).border(1.dp, MaterialTheme.colorScheme.outlineVariant, shape)) {
        Row(modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
            for (day in weekdays) {
                Text(
                    day.uppercase(),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.weight(1f),
                )
            }
        }
        for (week in monthWeeks(month)) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            Week(week = week, trips = trips, titles = titles, month = month, today = today, uid = uid, onOpenTrip = onOpenTrip)
        }
    }
}

/** Seven day numbers, then one row per lane with the trips' bars across it. */
@Composable
private fun Week(week: List<String>, trips: List<Trip>, titles: Map<String, String>, month: String, today: String, uid: String, onOpenTrip: (String) -> Unit) {
    val bars = weekBars(week, trips)
    val lanes = (bars.maxOfOrNull { it.lane } ?: -1) + 1
    Column(modifier = Modifier.fillMaxWidth().defaultMinSize(minHeight = 56.dp).padding(bottom = 6.dp)) {
        Row(modifier = Modifier.fillMaxWidth()) {
            for (date in week) {
                val inMonth = monthOf(date) == month
                val isToday = date == today
                Box(modifier = Modifier.weight(1f).padding(start = 6.dp, top = 6.dp, bottom = 2.dp)) {
                    Text(
                        date.substring(8, 10).trimStart('0'),
                        style = MaterialTheme.typography.bodyLarge,
                        fontWeight = if (isToday) FontWeight.Medium else null,
                        color = when {
                            isToday -> MaterialTheme.colorScheme.onPrimary
                            inMonth -> MaterialTheme.colorScheme.onSurface
                            else -> MaterialTheme.colorScheme.onSurfaceVariant
                        },
                        modifier = if (isToday) Modifier.background(MaterialTheme.colorScheme.primary, RoundedCornerShape(999.dp)).padding(horizontal = 6.dp) else Modifier,
                    )
                }
            }
        }
        for (lane in 0 until lanes) {
            Row(modifier = Modifier.fillMaxWidth().padding(top = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                var column = 0
                for (bar in bars.filter { it.lane == lane }.sortedBy { it.from }) {
                    if (bar.from > column) Spacer(modifier = Modifier.weight((bar.from - column).toFloat()))
                    Bar(bar = bar, title = titles[bar.trip.id] ?: bar.trip.title, shared = bar.trip.ownerUid != uid, modifier = Modifier.weight((bar.to - bar.from + 1).toFloat()), onClick = { onOpenTrip(bar.trip.id) })
                    column = bar.to + 1
                }
                if (column < week.size) Spacer(modifier = Modifier.weight((week.size - column).toFloat()))
            }
        }
    }
}

/** A trip's bar: its title where it starts, an ellipsis where it carried over, the whole bar a tap to the trip. */
@Composable
private fun Bar(bar: TripBar, title: String, shared: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val radius = 6.dp
    val shape = RoundedCornerShape(
        topStart = if (bar.continuesBefore) 0.dp else radius,
        bottomStart = if (bar.continuesBefore) 0.dp else radius,
        topEnd = if (bar.continuesAfter) 0.dp else radius,
        bottomEnd = if (bar.continuesAfter) 0.dp else radius,
    )
    // A trip being deleted is grayed out with text that still reads, rather
    // than its color faded under white text.
    val (background, foreground) = when {
        bar.trip.deleting -> MaterialTheme.colorScheme.surfaceVariant to MaterialTheme.colorScheme.onSurfaceVariant
        shared -> TravelmoTheme.colors.sharedContainer to TravelmoTheme.colors.onSharedContainer
        else -> MaterialTheme.colorScheme.primary to MaterialTheme.colorScheme.onPrimary
    }
    Text(
        (if (bar.continuesBefore) "… " else "") + title,
        style = MaterialTheme.typography.bodyLarge,
        color = foreground,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = modifier
            .padding(horizontal = 1.dp)
            .clip(shape)
            .background(background)
            .clickable(onClick = onClick)
            .padding(horizontal = 6.dp, vertical = 2.dp),
    )
}
