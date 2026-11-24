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
import app.travelmo.core.TripWithSegments
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.serialization.Serializable

// The pages, as Navigation 3 keys: the back stack is a list the app owns.
// Home holds the navigation bar's destinations (Trips, Calendar, Reports,
// Profile) as tabs;
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

/** A booking added with no trip in view, which goes into the trip it falls in, or a new one. */
@Serializable
data class NewBooking(val defaultDate: String) : NavKey


/**
 * Opens the Access page (SPEC "Access"), for an admin only: the signed-in
 * app provides it while the account is one, and the menu then starts with
 * Access, as the web's header shows it to admins alone. Null for everyone
 * else, and on the Access page itself.
 */
val LocalOpenAccess = compositionLocalOf<(() -> Unit)?> { null }

/**
 * The screen a report is sent from (SPEC "Bug reports"): its name, and on a
 * trip's screens the trip with its bookings, which always go with the
 * report. Navigation provides one per page; elsewhere it is unknown.
 */
class ReportScreen(val page: String, val trip: (suspend () -> TripWithSegments?)? = null)

val LocalReportScreen = compositionLocalOf { ReportScreen("Unknown") }

/** A trip's screen for a report sent from it, which always carries the trip and every booking on it. */
private fun tripReportScreen(page: String, viewModel: TripsViewModel, tripId: String) = ReportScreen(page) {
    viewModel.trips.filterNotNull().first().firstOrNull { it.id == tripId }?.let { trip -> TripWithSegments(trip, viewModel.segments(tripId).first()) }
}

/** A Home tab's name in a report. */
private val HomeTab.reportPage: String
    get() = when (this) {
        HomeTab.TRIPS -> "Trips"
        HomeTab.CALENDAR -> "Calendar"
        HomeTab.REPORTS -> "Reports"
        HomeTab.PROFILE -> "Profile"
    }

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
                // Every tab's top bar has the Settings gear.
                val openSettings: () -> Unit = { backStack.add(Settings) }
                val bar: @Composable () -> Unit = { HomeNavigationBar(selected = tab, onSelect = { tab = it }) }
                CompositionLocalProvider(LocalReportScreen provides ReportScreen(tab.reportPage)) {
                when (tab) {
                    HomeTab.TRIPS -> TripListScreen(
                        viewModel = viewModel,
                        uid = user.uid,
                        onOpenTrip = { backStack.add(TripDetail(it)) },
                        onOpenSettings = openSettings,
                        bottomBar = bar,
                    )
                    HomeTab.PROFILE -> ProfileScreen(viewModel = viewModel, onOpenSettings = openSettings, bottomBar = bar)
                    HomeTab.REPORTS -> ReportsScreen(viewModel = viewModel, onOpenTrip = { backStack.add(TripDetail(it)) }, onOpenSettings = openSettings, bottomBar = bar)
                    HomeTab.CALENDAR -> CalendarScreen(
                        viewModel = viewModel,
                        uid = user.uid,
                        month = month,
                        onMonthChange = { month = it },
                        onOpenTrip = { backStack.add(TripDetail(it)) },
                        onOpenSettings = openSettings,
                        bottomBar = bar,
                    )
                }
                }
            }
            entry<TripDetail> { key ->
                CompositionLocalProvider(LocalReportScreen provides tripReportScreen("Trip", viewModel, key.tripId)) {
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
            }
            entry<BookingForm> { key ->
                CompositionLocalProvider(LocalReportScreen provides tripReportScreen("Booking form", viewModel, key.tripId)) {
                    BookingFormScreen(viewModel = viewModel, tripId = key.tripId, segmentId = key.segmentId, defaultDate = key.defaultDate, onDone = { backStack.removeLastOrNull() })
                }
            }
            entry<NewBooking> { key ->
                CompositionLocalProvider(LocalReportScreen provides ReportScreen("Booking form")) {
                    BookingFormScreen(
                        viewModel = viewModel,
                        tripId = null,
                        segmentId = null,
                        defaultDate = key.defaultDate,
                        onDone = { backStack.removeLastOrNull() },
                        // On to the trip it went into, Back returning to where it was added from.
                        onAdded = { tripId ->
                            backStack.removeLastOrNull()
                            backStack.add(TripDetail(tripId))
                        },
                    )
                }
            }
            entry<Settings> {
                CompositionLocalProvider(LocalReportScreen provides ReportScreen("Settings")) {
                    SettingsScreen(
                        account = account,
                        user = user,
                        viewModel = viewModel,
                        onBack = { backStack.removeLastOrNull() },
                        onOpenReview = { backStack.add(ImportReview) },
                        onAddBooking = { backStack.add(NewBooking(it)) },
                    )
                }
            }
            entry<ImportReview> {
                CompositionLocalProvider(LocalReportScreen provides ReportScreen("Import review")) {
                    ImportReviewScreen(viewModel = viewModel, onBack = { backStack.removeLastOrNull() })
                }
            }
            entry<AccessPage> {
                // Not offered again from its own menu.
                CompositionLocalProvider(LocalOpenAccess provides null, LocalReportScreen provides ReportScreen("Access")) {
                    AccessScreen(viewModel = viewModel, onBack = { backStack.removeLastOrNull() })
                }
            }
        },
    )
}
