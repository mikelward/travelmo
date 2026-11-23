package app.travelmo.ui

import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import app.travelmo.data.RideSettings
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.R
import app.travelmo.auth.GoogleAccount
import app.travelmo.auth.SignInResult
import app.travelmo.auth.SignedIn
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import app.travelmo.core.AddressHolder
import app.travelmo.core.FlightStatus
import app.travelmo.core.HomePeriod
import app.travelmo.core.PendingEmail
import app.travelmo.core.TripWithSegments
import app.travelmo.core.displayTitles
import app.travelmo.core.Place
import app.travelmo.core.Segment
import app.travelmo.core.SegmentType
import app.travelmo.core.Trip
import app.travelmo.ui.theme.TravelmoTheme
import com.github.takahirom.roborazzi.captureRoboImage
import com.github.takahirom.roborazzi.captureScreenRoboImage
import com.mikelward.androidzoom.FontSizeSettings
import com.mikelward.androidzoom.compose.FontSizeState
import com.mikepenz.aboutlibraries.Libs
import com.mikepenz.aboutlibraries.util.withJson
import java.time.Instant
import java.util.TimeZone
import com.mikelward.androidlog.android.ShareOutcome
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Every screen, rendered to app/snapshots/<name>.png under Robolectric at a
 * phone's size, from the fixtures in Fixtures.kt and a clock stopped at
 * 1 November 2026. The PNGs are under source control, so a UI change shows
 * as an image diff in the PR; CI verifies them, and
 * `./gradlew :app:testDebugUnitTest --tests app.travelmo.ui.ScreenScreenshotTest -Proborazzi.test.record`
 * rewrites them. The native graphics mode draws real text.
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36], qualifiers = "w411dp-h914dp-420dpi")
class ScreenScreenshotTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private val outputDir: String = System.getProperty("roborazzi.output.dir") ?: error("roborazzi.output.dir is not set; see app/build.gradle.kts")

    init {
        TimeZone.setDefault(TimeZone.getTimeZone("UTC"))
    }

    private fun viewModel() = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })

    private val user = SignedIn(OWNER, OWNER_EMAIL)

    private val crashed = CrashReport(MutableStateFlow(true), refresh = {}, dismiss = {}, share = { ShareOutcome.SHARED })

    // At a fixed text size (the system's unless [textScale] says), not the
    // process-wide stored one, so a picture never depends on another test.
    private fun capture(name: String, dark: Boolean = false, textScale: Float = 1f, content: @Composable () -> Unit) {
        val fontSize = FontSizeState(FontSizeSettings(scale = textScale), onScaleSettled = {}, onPinchEnabledChange = {})
        composeRule.setContent { TravelmoTheme(darkTheme = dark, fontSize = fontSize, content = content) }
        composeRule.waitForIdle()
        composeRule.onRoot().captureRoboImage(filePath = "$outputDir/$name.png")
    }

    @Test
    fun sign_in() = capture("sign_in") {
        SignInScreen(account = GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id"))
    }

    @Test
    fun sign_in_dark() = capture("sign_in_dark", dark = true) {
        SignInScreen(account = GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id"))
    }

    @Test
    fun sign_in_without_firebase() = capture("sign_in_without_firebase") {
        SignInScreen(account = GoogleAccount(firebaseAvailable = { false }, webClientId = null))
    }

    @Test
    fun sign_in_refused() {
        composeRule.setContent {
            TravelmoTheme {
                SignInScreen(
                    account = GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id"),
                    signIn = { SignInResult.Refused },
                )
            }
        }
        composeRule.onNodeWithText("Sign in with Google").performClick()
        composeRule.waitForIdle()
        composeRule.onRoot().captureRoboImage(filePath = "$outputDir/sign_in_refused.png")
    }

    // The view models are made outside the composition, as the app makes them.
    @Test
    fun trip_list() {
        val viewModel = viewModel()
        capture("trip_list") {
            TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = {}, bottomBar = { HomeNavigationBar(HomeTab.TRIPS) {} })
        }
    }

    @Test
    fun trip_list_dark() {
        val viewModel = viewModel()
        capture("trip_list_dark", dark = true) {
            TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = {}, bottomBar = { HomeNavigationBar(HomeTab.TRIPS) {} })
        }
    }

    // After a crash in an earlier run: the banner at the top of the list.
    @Test
    fun trip_list_crash_banner() {
        val viewModel = viewModel()
        capture("trip_list_crash_banner") {
            CompositionLocalProvider(LocalCrashReport provides crashed) {
                TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = {}, bottomBar = { HomeNavigationBar(HomeTab.TRIPS) {} })
            }
        }
    }

    @Test
    fun trip_list_crash_banner_dark() {
        val viewModel = viewModel()
        capture("trip_list_crash_banner_dark", dark = true) {
            CompositionLocalProvider(LocalCrashReport provides crashed) {
                TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = {}, bottomBar = { HomeNavigationBar(HomeTab.TRIPS) {} })
            }
        }
    }

    // Signed out, the same banner above the sign-in.
    @Test
    fun sign_in_crash_banner() = capture("sign_in_crash_banner") {
        CompositionLocalProvider(LocalCrashReport provides crashed) {
            SignInScreen(account = GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id"))
        }
    }

    // Report a bug's first question, over the screen it was opened from. The
    // dialog is a window of its own, so the whole screen is captured.
    @Test
    fun report_consent() = reportConsent("report_consent", dark = false)

    @Test
    fun report_consent_dark() = reportConsent("report_consent_dark", dark = true)

    private fun reportConsent(name: String, dark: Boolean) {
        val viewModel = viewModel()
        val fontSize = FontSizeState(FontSizeSettings(scale = 1f), onScaleSettled = {}, onPinchEnabledChange = {})
        composeRule.setContent {
            TravelmoTheme(darkTheme = dark, fontSize = fontSize) {
                TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = {}, bottomBar = { HomeNavigationBar(HomeTab.TRIPS) {} })
            }
        }
        composeRule.onNodeWithContentDescription("More options").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Report a bug").performClick()
        composeRule.waitForIdle()
        captureScreenRoboImage(filePath = "$outputDir/$name.png")
    }

    // The same camp in two school holidays: each card's title carries its
    // dates, while a title no other trip has reads as it is.
    @Test
    fun trip_list_same_titles() {
        val trips = listOf(
            Trip("camp-winter", "Debutots Camp", "2026-12-21", "2026-12-23", OWNER),
            Trip("liverpool", "Liverpool", "2027-01-08", "2027-01-10", OWNER),
            Trip("camp-spring", "Debutots Camp", "2027-02-15", "2027-02-19", OWNER),
        )
        val viewModel = TripsViewModel(FakeTripStore(trips = trips), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        capture("trip_list_same_titles") {
            TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = {}, bottomBar = { HomeNavigationBar(HomeTab.TRIPS) {} })
        }
    }

    // The red dot on ⋮ while Play has a newer version.

    @Test
    fun trip_list_update_available() {
        val viewModel = viewModel()
        capture("trip_list_update_available") {
            CompositionLocalProvider(LocalUpdateAvailable provides true) {
                TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = {}, bottomBar = { HomeNavigationBar(HomeTab.TRIPS) {} })
            }
        }
    }

    // At 150%: the text grows; paddings, icons and touch targets keep their layout.
    @Test
    fun trip_list_large_text() {
        val viewModel = viewModel()
        capture("trip_list_large_text", textScale = 1.5f) {
            TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = {}, bottomBar = { HomeNavigationBar(HomeTab.TRIPS) {} })
        }
    }

    @Test
    fun trip_list_empty() {
        val viewModel = TripsViewModel(FakeTripStore(trips = emptyList(), segments = emptyMap()), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        capture("trip_list_empty") {
            TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = {}, bottomBar = { HomeNavigationBar(HomeTab.TRIPS) {} })
        }
    }

    @Test
    fun trip_detail_warning() {
        val viewModel = viewModel()
        capture("trip_detail_warning") { TripDetailScreen(viewModel = viewModel, tripId = "dublin", uid = OWNER, onBack = {}, onAddBooking = {}, onEditBooking = {}, onMerged = {}) }
    }

    @Test
    fun profile() {
        val viewModel = viewModel()
        capture("profile") { ProfileScreen(viewModel = viewModel, bottomBar = { HomeNavigationBar(HomeTab.PROFILE) {} }) }
    }

    @Test
    fun profile_dark() {
        val viewModel = viewModel()
        capture("profile_dark", dark = true) { ProfileScreen(viewModel = viewModel, bottomBar = { HomeNavigationBar(HomeTab.PROFILE) {} }) }
    }

    @Test
    fun trip_detail() {
        val viewModel = viewModel()
        capture("trip_detail") { TripDetailScreen(viewModel = viewModel, tripId = "liverpool", uid = OWNER, onBack = {}, onAddBooking = {}, onEditBooking = {}, onMerged = {}) }
    }

    @Test
    fun trip_detail_dark() {
        val viewModel = viewModel()
        capture("trip_detail_dark", dark = true) { TripDetailScreen(viewModel = viewModel, tripId = "liverpool", uid = OWNER, onBack = {}, onAddBooking = {}, onEditBooking = {}, onMerged = {}) }
    }

    // A flight near departure: its live gates from the parser's status.
    private fun flightViewModel(): TripsViewModel {
        val trip = Trip("sydney", "Singapore", "2026-11-02", "2026-11-06", OWNER)
        val flight = Segment(
            "s-flight", "sydney", SegmentType.FLIGHT, "XX 100 SYD to SIN", "2026-11-02T02:00:00+11:00", "2026-11-02T08:30:00+08:00",
            provider = "Example Air", confirmation = "XX7Q2P", origin = Place("Sydney", code = "SYD"), destination = Place("Singapore", code = "SIN"),
        )
        val status = FlightStatus(
            ident = "XX100", date = "2026-11-02", origin = "SYD", found = true,
            departureGate = "8", departureTerminal = "1", arrivalGate = "D46", arrivalTerminal = "1",
            scheduledOut = "2026-11-01T15:00:00Z", scheduledIn = "2026-11-02T00:30:00Z", checkedAt = "2026-11-01T11:59:00Z",
        )
        val store = FakeTripStore(
            trips = fixtureTrips + trip,
            segments = fixtureSegments + ("sydney" to listOf(flight)),
            flightStatuses = mapOf("XX100_2026-11-02_SYD" to status),
        )
        return TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
    }

    @Test
    fun trip_detail_flight_status() {
        val viewModel = flightViewModel()
        capture("trip_detail_flight_status") { TripDetailScreen(viewModel = viewModel, tripId = "sydney", uid = OWNER, onBack = {}, onAddBooking = {}, onEditBooking = {}, onMerged = {}) }
    }

    @Test
    fun trip_detail_flight_status_dark() {
        val viewModel = flightViewModel()
        capture("trip_detail_flight_status_dark", dark = true) { TripDetailScreen(viewModel = viewModel, tripId = "sydney", uid = OWNER, onBack = {}, onAddBooking = {}, onEditBooking = {}, onMerged = {}) }
    }

    // A trip shared with the viewer: its violet SHARED label.
    @Test
    fun trip_detail_shared_dark() {
        val viewModel = viewModel()
        capture("trip_detail_shared_dark", dark = true) { TripDetailScreen(viewModel = viewModel, tripId = "edinburgh", uid = OWNER, onBack = {}, onAddBooking = {}, onEditBooking = {}, onMerged = {}) }
    }

    // The stay's Sources, from its ⋮ menu: the owner's own emails link into
    // Gmail, the partner's reminder doesn't. A dialog, so the whole screen.
    @Test
    fun trip_detail_sources() {
        val viewModel = viewModel()
        val fontSize = FontSizeState(FontSizeSettings(scale = 1f), onScaleSettled = {}, onPinchEnabledChange = {})
        composeRule.setContent {
            TravelmoTheme(fontSize = fontSize) {
                TripDetailScreen(viewModel = viewModel, tripId = "liverpool", uid = OWNER, onBack = {}, onAddBooking = {}, onEditBooking = {}, onMerged = {})
            }
        }
        composeRule.onAllNodesWithContentDescription("Booking actions")[1].performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Sources").performClick()
        composeRule.waitForIdle()
        captureScreenRoboImage(filePath = "$outputDir/trip_detail_sources.png")
    }

    @Test
    fun trip_detail_untimed() {
        val segments = fixtureSegments + ("liverpool" to fixtureSegments.getValue("liverpool") + fixtureUntimedActivity)
        val viewModel = TripsViewModel(FakeTripStore(segments = segments), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        capture("trip_detail_untimed") { TripDetailScreen(viewModel = viewModel, tripId = "liverpool", uid = OWNER, onBack = {}, onAddBooking = {}, onEditBooking = {}, onMerged = {}) }
    }

    @Test
    fun trip_detail_cancelled() {
        val store = FakeTripStore(trips = fixtureTrips + fixtureCancelledTrip, segments = fixtureSegments + (fixtureCancelledTrip.id to fixtureCancelledSegments))
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        capture("trip_detail_cancelled") { TripDetailScreen(viewModel = viewModel, tripId = "york", uid = OWNER, onBack = {}, onAddBooking = {}, onEditBooking = {}, onMerged = {}) }
    }

    @Test
    fun trip_detail_rides() {
        val store = FakeTripStore(trips = fixtureTrips + fixtureBostonTrip, segments = fixtureSegments + (fixtureBostonTrip.id to fixtureBostonSegments))
        store.rides.value = RideSettings(companies = fixtureRideCompanies)
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        capture("trip_detail_rides") { TripDetailScreen(viewModel = viewModel, tripId = "boston", uid = OWNER, onBack = {}, onAddBooking = {}, onEditBooking = {}, onMerged = {}) }
    }

    @Test
    fun trip_manage() {
        val viewModel = viewModel()
        capture("trip_manage") { TripDetailScreen(viewModel = viewModel, tripId = "paris", uid = OWNER, onBack = {}, onAddBooking = {}, onEditBooking = {}, onMerged = {}) }
    }

    @Test
    fun trip_deleting() {
        val viewModel = viewModel()
        capture("trip_deleting") { TripDetailScreen(viewModel = viewModel, tripId = "cornwall", uid = OWNER, onBack = {}, onAddBooking = {}, onEditBooking = {}, onMerged = {}) }
    }

    @Test
    fun trip_detail_shared() {
        val viewModel = viewModel()
        capture("trip_detail_shared") { TripDetailScreen(viewModel = viewModel, tripId = "edinburgh", uid = OWNER, onBack = {}, onAddBooking = {}, onEditBooking = {}, onMerged = {}) }
    }

    @Test
    fun add_booking() {
        val viewModel = viewModel()
        capture("add_booking") { BookingFormScreen(viewModel = viewModel, tripId = "liverpool", segmentId = null, defaultDate = "2026-12-12", onDone = {}) }
    }

    @Test
    fun edit_booking() {
        val viewModel = viewModel()
        capture("edit_booking") { BookingFormScreen(viewModel = viewModel, tripId = "liverpool", segmentId = "l-stay", defaultDate = "", onDone = {}) }
    }

    @Test
    fun edit_booking_dark() {
        val viewModel = viewModel()
        capture("edit_booking_dark", dark = true) { BookingFormScreen(viewModel = viewModel, tripId = "liverpool", segmentId = "l-stay", defaultDate = "", onDone = {}) }
    }

    @Test
    fun calendar() {
        val viewModel = viewModel()
        capture("calendar") {
            CalendarScreen(viewModel = viewModel, uid = OWNER, month = null, onMonthChange = {}, onOpenTrip = {}, bottomBar = { HomeNavigationBar(HomeTab.CALENDAR) {} })
        }
    }

    @Test
    fun calendar_dark() {
        val viewModel = viewModel()
        capture("calendar_dark", dark = true) {
            CalendarScreen(viewModel = viewModel, uid = OWNER, month = null, onMonthChange = {}, onOpenTrip = {}, bottomBar = { HomeNavigationBar(HomeTab.CALENDAR) {} })
        }
    }

    @Test
    fun reports() {
        val viewModel = viewModel()
        capture("reports") { ReportsScreen(viewModel = viewModel, onOpenTrip = {}, bottomBar = { HomeNavigationBar(HomeTab.REPORTS) {} }) }
    }

    @Test
    fun reports_dark() {
        val viewModel = viewModel()
        capture("reports_dark", dark = true) { ReportsScreen(viewModel = viewModel, onOpenTrip = {}, bottomBar = { HomeNavigationBar(HomeTab.REPORTS) {} }) }
    }

    // The residence and visa days below the map, on their own: home in London, so
    // the week in Lisbon is four days away.
    private fun residence(name: String, dark: Boolean) = capture(name, dark = dark) {
        val trips = fixtureTrips.map { TripWithSegments(it, fixtureSegments[it.id].orEmpty()) }
        Surface {
            Column(Modifier.fillMaxSize().padding(horizontal = 16.dp)) {
                ResidenceDays(trips, listOf(HomePeriod("London", "GB")), FROZEN_NOW.take(10), displayTitles(fixtureTrips), onOpenTrip = {})
            }
        }
    }

    @Test
    fun reports_residence() = residence("reports_residence", dark = false)

    @Test
    fun reports_residence_dark() = residence("reports_residence_dark", dark = true)

    @Test
    fun settings() = settings("settings", dark = false)

    @Test
    fun settings_dark() = settings("settings_dark", dark = true)

    private fun settings(name: String, dark: Boolean) {
        // With a messaging token, so the notifications switch is on the screen.
        // With a parser address, so Delete account and the trip actions are buttons.
        // With an address linked and another waiting for its link.
        val addresses = AddressHolder(
            emails = listOf("owner@work.example"),
            pendingEmails = listOf(PendingEmail("owner@other.example", FROZEN_NOW, "2026-11-02T12:00:00Z")),
        )
        val viewModel = TripsViewModel(
            FakeTripStore(addressHolder = addresses), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) }, pushDevice = FakePushDevice(),
            accountDeletion = FakeAccountDeletion(), emailLinks = FakeEmailLinks(), tripActions = FakeTripActions(),
        )
        capture(name, dark = dark) {
            SettingsScreen(account = GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id"), user = user, viewModel = viewModel, onBack = {})
        }
    }

    // The committed export, loaded here rather than off the main thread as
    // the screen does, so the list is there when the picture is taken.
    @Test
    fun licenses() {
        val libraries = Libs.Builder().withJson(composeRule.activity, R.raw.aboutlibraries).build()
        capture("licenses") { LicensesContent(libraries = libraries) }
    }
}
