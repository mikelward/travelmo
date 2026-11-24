package app.travelmo.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.navigation3.runtime.NavBackStack
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.ui.NavDisplay
import app.travelmo.auth.SignedIn
import kotlinx.serialization.Serializable

// The pages, as Navigation 3 keys: the back stack is a list the app owns.
// Home holds the navigation bar's destinations (Trips, Calendar) as a tab;
// a trip and Settings are pushed above it.
@Serializable
data object Home : NavKey

@Serializable
data class TripDetail(val tripId: String) : NavKey

@Serializable
data object Settings : NavKey

@Serializable
data object ImportReview : NavKey

@Serializable
data object AccessPage : NavKey

@Serializable
data class BookingForm(val tripId: String, val segmentId: String?, val defaultDate: String) : NavKey


/**
 * Opens the Access page (SPEC "Access"), for an admin only: the signed-in
 * app provides it while the account is one, and the menu then starts with
 * Access, as the web's header shows it to admins alone. Null for everyone
 * else, and on the Access page itself.
 */
val LocalOpenAccess = compositionLocalOf<(() -> Unit)?> { null }

@Composable
fun SignedInNavigation(user: SignedIn, viewModel: TripsViewModel, backStack: NavBackStack<NavKey>, account: SignedInAccount) {
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    NavDisplay(
        backStack = backStack,
        onBack = { backStack.removeLastOrNull() },
        transitionSpec = { pageOpens(rtl) },
        popTransitionSpec = { pageCloses(rtl) },
        predictivePopTransitionSpec = { pageCloses(rtl) },
        entryProvider = entryProvider {
            entry<Home> {
                var tab by rememberSaveable { mutableStateOf(HomeTab.TRIPS) }
                // The calendar's month lives with the tab, not the screen: a
                // visit to Trips and back lands on the month left, not on today.
                var month by rememberSaveable { mutableStateOf<String?>(null) }
                val bar: @Composable () -> Unit = { HomeNavigationBar(selected = tab, onSelect = { tab = it }) }
                when (tab) {
                    HomeTab.TRIPS -> TripListScreen(
                        viewModel = viewModel,
                        uid = user.uid,
                        onOpenTrip = { backStack.add(TripDetail(it)) },
                        onOpenSettings = { backStack.add(Settings) },
                        bottomBar = bar,
                    )
                    HomeTab.PROFILE -> ProfileScreen(viewModel = viewModel, bottomBar = bar)
                    HomeTab.REPORTS -> ReportsScreen(viewModel = viewModel, onOpenTrip = { backStack.add(TripDetail(it)) }, bottomBar = bar)
                    HomeTab.CALENDAR -> CalendarScreen(
                        viewModel = viewModel,
                        uid = user.uid,
                        month = month,
                        onMonthChange = { month = it },
                        onOpenTrip = { backStack.add(TripDetail(it)) },
                        bottomBar = bar,
                    )
                }
            }
            entry<TripDetail> { key ->
                TripDetailScreen(
                    viewModel = viewModel,
                    tripId = key.tripId,
                    uid = user.uid,
                    onBack = { backStack.removeLastOrNull() },
                    onAddBooking = { defaultDate -> backStack.add(BookingForm(key.tripId, null, defaultDate)) },
                    onEditBooking = { segmentId -> backStack.add(BookingForm(key.tripId, segmentId, "")) },
                    // A merge lands on the trip the bookings went to, in place of the one that is gone.
                    onMerged = { targetId ->
                        backStack.removeLastOrNull()
                        backStack.add(TripDetail(targetId))
                    },
                )
            }
            entry<BookingForm> { key ->
                BookingFormScreen(viewModel = viewModel, tripId = key.tripId, segmentId = key.segmentId, defaultDate = key.defaultDate, onDone = { backStack.removeLastOrNull() })
            }
            entry<Settings> {
                SettingsScreen(account = account, user = user, viewModel = viewModel, onBack = { backStack.removeLastOrNull() }, onOpenReview = { backStack.add(ImportReview) })
            }
            entry<ImportReview> {
                ImportReviewScreen(viewModel = viewModel, onBack = { backStack.removeLastOrNull() })
            }
            entry<AccessPage> {
                // Not offered again from its own menu.
                CompositionLocalProvider(LocalOpenAccess provides null) {
                    AccessScreen(viewModel = viewModel, onBack = { backStack.removeLastOrNull() })
                }
            }
        },
    )
}
