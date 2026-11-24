package app.travelmo.ui

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.input.ImeAction
import app.travelmo.core.ListFilters
import app.travelmo.shared.Res
import app.travelmo.shared.add_trip
import app.travelmo.shared.app_name
import app.travelmo.shared.close_search
import app.travelmo.shared.clear_search
import app.travelmo.shared.filters
import app.travelmo.shared.hide_cancelled
import app.travelmo.shared.hide_local_events
import app.travelmo.shared.ic_filter_off
import app.travelmo.shared.ic_filter_on
import app.travelmo.shared.search_trips
import org.jetbrains.compose.resources.painterResource
import org.jetbrains.compose.resources.stringResource

/**
 * The trip list's top bar (SPEC "Searching trips"): the wordmark with Search
 * and the filters beside Settings and the menu; while [searching], the search
 * field in the wordmark's place, with Back to leave it and clear the search.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TripListTopBar(
    searching: Boolean,
    onSearching: (Boolean) -> Unit,
    query: String,
    onQuery: (String) -> Unit,
    filters: ListFilters,
    onFilters: (ListFilters) -> Unit,
    onOpenSettings: () -> Unit,
    onAddTrip: () -> Unit,
) {
    val focus = LocalFocusManager.current
    if (searching) {
        val field = remember { FocusRequester() }
        // Whether the field has had the focus: an empty search closes once it loses it, not before it first gets it.
        var focused by remember { mutableStateOf(false) }
        // Focused as it opens, so the keyboard comes up with it.
        LaunchedEffect(Unit) { field.requestFocus() }
        TopAppBar(
            navigationIcon = {
                IconButton(onClick = { onQuery(""); onSearching(false) }) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(Res.string.close_search))
                }
            },
            title = {
                TextField(
                    value = query,
                    onValueChange = onQuery,
                    placeholder = { Text(stringResource(Res.string.search_trips)) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { focus.clearFocus() }),
                    colors = TextFieldDefaults.colors(
                        focusedContainerColor = Color.Transparent,
                        unfocusedContainerColor = Color.Transparent,
                        focusedIndicatorColor = Color.Transparent,
                        unfocusedIndicatorColor = Color.Transparent,
                    ),
                    modifier = Modifier.fillMaxWidth().focusRequester(field).onFocusChanged { state ->
                        if (focused && !state.isFocused && query.isBlank()) onSearching(false)
                        focused = state.isFocused
                    },
                )
            },
            actions = {
                if (query.isNotEmpty()) {
                    IconButton(onClick = { onQuery("") }) {
                        Icon(Icons.Filled.Close, contentDescription = stringResource(Res.string.clear_search))
                    }
                }
                FilterButton(filters, onFilters)
            },
        )
    } else {
        AppTopBar(
            stringResource(Res.string.app_name),
            onOpenSettings = onOpenSettings,
            menuItems = { close -> DropdownMenuItem(text = { Text(stringResource(Res.string.add_trip)) }, onClick = { close(); onAddTrip() }) },
        ) {
            IconButton(onClick = { onSearching(true) }) {
                Icon(Icons.Filled.Search, contentDescription = stringResource(Res.string.search_trips))
            }
            FilterButton(filters, onFilters)
        }
    }
}

/** The funnel, filled while a filter is on, opening the two switches (SPEC "Filtering the trip list"). */
@Composable
private fun FilterButton(filters: ListFilters, onFilters: (ListFilters) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        IconButton(onClick = { open = true }) {
            Icon(painterResource(if (filters.any) Res.drawable.ic_filter_on else Res.drawable.ic_filter_off), contentDescription = stringResource(Res.string.filters))
        }
        // Stays open while the switches are flipped; a tap elsewhere closes it.
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            FilterItem(stringResource(Res.string.hide_cancelled), filters.hideCancelled) { onFilters(filters.copy(hideCancelled = it)) }
            FilterItem(stringResource(Res.string.hide_local_events), filters.hideLocal) { onFilters(filters.copy(hideLocal = it)) }
        }
    }
}

@Composable
private fun FilterItem(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    DropdownMenuItem(
        text = { Text(label) },
        leadingIcon = { Checkbox(checked = checked, onCheckedChange = null) },
        onClick = { onChange(!checked) },
    )
}
