package app.travelmo.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import androidx.navigation3.runtime.NavBackStack
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.ui.NavDisplay
import app.travelmo.auth.SignedIn
import app.travelmo.core.TripWithSegments
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.launch
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
data class BookingDetail(val tripId: String, val segmentId: String) : NavKey

@Serializable
data class BookingForm(val tripId: String, val segmentId: String?, val defaultDate: String) : NavKey

/** A booking added with no trip in view, which goes into the trip it falls in, or a new one. */
@Serializable
data class NewBooking(val defaultDate: String) : NavKey

/** A section opened from the Profile hub, or a shared profile opened from Sharing. */
@Serializable
data class ProfileSubpage(val section: ProfileSection, val sharedUid: String? = null) : NavKey

/** A section opened from the Settings hub. */
@Serializable
data class SettingsSubpage(val section: SettingsSection) : NavKey


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

/**
 * Closes [key]'s screen, only while it is the one on top and never the last:
 * a screen's Back, tapped again while it slides away, or a late signal from
 * it, would otherwise close the screen under it, or empty the stack (which
 * NavDisplay can't show). True when it closed.
 */
fun <T : Any> MutableList<T>.close(key: T): Boolean {
    if (size < 2 || lastOrNull() != key) return false
    removeAt(lastIndex)
    return true
}

/**
 * Keeps the trip list's data (its trips' bookings, warnings, live flights,
 * filters) listened to while any signed-in page is in front, not only the
 * list: else, after a few seconds on a trip, Back to the list re-attaches a
 * listener per trip and rebuilds the list under the gesture, its cards
 * growing as each answers, so the swipe stutters and a tap on a moving card
 * is lost. It stops, as the list's own would, once the app is in the
 * background.
 */
@Composable
fun KeepTripListLive(viewModel: TripsViewModel) {
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(viewModel, lifecycle) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            launch { viewModel.state.collect {} }
            launch { viewModel.hiddenTrips.collect {} }
            launch { viewModel.watchingTrips.collect {} }
        }
    }
}

@Composable
fun SignedInNavigation(user: SignedIn, viewModel: TripsViewModel, backStack: NavBackStack<NavKey>, account: SignedInAccount) {
    KeepTripListLive(viewModel)
    val rtl = LocalLayoutDirection.current == LayoutDirection.Rtl
    NavDisplay(
        backStack = backStack,
        onBack = { backStack.lastOrNull()?.let { backStack.close(it) } },
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
                    HomeTab.PROFILE -> ProfileScreen(
                        viewModel = viewModel,
                        onOpenSettings = openSettings,
                        bottomBar = bar,
                        onOpenSection = { backStack.add(ProfileSubpage(it)) },
                    )
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
                    onBack = { backStack.close(key) },
                    onAddBooking = { defaultDate -> backStack.add(BookingForm(key.tripId, null, defaultDate)) },
                    onEditBooking = { segmentId -> backStack.add(BookingForm(key.tripId, segmentId, "")) },
                    onOpenBooking = { segmentId -> backStack.add(BookingDetail(key.tripId, segmentId)) },
                    // A merge lands on the trip the bookings went to, in place of the one that is gone.
                    onMerged = { targetId ->
                        if (backStack.close(key)) backStack.add(TripDetail(targetId))
                    },
                )
                }
            }
            entry<BookingDetail> { key ->
                CompositionLocalProvider(LocalReportScreen provides tripReportScreen("Booking", viewModel, key.tripId)) {
                    BookingDetailScreen(
                        viewModel = viewModel,
                        tripId = key.tripId,
                        segmentId = key.segmentId,
                        uid = user.uid,
                        onBack = { backStack.close(key) },
                        onEdit = { backStack.add(BookingForm(key.tripId, key.segmentId, "")) },
                        // Off the booking and its trip, both gone, to wherever the trip was opened from.
                        onTripGone = {
                            if (backStack.close(key)) backStack.close(TripDetail(key.tripId))
                        },
                    )
                }
            }
            entry<BookingForm> { key ->
                CompositionLocalProvider(LocalReportScreen provides tripReportScreen("Booking form", viewModel, key.tripId)) {
                    BookingFormScreen(viewModel = viewModel, tripId = key.tripId, segmentId = key.segmentId, defaultDate = key.defaultDate, onDone = { backStack.close(key) })
                }
            }
            entry<NewBooking> { key ->
                CompositionLocalProvider(LocalReportScreen provides ReportScreen("Booking form")) {
                    BookingFormScreen(
                        viewModel = viewModel,
                        tripId = null,
                        segmentId = null,
                        defaultDate = key.defaultDate,
                        onDone = { backStack.close(key) },
                        // On to the trip it went into, Back returning to where it was added from.
                        onAdded = { tripId ->
                            if (backStack.close(key)) backStack.add(TripDetail(tripId))
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
                        onBack = { backStack.close(Settings) },
                        onOpenReview = { backStack.add(ImportReview) },
                        onAddBooking = { backStack.add(NewBooking(it)) },
                        onOpenSection = { backStack.add(SettingsSubpage(it)) },
                    )
                }
            }
            entry<SettingsSubpage> { key ->
                CompositionLocalProvider(LocalReportScreen provides ReportScreen("Settings")) {
                    SettingsSectionScreen(
                        account = account,
                        user = user,
                        viewModel = viewModel,
                        section = key.section,
                        onBack = { backStack.close(key) },
                        onOpenReview = { backStack.add(ImportReview) },
                        onAddBooking = { backStack.add(NewBooking(it)) },
                    )
                }
            }
            entry<ImportReview> {
                CompositionLocalProvider(LocalReportScreen provides ReportScreen("Import review")) {
                    ImportReviewScreen(viewModel = viewModel, onBack = { backStack.close(ImportReview) })
                }
            }
            entry<AccessPage> {
                // Not offered again from its own menu.
                CompositionLocalProvider(LocalOpenAccess provides null, LocalReportScreen provides ReportScreen("Access")) {
                    AccessScreen(viewModel = viewModel, onBack = { backStack.close(AccessPage) })
                }
            }
            entry<ProfileSubpage> { key ->
                CompositionLocalProvider(LocalReportScreen provides ReportScreen("Profile")) {
                    ProfileSectionScreen(
                        viewModel = viewModel,
                        section = key.section,
                        sharedUid = key.sharedUid,
                        onBack = { backStack.close(key) },
                        onOpenShared = { uid -> backStack.add(ProfileSubpage(ProfileSection.SHARING, sharedUid = uid)) },
                    )
                }
            }
        },
    )
}
