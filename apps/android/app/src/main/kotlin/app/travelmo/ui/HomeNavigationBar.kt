package app.travelmo.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import app.travelmo.R

/** The destinations the navigation bar switches between; Reports and Profile join as they come over from the web. */
enum class HomeTab { TRIPS, CALENDAR }

@Composable
fun HomeNavigationBar(selected: HomeTab, onSelect: (HomeTab) -> Unit) {
    // The selected pill is the amber tertiary container, as in the mockups.
    val colors = NavigationBarItemDefaults.colors(
        indicatorColor = MaterialTheme.colorScheme.tertiaryContainer,
        selectedIconColor = MaterialTheme.colorScheme.onTertiaryContainer,
        selectedTextColor = MaterialTheme.colorScheme.onSurface,
    )
    NavigationBar(containerColor = MaterialTheme.colorScheme.surfaceContainer) {
        NavigationBarItem(
            selected = selected == HomeTab.TRIPS,
            onClick = { onSelect(HomeTab.TRIPS) },
            icon = { Icon(Icons.AutoMirrored.Filled.List, contentDescription = null) },
            label = { Text(stringResource(R.string.nav_trips)) },
            colors = colors,
        )
        NavigationBarItem(
            selected = selected == HomeTab.CALENDAR,
            onClick = { onSelect(HomeTab.CALENDAR) },
            icon = { Icon(Icons.Filled.DateRange, contentDescription = null) },
            label = { Text(stringResource(R.string.nav_calendar)) },
            colors = colors,
        )
    }
}
