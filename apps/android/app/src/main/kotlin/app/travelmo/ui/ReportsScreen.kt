package app.travelmo.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.travelmo.R
import app.travelmo.core.AirportVisit
import app.travelmo.core.FavoritePlace
import app.travelmo.core.PlaceVisit
import app.travelmo.core.TravelReport
import app.travelmo.core.TripWithBookings
import app.travelmo.core.WorldMapData
import app.travelmo.core.countryName
import app.travelmo.core.favoritePlaces
import app.travelmo.core.travelReport
import app.travelmo.core.worldMap

/**
 * Where the traveler has been, as the web's /reports counts it: the trips
 * begun, the days away and the countries, a world map with those countries
 * filled and the airports and placed bookings marked, days per country,
 * the places rated or marked, and trips per year. A year narrows the counts
 * and the map; the years table always shows every year.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReportsScreen(viewModel: TripsViewModel, onOpenTrip: (String) -> Unit, bottomBar: @Composable () -> Unit) {
    val all by viewModel.reportTrips.collectAsStateWithLifecycle()
    var year by rememberSaveable { mutableStateOf<String?>(null) }
    val today = viewModel.today()
    val input = all
    val whole = remember(input, today) { input?.let { travelReport(it, today) } }
    val report = remember(input, today, year) { if (year == null) whole else input?.let { travelReport(it, today, year) } }
    val favorites = remember(input) { input?.let { trips -> favoritePlaces(trips.map { TripWithBookings(it.trip, it.segments) }) }.orEmpty() }
    Scaffold(topBar = { TopAppBar(title = { Text(stringResource(R.string.reports_title)) }) }, bottomBar = bottomBar) { padding ->
        if (whole == null || report == null) {
            Text(stringResource(R.string.reports_loading), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(padding).padding(16.dp))
            return@Scaffold
        }
        LazyColumn(modifier = Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp)) {
            item(key = "year") { YearPicker(whole.years.map { it.year }, year) { year = it } }
            item(key = "summary") { Summary(report) }
            item(key = "map") {
                WorldMap(worldMap, visited = report.countries.map { it.country }.toSet(), airports = report.airports, places = report.places, modifier = Modifier.padding(top = 16.dp))
            }
            if (report.unknownDays > 0 || report.unplaced > 0) {
                item(key = "unplaced") {
                    val parts = listOfNotNull(
                        report.unknownDays.takeIf { it > 0 }?.let { pluralStringResource(R.plurals.unknown_days, it, it) },
                        report.unplaced.takeIf { it > 0 }?.let { pluralStringResource(R.plurals.unplaced_bookings, it, it) },
                    )
                    Text(stringResource(R.string.unplaced_hint, parts.joinToString("; ")), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
                }
            }
            if (report.countries.isNotEmpty()) {
                item(key = "countries") {
                    SectionTitle(stringResource(R.string.days_in_each_country))
                    Table(
                        header = listOf(stringResource(R.string.col_country) to 2f, stringResource(R.string.col_days) to 0.7f, stringResource(R.string.col_trips) to 0.7f),
                        rows = report.countries.map { listOf(countryName(it.country), it.days.toString(), it.trips.toString()) },
                    )
                }
            }
            if (favorites.isNotEmpty()) {
                item(key = "favorites") { SectionTitle(stringResource(R.string.favorite_places)) }
                for (place in favorites) {
                    item(key = "favorite-${place.name}|${place.country ?: ""}") { Favorite(place, onOpenTrip) }
                }
            }
            if (whole.years.isNotEmpty()) {
                item(key = "years") {
                    SectionTitle(stringResource(R.string.trips_per_year))
                    Table(
                        header = listOf(stringResource(R.string.col_year) to 1f, stringResource(R.string.col_trips) to 0.7f, stringResource(R.string.col_days) to 0.7f, stringResource(R.string.col_countries) to 1f),
                        rows = whole.years.map { listOf(it.year, it.trips.toString(), it.days.toString(), it.countries.toString()) },
                        onRow = { row -> year = whole.years[row].year },
                    )
                }
            }
            if (whole.upcoming > 0) {
                item(key = "upcoming") {
                    Text(pluralStringResource(R.plurals.trips_ahead, whole.upcoming, whole.upcoming), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 24.dp))
                }
            }
            if (whole.trips == 0 && whole.upcoming == 0) {
                item(key = "none") { Text(stringResource(R.string.no_trips_yet), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 24.dp)) }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun YearPicker(years: List<String>, year: String?, onPick: (String?) -> Unit) {
    var open by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = open, onExpandedChange = { open = it }) {
        OutlinedTextField(
            value = year ?: stringResource(R.string.all_years),
            onValueChange = {},
            readOnly = true,
            label = { Text(stringResource(R.string.year)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = open) },
            modifier = Modifier.menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            DropdownMenuItem(text = { Text(stringResource(R.string.all_years)) }, onClick = { onPick(null); open = false })
            for (y in years) DropdownMenuItem(text = { Text(y) }, onClick = { onPick(y); open = false })
        }
    }
}

@Composable
private fun Summary(report: TravelReport) {
    val line = listOf(
        pluralStringResource(R.plurals.trips_count, report.trips, report.trips),
        pluralStringResource(R.plurals.days_away, report.days, report.days),
        pluralStringResource(R.plurals.countries_count, report.countries.size, report.countries.size),
    ).joinToString(" · ")
    Text(line, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 12.dp))
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
}

/** A small table: a muted header, then rows divided by hairlines; numbers right-aligned. */
@Composable
private fun Table(header: List<Pair<String, Float>>, rows: List<List<String>>, onRow: ((Int) -> Unit)? = null) {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.padding(vertical = 4.dp)) {
            for ((i, column) in header.withIndex()) {
                Text(column.first, style = MaterialTheme.typography.labelMedium, color = muted, textAlign = if (i == 0) TextAlign.Start else TextAlign.End, modifier = Modifier.weight(column.second))
            }
        }
        for ((r, row) in rows.withIndex()) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            val rowModifier = if (onRow != null) Modifier.clickable { onRow(r) } else Modifier
            Row(modifier = rowModifier.padding(vertical = 6.dp)) {
                for ((i, cell) in row.withIndex()) {
                    Text(cell, style = MaterialTheme.typography.bodySmall, textAlign = if (i == 0) TextAlign.Start else TextAlign.End, modifier = Modifier.weight(header[i].second))
                }
            }
        }
    }
}

/** A rated or marked place: the heart, its name and whereabouts, its stars, and the trips it was on, each opening that trip. */
@Composable
private fun Favorite(place: FavoritePlace, onOpenTrip: (String) -> Unit) {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val favoriteMark = stringResource(R.string.favorite_mark)
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (place.favorite) Text("♥", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.semantics { contentDescription = favoriteMark })
            Text(place.name, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
            place.rating?.let { Text("★".repeat(it) + "☆".repeat(5 - it), color = MaterialTheme.colorScheme.tertiary, style = MaterialTheme.typography.bodyMedium) }
        }
        val where = listOfNotNull(place.city, place.country?.let { countryName(it) }).joinToString(", ")
        if (where.isNotEmpty()) Text(where, style = MaterialTheme.typography.bodySmall, color = muted)
        // A place on many trips wraps its links onto more lines rather than running off the screen.
        FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            for (trip in place.trips) {
                Text(trip.title, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary, modifier = Modifier.clickable { onOpenTrip(trip.id) }.padding(vertical = 2.dp))
            }
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(top = 8.dp))
    }
}

/**
 * The web's map, drawn: countries visited are filled, airports flown
 * through are dots, and the stays, stations and other places whose bookings
 * say where they are smaller ones. The map's units scale to the width.
 */
@Composable
fun WorldMap(data: WorldMapData, visited: Set<String>, airports: List<AirportVisit>, places: List<PlaceVisit>, modifier: Modifier = Modifier) {
    val paths = remember(data) {
        data.countries.map { country ->
            country.code to Path().apply {
                for (ring in country.rings) {
                    ring.firstOrNull()?.let { moveTo(it.first, it.second) }
                    for (p in ring.drop(1)) lineTo(p.first, p.second)
                    close()
                }
            }
        }
    }
    // The web's sky blue for a country visited (sky-600 by day, sky-400 by
    // night), which reads against the theme's violet and amber alike.
    val filled = if (MaterialTheme.colorScheme.surface.luminance() < 0.5f) Color(0xFF38BDF8) else Color(0xFF0284C7)
    val empty = MaterialTheme.colorScheme.surfaceVariant
    val border = MaterialTheme.colorScheme.surface
    val airport = MaterialTheme.colorScheme.tertiary
    val place = MaterialTheme.colorScheme.error
    val description = if (visited.isEmpty()) stringResource(R.string.map_empty) else stringResource(R.string.map_description, visited.map { countryName(it) }.sorted().joinToString(", "))
    val (left, top, width, height) = data.viewBox
    Canvas(modifier = modifier.fillMaxWidth().aspectRatio((width / height).toFloat()).semantics { contentDescription = description }) {
        val factor = size.width / width.toFloat()
        scale(factor, pivot = Offset.Zero) {
            translate(-left.toFloat(), -top.toFloat()) {
                for ((code, path) in paths) {
                    drawPath(path, if (code in visited) filled else empty, style = Fill)
                    drawPath(path, border, style = Stroke(width = 0.5f))
                }
                for (p in places) {
                    val (x, y) = data.project(p.lon, p.lat)
                    drawCircle(place, radius = 4f, center = Offset(x, y))
                    drawCircle(border, radius = 4f, center = Offset(x, y), style = Stroke(width = 1f))
                }
                for (a in airports) {
                    val (x, y) = data.project(a.lon, a.lat)
                    drawCircle(airport, radius = 6f, center = Offset(x, y))
                    drawCircle(border, radius = 6f, center = Offset(x, y), style = Stroke(width = 1.5f))
                }
            }
        }
    }
}
