package app.travelmo.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.travelmo.core.AirportVisit
import app.travelmo.core.FavoritePlace
import app.travelmo.core.HomePeriod
import app.travelmo.core.PlaceVisit
import app.travelmo.core.TravelReport
import app.travelmo.core.TripWithBookings
import app.travelmo.core.TripWithSegments
import app.travelmo.core.WorldMapData
import app.travelmo.core.countryName
import app.travelmo.core.displayTitles
import app.travelmo.core.favoritePlaces
import app.travelmo.core.formatDateRange
import app.travelmo.core.formatDateWithYear
import app.travelmo.core.placeRows
import app.travelmo.core.placeRowsCsv
import app.travelmo.core.travelReport
import app.travelmo.core.tripRows
import app.travelmo.core.tripRowsCsv
import app.travelmo.core.worldMap
import app.travelmo.log.TravelmoLog
import app.travelmo.shared.Res
import app.travelmo.shared.abroad_only
import app.travelmo.shared.all_years
import app.travelmo.shared.cancel
import app.travelmo.shared.col_countries
import app.travelmo.shared.col_country
import app.travelmo.shared.col_days
import app.travelmo.shared.col_trips
import app.travelmo.shared.col_year
import app.travelmo.shared.countries_count
import app.travelmo.shared.days_away
import app.travelmo.shared.days_in_each_country
import app.travelmo.shared.download_csv
import app.travelmo.shared.download_trips
import app.travelmo.shared.download_trips_hint
import app.travelmo.shared.favorite_mark
import app.travelmo.shared.favorite_places
import app.travelmo.shared.map_description
import app.travelmo.shared.map_empty
import app.travelmo.shared.no_trips_yet
import app.travelmo.shared.ok
import app.travelmo.shared.reports_loading
import app.travelmo.shared.reports_title
import app.travelmo.shared.row_per_place
import app.travelmo.shared.row_per_trip
import app.travelmo.shared.trips_ahead
import app.travelmo.shared.trips_count
import app.travelmo.shared.trips_per_year
import app.travelmo.shared.trips_save_failed
import app.travelmo.shared.trips_saved
import app.travelmo.shared.trips_up_to
import app.travelmo.shared.unknown_days
import app.travelmo.shared.unplaced_bookings
import app.travelmo.shared.unplaced_hint
import app.travelmo.shared.year
import app.travelmo.ui.theme.TravelmoTheme
import com.mikelward.androidzoom.compose.pinchFontSizeHost
import java.io.IOException
import java.time.LocalDate
import java.time.ZoneOffset
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.pluralStringResource
import org.jetbrains.compose.resources.stringResource

/**
 * Where the traveler has been, as the web's /reports counts it: the trips
 * begun, the days away and the countries, a world map with those countries
 * filled and the airports and placed bookings marked, days per country,
 * the places rated or marked, days in and out of countries against
 * residence and visa limits (ResidenceDays), and trips per year. A year narrows the counts
 * and the map; the years table always shows every year.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ReportsScreen(viewModel: TripsViewModel, onOpenTrip: (String) -> Unit, bottomBar: @Composable () -> Unit) {
    val all by viewModel.reportTrips.collectAsStateWithLifecycle()
    val homes by viewModel.reportHomes.collectAsStateWithLifecycle()
    var year by rememberSaveable { mutableStateOf<String?>(null) }
    val today = viewModel.today()
    val input = all
    val whole = remember(input, today) { input?.let { travelReport(it, today) } }
    val report = remember(input, today, year) { if (year == null) whole else input?.let { travelReport(it, today, year) } }
    val titles = remember(input) { displayTitles(input.orEmpty().map { it.trip }) }
    val favorites = remember(input) { input?.let { trips -> favoritePlaces(trips.map { TripWithBookings(it.trip, it.segments) }) }.orEmpty() }
    Scaffold(topBar = { TopAppBar(title = { Text(stringResource(Res.string.reports_title)) }, actions = { AppMenu() }) }, bottomBar = bottomBar) { padding ->
        if (whole == null || report == null) {
            Text(stringResource(Res.string.reports_loading), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(padding).padding(16.dp))
            return@Scaffold
        }
        val list = rememberLazyListState()
        LazyColumn(modifier = Modifier.fillMaxSize().padding(padding).scrollEdgeCue(list, scrollCueColors()), state = list, contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp)) {
            item(key = "year") { YearPicker(whole.years.map { it.year }, year) { year = it } }
            item(key = "summary") { Summary(report) }
            item(key = "map") {
                WorldMap(worldMap, visited = report.countries.map { it.country }.toSet(), airports = report.airports, places = report.places, modifier = Modifier.padding(top = 16.dp))
            }
            if (report.unknownDays > 0 || report.unplaced > 0) {
                item(key = "unplaced") {
                    val parts = listOfNotNull(
                        report.unknownDays.takeIf { it > 0 }?.let { pluralStringResource(Res.plurals.unknown_days, it, it) },
                        report.unplaced.takeIf { it > 0 }?.let { pluralStringResource(Res.plurals.unplaced_bookings, it, it) },
                    )
                    Text(stringResource(Res.string.unplaced_hint, parts.joinToString("; ")), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
                }
            }
            if (report.countries.isNotEmpty()) {
                item(key = "countries") {
                    // Each country opens to the trips with days there, so a surprising one can be found.
                    var open by rememberSaveable { mutableStateOf<String?>(null) }
                    val trips = remember(input) { input.orEmpty().associate { it.trip.id to it.trip } }
                    SectionTitle(stringResource(Res.string.days_in_each_country))
                    Table(
                        header = listOf(stringResource(Res.string.col_country) to 2f, stringResource(Res.string.col_days) to 0.7f, stringResource(Res.string.col_trips) to 0.7f),
                        rows = report.countries.map { listOf(countryName(it.country), it.days.toString(), it.trips.toString()) },
                        onRow = { r -> report.countries[r].country.let { open = if (open == it) null else it } },
                        open = report.countries.indexOfFirst { it.country == open }.takeIf { it >= 0 },
                        under = { r ->
                            Column(modifier = Modifier.padding(start = 16.dp, bottom = 8.dp)) {
                                for (id in report.countries[r].tripIds) {
                                    val trip = trips[id]
                                    Text(
                                        listOfNotNull(titles[id] ?: trip?.title, trip?.let { formatDateRange(it.start, it.end) }).joinToString(" · "),
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.primary,
                                        modifier = Modifier.clickable { onOpenTrip(id) }.padding(vertical = 4.dp),
                                    )
                                }
                            }
                        },
                    )
                }
            }
            if (favorites.isNotEmpty()) {
                item(key = "favorites") { SectionTitle(stringResource(Res.string.favorite_places)) }
                for (place in favorites) {
                    item(key = "favorite-${place.name}|${place.country ?: ""}") { Favorite(place, titles, onOpenTrip) }
                }
            }
            homes?.let { periods ->
                item(key = "residence") { ResidenceDays(input.orEmpty(), periods, today, titles, onOpenTrip) }
            }
            if (whole.years.isNotEmpty()) {
                item(key = "years") {
                    SectionTitle(stringResource(Res.string.trips_per_year))
                    Table(
                        header = listOf(stringResource(Res.string.col_year) to 1f, stringResource(Res.string.col_trips) to 0.7f, stringResource(Res.string.col_days) to 0.7f, stringResource(Res.string.col_countries) to 1f),
                        rows = whole.years.map { listOf(it.year, it.trips.toString(), it.days.toString(), it.countries.toString()) },
                        onRow = { row -> year = whole.years[row].year },
                    )
                }
            }
            homes?.let { periods ->
                item(key = "download") { DownloadTrips(input.orEmpty(), periods, titles, today) }
            }
            if (whole.upcoming > 0) {
                item(key = "upcoming") {
                    Text(pluralStringResource(Res.plurals.trips_ahead, whole.upcoming, whole.upcoming), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 24.dp))
                }
            }
            if (whole.trips == 0 && whole.upcoming == 0) {
                item(key = "none") { Text(stringResource(Res.string.no_trips_yet), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 24.dp)) }
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
            value = year ?: stringResource(Res.string.all_years),
            onValueChange = {},
            readOnly = true,
            label = { Text(stringResource(Res.string.year)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = open) },
            modifier = Modifier.menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(expanded = open, onDismissRequest = { open = false }, modifier = Modifier.pinchFontSizeHost()) {
            DropdownMenuItem(text = { Text(stringResource(Res.string.all_years)) }, onClick = { onPick(null); open = false })
            for (y in years) DropdownMenuItem(text = { Text(y) }, onClick = { onPick(y); open = false })
        }
    }
}

@Composable
private fun Summary(report: TravelReport) {
    val line = listOf(
        pluralStringResource(Res.plurals.trips_count, report.trips, report.trips),
        pluralStringResource(Res.plurals.days_away, report.days, report.days),
        pluralStringResource(Res.plurals.countries_count, report.countries.size, report.countries.size),
    ).joinToString(" · ")
    Text(line, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 12.dp))
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
}

/** A small table: a muted header, then rows divided by hairlines; numbers right-aligned. */
@Composable
private fun Table(
    header: List<Pair<String, Float>>,
    rows: List<List<String>>,
    onRow: ((Int) -> Unit)? = null,
    // The row opened, and what shows under it.
    open: Int? = null,
    under: @Composable (Int) -> Unit = {},
) {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(modifier = Modifier.padding(vertical = 4.dp)) {
            for ((i, column) in header.withIndex()) {
                Text(column.first, style = MaterialTheme.typography.labelLarge, color = muted, textAlign = if (i == 0) TextAlign.Start else TextAlign.End, modifier = Modifier.weight(column.second))
            }
        }
        for ((r, row) in rows.withIndex()) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            val rowModifier = if (onRow != null) Modifier.clickable { onRow(r) } else Modifier
            Row(modifier = rowModifier.padding(vertical = 6.dp)) {
                for ((i, cell) in row.withIndex()) {
                    Text(cell, style = MaterialTheme.typography.bodyMedium, textAlign = if (i == 0) TextAlign.Start else TextAlign.End, modifier = Modifier.weight(header[i].second))
                }
            }
            if (open == r) under(r)
        }
    }
}

/** A rated or marked place: the heart, its name and whereabouts, its stars, and the trips it was on, each opening that trip. */
@Composable
private fun Favorite(place: FavoritePlace, titles: Map<String, String>, onOpenTrip: (String) -> Unit) {
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val favoriteMark = stringResource(Res.string.favorite_mark)
    Column(modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (place.favorite) Text("♥", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.semantics { contentDescription = favoriteMark })
            Text(place.name, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
            place.rating?.let { Text("★".repeat(it) + "☆".repeat(5 - it), color = MaterialTheme.colorScheme.tertiary, style = MaterialTheme.typography.bodyLarge) }
        }
        val where = listOfNotNull(place.city, place.country?.let { countryName(it) }).joinToString(", ")
        if (where.isNotEmpty()) Text(where, style = MaterialTheme.typography.bodyMedium, color = muted)
        // A place on many trips wraps its links onto more lines rather than running off the screen.
        FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            for (trip in place.trips) {
                Text(titles[trip.id] ?: trip.title, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.primary, modifier = Modifier.clickable { onOpenTrip(trip.id) }.padding(vertical = 2.dp))
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
    val filled = TravelmoTheme.colors.visited
    val empty = TravelmoTheme.colors.land
    val border = MaterialTheme.colorScheme.surface
    val airport = MaterialTheme.colorScheme.tertiary
    val place = MaterialTheme.colorScheme.error
    val description = if (visited.isEmpty()) stringResource(Res.string.map_empty) else stringResource(Res.string.map_description, visited.map { countryName(it) }.sorted().joinToString(", "))
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

/**
 * A summary of every trip to save as CSV, for visa and residence forms, as
 * on the web: one row per trip or per place, optionally only what was
 * abroad. The phone's file picker says where the file goes.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DownloadTrips(trips: List<TripWithSegments>, periods: List<HomePeriod>, titles: Map<String, String>, today: String) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var byPlace by rememberSaveable { mutableStateOf(false) }
    var international by rememberSaveable { mutableStateOf(false) }
    // The last start date to include: today unless the user picks another.
    var until by rememberSaveable { mutableStateOf(today) }
    var picking by rememberSaveable { mutableStateOf(false) }
    var said by remember { mutableStateOf<StringResource?>(null) }
    val save = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/csv")) { uri ->
        if (uri == null) return@rememberLauncherForActivityResult
        val text = if (byPlace) placeRowsCsv(placeRows(trips, periods, until, international, titles)) else tripRowsCsv(tripRows(trips, periods, until, international, titles))
        scope.launch {
            said = try {
                withContext(Dispatchers.IO) {
                    context.contentResolver.openOutputStream(uri)?.use { it.write(text.toByteArray()) } ?: throw IOException("No stream to write to")
                }
                TravelmoLog.info("Saved the trips summary")
                Res.string.trips_saved
            } catch (e: IOException) {
                TravelmoLog.failure(e, "Saving the trips summary failed")
                Res.string.trips_save_failed
            }
        }
    }
    SectionTitle(stringResource(Res.string.download_trips))
    Text(stringResource(Res.string.download_trips_hint), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Column(modifier = Modifier.selectableGroup().padding(top = 4.dp)) {
        for ((place, label) in listOf(false to Res.string.row_per_trip, true to Res.string.row_per_place)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                modifier = Modifier.fillMaxWidth().selectable(selected = byPlace == place, role = Role.RadioButton) { byPlace = place },
            ) {
                RadioButton(selected = byPlace == place, onClick = null)
                Text(stringResource(label), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(start = 12.dp, top = 10.dp, bottom = 10.dp))
            }
        }
    }
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().toggleable(value = international, role = Role.Checkbox) { international = it },
    ) {
        Checkbox(checked = international, onCheckedChange = null)
        Text(stringResource(Res.string.abroad_only), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(start = 12.dp, top = 10.dp, bottom = 10.dp))
    }
    OutlinedButton(onClick = { picking = true }, modifier = Modifier.padding(top = 4.dp)) {
        Text(stringResource(Res.string.trips_up_to, formatDateWithYear(until)))
    }
    if (picking) {
        val state = rememberDatePickerState(initialSelectedDateMillis = LocalDate.parse(until).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
        DatePickerDialog(
            onDismissRequest = { picking = false },
            confirmButton = {
                TextButton(onClick = {
                    // The picker answers in UTC midnights.
                    state.selectedDateMillis?.let { until = java.time.Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate().toString() }
                    picking = false
                }) { Text(stringResource(Res.string.ok)) }
            },
            dismissButton = { TextButton(onClick = { picking = false }) { Text(stringResource(Res.string.cancel)) } },
        ) { DatePicker(state = state) }
    }
    OutlinedButton(onClick = { said = null; save.launch(if (byPlace) "travelmo-places.csv" else "travelmo-trips.csv") }, modifier = Modifier.padding(top = 4.dp)) {
        Text(stringResource(Res.string.download_csv))
    }
    said?.let { Text(stringResource(it), style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(top = 4.dp)) }
}
