package app.travelmo

import app.travelmo.ui.CountingPrefs
import app.travelmo.ui.ListFilterPrefs
import app.travelmo.ui.AccessPage
import app.travelmo.ui.TripDetail
import app.travelmo.ui.Home
import app.travelmo.ui.SignedInNavigation
import app.travelmo.ui.rememberSignedInAccount
import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.LayoutDirection
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
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
import androidx.navigation3.runtime.NavBackStack
import androidx.navigation3.runtime.NavKey
import androidx.navigation3.runtime.entryProvider
import androidx.navigation3.runtime.rememberNavBackStack
import androidx.navigation3.ui.NavDisplay
import app.travelmo.auth.SignedIn
import app.travelmo.core.AccountAccess
import app.travelmo.core.TripWithSegments
import app.travelmo.core.tripIdFromReminderUrl
import app.travelmo.log.DebugLogging
import app.travelmo.notify.LiveFlightNotifications
import app.travelmo.notify.ReminderNotifications
import app.travelmo.ui.AccessScreen
import app.travelmo.ui.AccessState
import app.travelmo.ui.BookingFormScreen
import app.travelmo.ui.FinishDeletionScreen
import app.travelmo.ui.InviteOnlyScreen
import app.travelmo.ui.LocalOpenAccess
import app.travelmo.ui.CalendarScreen
import app.travelmo.ui.HomeNavigationBar
import app.travelmo.ui.HomeTab
import app.travelmo.ui.CrashReport
import app.travelmo.ui.LicensesHost
import app.travelmo.ui.LocalCrashReport
import app.travelmo.ui.CollectingBugReportSender
import app.travelmo.ui.LocalBugReportSender
import app.travelmo.ui.LocalReportBug
import app.travelmo.ui.pageCloses
import app.travelmo.ui.pageOpens
import app.travelmo.ui.LocalUpdateAvailable
import app.travelmo.ui.ProfileScreen
import app.travelmo.ui.ReportsScreen
import app.travelmo.ui.SettingsScreen
import app.travelmo.ui.ImportReviewScreen
import app.travelmo.ui.SignInScreen
import app.travelmo.ui.TripDetailScreen
import app.travelmo.ui.TripListScreen
import app.travelmo.ui.TripsViewModel
import app.travelmo.ui.theme.TravelmoTheme
import app.travelmo.update.PlayUpdateChecker
import com.mikelward.androidlog.android.ShareOutcome

class MainActivity : ComponentActivity() {
    // The trip a tapped reminder asks for, until the signed-in app has opened
    // it; kept across a recreation (a rotation on the sign-in screen, say).
    private var requestedTrip by mutableStateOf<String?>(null)

    // Whether the Licenses screen is up in place of the app (LicensesHost);
    // kept across a recreation.
    private var licensesOpen by mutableStateOf(false)

    // Whether Google Play has a newer version, for the menu's update dot;
    // rechecked on each foreground (onResume). Always false in debug builds.
    private var updateAvailable by mutableStateOf(false)
    private val playUpdateChecker by lazy { PlayUpdateChecker(application) }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        requestedTrip = if (savedInstanceState == null) tripFrom(intent) else savedInstanceState.getString(STATE_REQUESTED_TRIP)
        licensesOpen = savedInstanceState?.getBoolean(STATE_LICENSES_OPEN) ?: false
        val app = application as TravelmoApplication
        setContent {
            TravelmoTheme {
                val user by app.account.user.collectAsStateWithLifecycle()
                val signedIn = user
                val isSignedIn = signedIn != null
                // Report a bug, from the ⋮ menu, shows the screen it was opened from.
                val reportBug: suspend (Context, String?) -> ShareOutcome = remember(isSignedIn) { { context, preamble -> DebugLogging.share(context, signedIn = isSignedIn, screenshot = true, preamble = preamble) } }
                val crashReport = remember(isSignedIn) {
                    CrashReport(
                        crashed = DebugLogging.unacknowledgedCrash,
                        refresh = DebugLogging::refreshCrash,
                        dismiss = DebugLogging::dismissCrash,
                        share = { DebugLogging.share(it, signedIn = isSignedIn) },
                    )
                }
                CompositionLocalProvider(LocalReportBug provides reportBug, LocalCrashReport provides crashReport, LocalUpdateAvailable provides updateAvailable) {
                    LicensesHost(
                        open = licensesOpen,
                        onOpenChange = { licensesOpen = it },
                        appKey = if (signedIn == null) "signedOut" else "signedIn:${signedIn.uid}",
                    ) {
                        if (signedIn == null) {
                            SignInScreen(account = app.account)
                        } else {
                            SignedInApp(
                                app,
                                signedIn,
                                requestedTrip,
                                onTripOpened = { requestedTrip = null },
                            )
                        }
                    }
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        // On every foreground: the first launch (onResume follows onCreate),
        // and a return from the Play listing or the background.
        playUpdateChecker.checkForUpdate { updateAvailable = it }
    }

    override fun onStop() {
        super.onStop()
        // Leaving the app: each live flight's Live Update drawn again from its last message, so
        // one the system dropped is back.
        LiveFlightNotifications.redrawAll(this)
    }

    // singleTask: a tap while the app is open arrives here, not in onCreate.
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        tripFrom(intent)?.let {
            requestedTrip = it
            // The trip, not the licenses, is what the tap asked for.
            licensesOpen = false
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putString(STATE_REQUESTED_TRIP, requestedTrip)
        outState.putBoolean(STATE_LICENSES_OPEN, licensesOpen)
    }

    // A tapped reminder carries the trip's URL (ReminderNotifications.show).
    private fun tripFrom(intent: Intent?): String? = tripIdFromReminderUrl(intent?.getStringExtra(ReminderNotifications.EXTRA_URL))

    private companion object {
        const val STATE_REQUESTED_TRIP = "requestedTrip"
        const val STATE_LICENSES_OPEN = "licensesOpen"
    }
}

@Composable
private fun SignedInApp(
    app: TravelmoApplication,
    user: SignedIn,
    requestedTrip: String?,
    onTripOpened: () -> Unit,
) {
    // One view model per signed-in user: its queries carry the uid.
    val factory = remember(user.uid) {
        object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = TripsViewModel(app.trips, user.uid, user.email, emailVerified = user.emailVerified, pushDevice = app.pushDevice, accountDeletion = app.accountDeletion, flightRefresh = app.flightRefresh, accessCheck = app.accessCheck, emailLinks = app.emailLinks, tripActions = app.tripActions, importReview = app.importReview, gmailActions = app.gmailActions, fastmailActions = app.fastmailActions, imapActions = app.imapActions, googleCalendarActions = app.googleCalendarActions, calendarExportActions = app.calendarExportActions, parserUrl = BuildConfig.PARSER_URL, feedActions = app.feedActions, forwardActions = app.forwardActions, forwardOffered = BuildConfig.FORWARD_DOMAIN.isNotEmpty(), listFilterStore = ListFilterPrefs(app), countingStore = CountingPrefs(app)) as T
        }
    }
    val viewModel: TripsViewModel = viewModel(key = user.uid, factory = factory)
    val access by viewModel.access.collectAsStateWithLifecycle()
    val deletionUnfinished by viewModel.deletionUnfinished.collectAsStateWithLifecycle()
    if (deletionUnfinished) {
        FinishDeletionScreen(account = rememberSignedInAccount(app.account), viewModel = viewModel)
        return
    }
    // Only once the server has said so (SPEC "Access"): until then the app
    // shows as before, so an approved account never waits on it, offline
    // included, and one not approved sees its empty trip list a moment.
    val refused = (access as? AccessState.Known)?.takeIf { it.status != AccountAccess.APPROVED }
    if (refused != null) {
        InviteOnlyScreen(account = rememberSignedInAccount(app.account), viewModel = viewModel, status = refused.status)
        return
    }
    val backStack = rememberNavBackStack(Home)
    LaunchedEffect(requestedTrip) {
        if (requestedTrip != null) {
            backStack.add(TripDetail(requestedTrip))
            onTripOpened()
        }
    }
    val admin = (access as? AccessState.Known)?.admin == true
    val openAccess: (() -> Unit)? = if (admin) ({ if (backStack.lastOrNull() != AccessPage) backStack.add(AccessPage) }) else null
    // Report a bug sends to Travelmo from here on, for an account that may
    // use the app; signed out, or without a parser, it shares as before.
    val bugReportSender = remember(user.uid) {
        app.bugReports?.let { reports ->
            CollectingBugReportSender(
                version = "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})",
                collect = { DebugLogging.collectForSending(it, signedIn = true) },
                deliver = reports::send,
            )
        }
    }
    CompositionLocalProvider(LocalOpenAccess provides openAccess, LocalBugReportSender provides bugReportSender) {
        SignedInNavigation(user, viewModel, backStack, rememberSignedInAccount(app.account))
    }
}

