package app.travelmo

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.ui.NavDisplay
import app.travelmo.auth.SignedIn
import app.travelmo.core.tripIdFromReminderUrl
import app.travelmo.notify.ReminderNotifications
import app.travelmo.ui.BookingFormScreen
import app.travelmo.ui.CalendarScreen
import app.travelmo.ui.HomeNavigationBar
import app.travelmo.ui.HomeTab
import app.travelmo.ui.ProfileScreen
import app.travelmo.ui.ReportsScreen
import app.travelmo.ui.SettingsScreen
import app.travelmo.ui.SignInScreen
import app.travelmo.ui.TripDetailScreen
import app.travelmo.ui.TripListScreen
import app.travelmo.ui.TripsViewModel
import app.travelmo.ui.theme.TravelmoTheme
import kotlinx.serialization.Serializable

// The pages, as Navigation 3 keys: the back stack is a list the app owns.
// Home holds the navigation bar's destinations (Trips, Calendar) as a tab;
// a trip and Settings are pushed above it.
@Serializable
private data object Home : NavKey

@Serializable
private data class TripDetail(val tripId: String) : NavKey

@Serializable
private data object Settings : NavKey

@Serializable
private data class BookingForm(val tripId: String, val segmentId: String?, val defaultDate: String) : NavKey

class MainActivity : ComponentActivity() {
    // The trip a tapped reminder asks for, until the signed-in app has opened
    // it; kept across a recreation (a rotation on the sign-in screen, say).
    private var requestedTrip by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        requestedTrip = if (savedInstanceState == null) tripFrom(intent) else savedInstanceState.getString(STATE_REQUESTED_TRIP)
        val app = application as TravelmoApplication
        setContent {
            TravelmoTheme {
                val user by app.account.user.collectAsStateWithLifecycle()
                val signedIn = user
                if (signedIn == null) {
                    SignInScreen(account = app.account)
                } else {
                    SignedInApp(app, signedIn, requestedTrip, onTripOpened = { requestedTrip = null })
                }
            }
        }
    }

    // singleTask: a tap while the app is open arrives here, not in onCreate.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        tripFrom(intent)?.let { requestedTrip = it }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString(STATE_REQUESTED_TRIP, requestedTrip)
    }

    // A tapped reminder carries the trip's URL (ReminderNotifications.show).
    private fun tripFrom(intent: Intent?): String? = tripIdFromReminderUrl(intent?.getStringExtra(ReminderNotifications.EXTRA_URL))

    private companion object {
        const val STATE_REQUESTED_TRIP = "requestedTrip"
    }
}

@Composable
private fun SignedInApp(app: TravelmoApplication, user: SignedIn, requestedTrip: String?, onTripOpened: () -> Unit) {
    // One view model per signed-in user: its queries carry the uid.
    val factory = remember(user.uid) {
        object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = TripsViewModel(app.trips, user.uid, user.email, pushDevice = app.pushDevice) as T
        }
    }
    val viewModel: TripsViewModel = viewModel(key = user.uid, factory = factory)
    val backStack = rememberNavBackStack(Home)
    LaunchedEffect(requestedTrip) {
        if (requestedTrip != null) {
            backStack.add(TripDetail(requestedTrip))
            onTripOpened()
        }
    }
    NavDisplay(
        backStack = backStack,
        onBack = { backStack.removeLastOrNull() },
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
                    email = user.email,
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
                SettingsScreen(account = app.account, user = user, viewModel = viewModel, onBack = { backStack.removeLastOrNull() })
            }
        },
    )
}
