package app.travelmo.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.Checkbox
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
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import kotlinx.coroutines.flow.flowOf
import androidx.compose.ui.semantics.stateDescription
import app.travelmo.shared.reports_working
import app.travelmo.shared.no_days_to_count
import app.travelmo.shared.residence_title
import app.travelmo.shared.section_closed
import app.travelmo.shared.section_open
import androidx.compose.runtime.remember
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.travelmo.core.AirportVisit
import app.travelmo.core.CountryCounting
import app.travelmo.core.CountryDaysReport
import app.travelmo.core.DateShift
import app.travelmo.core.FavoritePlace
import app.travelmo.core.HomePeriod
import app.travelmo.core.PlaceVisit
import app.travelmo.core.TravelReport
import app.travelmo.core.TripWithBookings
import app.travelmo.core.TripWithSegments
import app.travelmo.core.WorldMapData
import app.travelmo.core.countryDays
import app.travelmo.core.countryDaysRange
import app.travelmo.core.countryName
import app.travelmo.core.displayTitles
import app.travelmo.core.favoritePlaces
import app.travelmo.core.formatDateRange
import app.travelmo.core.formatDateWithYear
import app.travelmo.core.placeRows
import app.travelmo.core.shiftDate
import app.travelmo.core.placeRowsCsv
import app.travelmo.core.travelReport
import app.travelmo.core.tripRows
import app.travelmo.core.tripRowsCsv
import app.travelmo.core.worldMap
import app.travelmo.shared.Res
import app.travelmo.shared.abroad_only
import app.travelmo.shared.all_years
import app.travelmo.shared.col_countries
import app.travelmo.shared.col_country
import app.travelmo.shared.col_days
import app.travelmo.shared.col_nights
import app.travelmo.shared.counting
import app.travelmo.shared.counting_nights
import app.travelmo.shared.counting_part
import app.travelmo.shared.counting_whole
import app.travelmo.shared.nights_count
import app.travelmo.shared.col_trips
import app.travelmo.shared.col_year
import app.travelmo.shared.countries_count
import app.travelmo.shared.days_away
import app.travelmo.shared.days_in_each_country
import app.travelmo.shared.home_stay
import app.travelmo.shared.residence_days
import app.travelmo.shared.residence_no_home_country
import app.travelmo.shared.download_csv
import app.travelmo.shared.download_trips
import app.travelmo.shared.download_trips_hint
import app.travelmo.shared.favorite_mark
import app.travelmo.shared.favorite_places
import app.travelmo.shared.map_description
import app.travelmo.shared.map_empty
import app.travelmo.shared.no_trips_yet
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
import app.travelmo.shared.uncounted_days
import app.travelmo.shared.year
import app.travelmo.ui.theme.TravelmoTheme
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
fun ReportsScreen(viewModel: TripsViewModel, onOpenTrip: (String) -> Unit, onOpenSettings: () -> Unit, bottomBar: @Composable () -> Unit) {
    LaunchedEffect(viewModel) { viewModel.refreshUnconfirmedSegments() }
    val all by viewModel.reportTrips.collectAsStateWithLifecycle()
    // The user's home corrections, for the trips download, which works home out when it is saved: offered only once
    // they have answered, so "outside my home country" never takes a home not yet read for none.
    val homeSettings by viewModel.rideSettings.collectAsStateWithLifecycle()
    var year by rememberSaveable { mutableStateOf<String?>(null) }
    val today = viewModel.today()
    val input = all
    // The counts and the map come at once, worked out in the background (TripsViewModel.computed).
    val whole by produceState<TravelReport?>(null, input, today) { value = input?.let { viewModel.computed { travelReport(it, today) } } }
    val report by produceState<TravelReport?>(null, input, today, year, whole) {
        value = if (year == null) whole else input?.let { trips -> viewModel.computed { travelReport(trips, today, year) } }
    }
    // Until they come, every year's counts and map as last worked out here, drawn at once; saved again once fresh.
    val snapshot by viewModel.reportSnapshot.collectAsStateWithLifecycle()
    LaunchedEffect(whole) { whole?.let(viewModel::saveReportSnapshot) }
    val tripList by viewModel.trips.collectAsStateWithLifecycle()
    val titles by produceState<Map<String, String>>(emptyMap(), input, tripList) {
        val list = input?.map { it.trip } ?: tripList.orEmpty()
        value = viewModel.computed { displayTitles(list) }
    }
    val mapData by produceState<WorldMapData?>(null) { value = viewModel.computed { worldMap } }
    // Days in each country and residence days take a while (home over time, then every day of every year), so each
    // is worked out only once opened, and home only for them.
    var countriesOpen by rememberSaveable { mutableStateOf(false) }
    var openCountry by rememberSaveable { mutableStateOf<String?>(null) }
    var residenceOpen by rememberSaveable { mutableStateOf(false) }
    val homesFlow = remember(countriesOpen || residenceOpen) { if (countriesOpen || residenceOpen) viewModel.reportHomes else flowOf(null) }
    val homes by homesFlow.collectAsStateWithLifecycle(null)
    // Where the user was each day, home included, by the year picked.
    val counting by viewModel.reportCounting.collectAsStateWithLifecycle()
    // Whether they have been worked out, and what came of it: none when no trip has begun.
    val countries by produceState<Pair<Boolean, CountryDaysReport?>>(false to null, input, homes, today, year, counting, countriesOpen) {
        val periods = homes
        value = if (!countriesOpen || input == null || periods == null) false to null
        else true to viewModel.computed { countryDaysRange(input, today, year)?.let { countryDays(input, periods, it, counting = counting) } }
    }
    val favorites by produceState<List<FavoritePlace>>(emptyList(), input) {
        value = input?.let { trips -> viewModel.computed { favoritePlaces(trips.map { TripWithBookings(it.trip, it.segments) }) } }.orEmpty()
    }
    Scaffold(topBar = { AppTopBar(stringResource(Res.string.reports_title), onOpenSettings = onOpenSettings) }, bottomBar = bottomBar) { padding ->
        val whole = whole ?: snapshot
        val report = report ?: snapshot?.takeIf { year == null }
        if (whole == null || report == null) {
            Text(stringResource(Res.string.reports_loading), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(padding).padding(16.dp))
            return@Scaffold
        }
        val visited = remember(report) { report.countries.map { it.country }.toSet() }
        val list = rememberLazyListState()
        LazyColumn(modifier = Modifier.fillMaxSize().padding(padding).scrollEdgeCue(list, scrollCueColors()), state = list, contentPadding = PaddingValues(horizontal = 16.dp, vertical = 8.dp)) {
            // Another year is worked out from the bookings, so it can be picked only once they are read: until then the
            // saved counts stand, and picking one would leave nothing to show.
            item(key = "year") { YearPicker(whole.years.map { it.year }, year, enabled = input != null) { year = it } }
            item(key = "summary") { Summary(report) }
            val loadedMap = mapData
            if (loadedMap != null) {
                item(key = "map") {
                    WorldMap(loadedMap, visited = visited, airports = report.airports, places = report.places, modifier = Modifier.padding(top = 16.dp))
                }
            }
            item(key = "countries-title") { OnDemandTitle(stringResource(Res.string.days_in_each_country), countriesOpen) { countriesOpen = !countriesOpen } }
            if (countriesOpen) {
                val (done, days) = countries
                when {
                    !done -> item(key = "countries") { Working() }
                    days == null -> item(key = "countries") { Working(stringResource(Res.string.no_days_to_count)) }
                    else -> countryDaysItems(days, counting, viewModel::setReportCounting, today, titles, openCountry, { openCountry = it }, onOpenTrip)
                }
            }
            if (favorites.isNotEmpty()) {
                item(key = "favorites") { SectionTitle(stringResource(Res.string.favorite_places)) }
                for (place in favorites) {
                    item(key = "favorite-${place.name}|${place.country ?: ""}") { Favorite(place, titles, onOpenTrip) }
                }
            }
            item(key = "residence-title") { OnDemandTitle(stringResource(Res.string.residence_title), residenceOpen) { residenceOpen = !residenceOpen } }
            if (residenceOpen) {
                val periods = homes
                if (periods == null) item(key = "residence") { Working() }
                else item(key = "residence") { ResidenceDays(input.orEmpty(), periods, today, titles, onOpenTrip, showTitle = false, compute = { viewModel.computed(it) }) }
            }
            if (whole.years.isNotEmpty()) {
                item(key = "years") {
                    SectionTitle(stringResource(Res.string.trips_per_year))
                    Table(
                        header = listOf(stringResource(Res.string.col_year) to 1f, stringResource(Res.string.col_trips) to 0.7f, stringResource(Res.string.col_days) to 0.7f, stringResource(Res.string.col_countries) to 1f),
                        rows = whole.years.map { listOf(it.year, it.trips.toString(), it.days.toString(), it.countries.toString()) },
                        onRow = if (input != null) { row -> year = whole.years[row].year } else null,
                    )
                }
            }
            // Not from the saved counts: a download is every trip's bookings, so it waits for them.
            if (homeSettings != null && input != null) item(key = "download") { DownloadTrips(input.orEmpty(), viewModel::reportHomesNow, titles, today) }
            if (whole.upcoming > 0) {
                item(key = "upcoming") {
                    Text(pluralStringResource(Res.plurals.trips_ahead, whole.upcoming, whole.upcoming), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 24.dp))
                }
            }
            if (whole.trips == 0 && whole.upcoming == 0) {
                item(key = "none") { Text(stringResource(Res.string.no_trips_yet), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 24.dp)) }
            }
        }
    }
}

/** How days in each country count: any part of a day, whole days, or nights. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun CountingPicker(counting: CountryCounting, onPick: (CountryCounting) -> Unit) {
    val labels = mapOf(
        CountryCounting.PART to stringResource(Res.string.counting_part),
        CountryCounting.WHOLE to stringResource(Res.string.counting_whole),
        CountryCounting.NIGHTS to stringResource(Res.string.counting_nights),
    )
    var open by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = open, onExpandedChange = { open = it }, modifier = Modifier.padding(bottom = 8.dp)) {
        OutlinedTextField(
            value = labels.getValue(counting),
            onValueChange = {},
            readOnly = true,
            label = { Text(stringResource(Res.string.counting)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = open) },
            modifier = Modifier.menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(expanded = open, onDismissRequest = { open = false }, modifier = Modifier.pinchFontSizeHost()) {
            for ((value, label) in labels) DropdownMenuItem(text = { Text(label) }, onClick = { onPick(value); open = false })
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun YearPicker(years: List<String>, year: String?, enabled: Boolean, onPick: (String?) -> Unit) {
    var open by remember { mutableStateOf(false) }
    ExposedDropdownMenuBox(expanded = open && enabled, onExpandedChange = { open = it && enabled }) {
        OutlinedTextField(
            value = year ?: stringResource(Res.string.all_years),
            onValueChange = {},
            readOnly = true,
            enabled = enabled,
            label = { Text(stringResource(Res.string.year)) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded = open) },
            modifier = Modifier.menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
        )
        ExposedDropdownMenu(expanded = open && enabled, onDismissRequest = { open = false }, modifier = Modifier.pinchFontSizeHost()) {
            DropdownMenuItem(text = { Text(stringResource(Res.string.all_years)) }, onClick = { onPick(null); open = false })
            for (y in years) DropdownMenuItem(text = { Text(y) }, onClick = { onPick(y); open = false })
        }
    }
}

/**
 * Days in each country, home included, split into stays at each border crossing; each country
 * opens to its stays, latest first, so a surprising one can be found and fixed. Days nothing places
 * come first, to be given a place, and count nowhere until they are. Emitted as individual lazy
 * items so opening a country with many stays composes only the rows on screen.
 */
private fun LazyListScope.countryDaysItems(
    report: CountryDaysReport,
    counting: CountryCounting,
    onCounting: (CountryCounting) -> Unit,
    today: String,
    titles: Map<String, String>,
    open: String?,
    onOpen: (String?) -> Unit,
    onOpenTrip: (String) -> Unit,
) {
    // Kept up while another count is picked, even with no days to show, so it can be changed back.
    if (report.countries.isEmpty() && report.unplaced.isEmpty() && report.homeCountryKnown && counting == CountryCounting.PART) return
    val nights = counting == CountryCounting.NIGHTS
    item(key = "countries-picker") { CountingPicker(counting, onCounting) }
    if (!report.homeCountryKnown) {
        item(key = "countries-no-home") {
            Text(stringResource(Res.string.residence_no_home_country), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    if (report.unplaced.isNotEmpty()) {
        val total = report.unplaced.sumOf { it.days }
        item(key = "countries-unplaced-header") {
            Text(pluralStringResource(Res.plurals.uncounted_days, total, total), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        itemsIndexed(report.unplaced, key = { i, s -> "unplaced-${s.start}-${s.end}-$i" }) { _, s ->
            StayLine(formatDateRange(s.start, s.end), pluralStringResource(Res.plurals.residence_days, s.days, s.days), null, s.tripIds, titles, onOpenTrip)
        }
    }
    item(key = "countries-header") {
        Row(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
            Text(stringResource(Res.string.col_country), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Start, modifier = Modifier.weight(2f))
            Text(stringResource(if (nights) Res.string.col_nights else Res.string.col_days), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.End, modifier = Modifier.weight(0.7f))
        }
    }
    for (entry in report.countries) {
        item(key = "country-${entry.country}") {
            Column(modifier = Modifier.fillMaxWidth()) {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Row(
                    modifier = Modifier.fillMaxWidth()
                        .clickable { onOpen(if (open == entry.country) null else entry.country) }
                        .padding(vertical = 6.dp),
                ) {
                    Text(countryName(entry.country), style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Start, modifier = Modifier.weight(2f))
                    Text(entry.days.toString(), style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.End, modifier = Modifier.weight(0.7f))
                }
            }
        }
        if (open == entry.country) {
            itemsIndexed(entry.stays, key = { i, s -> "stay-${entry.country}-${s.start}-${s.end}-$i" }) { i, s ->
                val bottom = if (i == entry.stays.lastIndex) 8.dp else 0.dp
                Box(modifier = Modifier.fillMaxWidth().padding(start = 16.dp, bottom = bottom)) {
                    // A run of nights reads as a hotel booking does, to the morning after the last (if it has come).
                    val dates = formatDateRange(s.start, if (nights && s.end < today) shiftDate(s.end, DateShift(days = 1)) else s.end)
                    val count = if (nights) pluralStringResource(Res.plurals.nights_count, s.days, s.days) else pluralStringResource(Res.plurals.residence_days, s.days, s.days)
                    StayLine(dates, count, if (s.home) stringResource(Res.string.home_stay) else null, s.tripIds, titles, onOpenTrip)
                }
            }
        }
    }
}

/** "24–30 Nov 2026 · 7 days · Boston": a run of days, each trip's title opening that trip. */
@Composable
private fun StayLine(dates: String, count: String, label: String?, tripIds: List<String>, titles: Map<String, String>, onOpenTrip: (String) -> Unit) {
    val text = listOfNotNull(dates, count, label).joinToString(" · ")
    FlowRow(modifier = Modifier.padding(vertical = 4.dp)) {
        Text(text, style = MaterialTheme.typography.bodyLarge)
        for (id in tripIds) {
            Text(" · ", style = MaterialTheme.typography.bodyLarge)
            Text(titles[id] ?: id, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.primary, modifier = Modifier.clickable { onOpenTrip(id) })
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

/** A section's title that opens it, [open] or not, for a section worked out only when opened. */
@Composable
private fun OnDemandTitle(text: String, open: Boolean, onToggle: () -> Unit) {
    val state = stringResource(if (open) Res.string.section_open else Res.string.section_closed)
    Text(
        (if (open) "▾ " else "▸ ") + text,
        style = MaterialTheme.typography.titleMedium,
        modifier = Modifier.fillMaxWidth().clickable(role = Role.Button, onClick = onToggle).padding(top = 24.dp, bottom = 4.dp)
            .semantics { stateDescription = state },
    )
}

/** Said under an opened section while it is worked out, or [text] once it is, when it has nothing to show. */
@Composable
private fun Working(text: String = stringResource(Res.string.reports_working)) {
    Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp))
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 24.dp, bottom = 4.dp))
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
                Text(column.first, style = MaterialTheme.typography.bodyLarge, color = muted, textAlign = if (i == 0) TextAlign.Start else TextAlign.End, modifier = Modifier.weight(column.second))
            }
        }
        for ((r, row) in rows.withIndex()) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            val rowModifier = if (onRow != null) Modifier.clickable { onRow(r) } else Modifier
            Row(modifier = rowModifier.padding(vertical = 6.dp)) {
                for ((i, cell) in row.withIndex()) {
                    Text(cell, style = MaterialTheme.typography.bodyLarge, textAlign = if (i == 0) TextAlign.Start else TextAlign.End, modifier = Modifier.weight(header[i].second))
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
        if (where.isNotEmpty()) Text(where, style = MaterialTheme.typography.bodyLarge, color = muted)
        // A place on many trips wraps its links onto more lines rather than running off the screen.
        FlowRow(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            for (trip in place.trips) {
                Text(titles[trip.id] ?: trip.title, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.primary, modifier = Modifier.clickable { onOpenTrip(trip.id) }.padding(vertical = 2.dp))
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
                    if (ring.isEmpty()) continue
                    moveTo(ring[0].first, ring[0].second)
                    for (i in 1 until ring.size) {
                        val p = ring[i]
                        lineTo(p.first, p.second)
                    }
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
@Composable
private fun DownloadTrips(trips: List<TripWithSegments>, homes: () -> List<HomePeriod>, titles: Map<String, String>, today: String) {
    var byPlace by rememberSaveable { mutableStateOf(false) }
    var international by rememberSaveable { mutableStateOf(false) }
    // The last start date to include: today unless the user picks another.
    var until by rememberSaveable { mutableStateOf(today) }
    var said by remember { mutableStateOf<StringResource?>(null) }
    val save = LocalAppChrome.current.rememberTextSaver(
        "text/csv",
        // Home is worked out only now, when the file is saved.
        text = { homes().let { periods -> if (byPlace) placeRowsCsv(placeRows(trips, periods, until, international, titles)) else tripRowsCsv(tripRows(trips, periods, until, international, titles)) } },
    ) { saved -> said = if (saved) Res.string.trips_saved else Res.string.trips_save_failed }
    SectionTitle(stringResource(Res.string.download_trips))
    Text(stringResource(Res.string.download_trips_hint), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
    DateButton(stringResource(Res.string.trips_up_to, formatDateWithYear(until)), until, { until = it }, Modifier.padding(top = 4.dp))
    OutlinedButton(onClick = { said = null; save(if (byPlace) "travelmo-places.csv" else "travelmo-trips.csv") }, modifier = Modifier.padding(top = 4.dp)) {
        Text(stringResource(Res.string.download_csv))
    }
    said?.let { Text(stringResource(it), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(top = 4.dp)) }
}
