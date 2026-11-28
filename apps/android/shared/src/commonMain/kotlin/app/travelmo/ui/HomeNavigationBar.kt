package app.travelmo.ui

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.AccountBox
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.Place
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import app.travelmo.shared.Res
import app.travelmo.shared.nav_calendar
import app.travelmo.shared.nav_reports
import app.travelmo.shared.nav_trips
import app.travelmo.shared.nav_wallet
import app.travelmo.shared.settings
import app.travelmo.ui.theme.TravelmoTheme
import org.jetbrains.compose.resources.stringResource

/**
 * Settings, as a gear in the top bar of every tab, before the menu. Pages
 * opened over the tabs have a back arrow instead.
 */
@Composable
fun SettingsButton(onClick: () -> Unit) {
    IconButton(onClick = onClick) {
        Icon(Icons.Filled.Settings, contentDescription = stringResource(Res.string.settings))
    }
}

/** The destinations the navigation bar switches between, as the web's navigation has them. */
enum class HomeTab { TRIPS, CALENDAR, REPORTS, WALLET }

@Composable
fun HomeNavigationBar(selected: HomeTab, onSelect: (HomeTab) -> Unit) {
    val colors = NavigationBarItemDefaults.colors(
        indicatorColor = TravelmoTheme.colors.navIndicator,
        selectedIconColor = TravelmoTheme.colors.onNavIndicator,
        selectedTextColor = MaterialTheme.colorScheme.onSurface,
    )
    NavigationBar(containerColor = MaterialTheme.colorScheme.surfaceContainer) {
        NavigationBarItem(
            selected = selected == HomeTab.TRIPS,
            onClick = { onSelect(HomeTab.TRIPS) },
            icon = { Icon(Icons.AutoMirrored.Filled.List, contentDescription = null) },
            label = { Text(stringResource(Res.string.nav_trips)) },
            colors = colors,
        )
        NavigationBarItem(
            selected = selected == HomeTab.CALENDAR,
            onClick = { onSelect(HomeTab.CALENDAR) },
            icon = { Icon(Icons.Filled.DateRange, contentDescription = null) },
            label = { Text(stringResource(Res.string.nav_calendar)) },
            colors = colors,
        )
        NavigationBarItem(
            selected = selected == HomeTab.REPORTS,
            onClick = { onSelect(HomeTab.REPORTS) },
            icon = { Icon(Icons.Filled.Place, contentDescription = null) },
            label = { Text(stringResource(Res.string.nav_reports)) },
            colors = colors,
        )
        NavigationBarItem(
            selected = selected == HomeTab.WALLET,
            onClick = { onSelect(HomeTab.WALLET) },
            icon = { Icon(Icons.Filled.AccountBox, contentDescription = null) },
            label = { Text(stringResource(Res.string.nav_wallet)) },
            colors = colors,
        )
    }
}
