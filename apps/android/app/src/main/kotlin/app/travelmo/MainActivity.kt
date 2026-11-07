package app.travelmo

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.ui.NavDisplay
import app.travelmo.auth.SignedIn
import app.travelmo.ui.SettingsScreen
import app.travelmo.ui.SignInScreen
import app.travelmo.ui.TripDetailScreen
import app.travelmo.ui.TripListScreen
import app.travelmo.ui.TripsViewModel
import app.travelmo.ui.theme.TravelmoTheme
import kotlinx.serialization.Serializable

// The pages, as Navigation 3 keys: the back stack is a list the app owns.
@Serializable
private data object TripList : NavKey

@Serializable
private data class TripDetail(val tripId: String) : NavKey

@Serializable
private data object Settings : NavKey

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val app = application as TravelmoApplication
        setContent {
            TravelmoTheme {
                val user by app.account.user.collectAsStateWithLifecycle()
                val signedIn = user
                if (signedIn == null) {
                    SignInScreen(account = app.account)
                } else {
                    SignedInApp(app, signedIn)
                }
            }
        }
    }
}

@Composable
private fun SignedInApp(app: TravelmoApplication, user: SignedIn) {
    // One view model per signed-in user: its queries carry the uid.
    val factory = remember(user.uid) {
        object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = TripsViewModel(app.trips, user.uid, user.email) as T
        }
    }
    val viewModel: TripsViewModel = viewModel(key = user.uid, factory = factory)
    val backStack = rememberNavBackStack(TripList)
    NavDisplay(
        backStack = backStack,
        onBack = { backStack.removeLastOrNull() },
        entryProvider = entryProvider {
            entry<TripList> {
                TripListScreen(
                    viewModel = viewModel,
                    uid = user.uid,
                    onOpenTrip = { backStack.add(TripDetail(it)) },
                    onOpenSettings = { backStack.add(Settings) },
                )
            }
            entry<TripDetail> { key ->
                TripDetailScreen(viewModel = viewModel, tripId = key.tripId, uid = user.uid, onBack = { backStack.removeLastOrNull() })
            }
            entry<Settings> {
                SettingsScreen(account = app.account, user = user, onBack = { backStack.removeLastOrNull() })
            }
        },
    )
}
