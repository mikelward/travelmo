package app.travelmo.ui

import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onRoot
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.auth.GoogleAccount
import app.travelmo.auth.SignedIn
import app.travelmo.ui.theme.TravelmoTheme
import com.github.takahirom.roborazzi.captureRoboImage
import java.time.Instant
import java.util.TimeZone
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

    private fun capture(name: String, dark: Boolean = false, content: @Composable () -> Unit) {
        composeRule.setContent { TravelmoTheme(darkTheme = dark, content = content) }
        composeRule.waitForIdle()
        composeRule.onRoot().captureRoboImage(filePath = "$outputDir/$name.png")
    }

    @Test
    fun sign_in() = capture("sign_in") {
        SignInScreen(account = GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id"))
    }

    @Test
    fun sign_in_without_firebase() = capture("sign_in_without_firebase") {
        SignInScreen(account = GoogleAccount(firebaseAvailable = { false }, webClientId = null))
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
        capture("trip_detail_warning") { TripDetailScreen(viewModel = viewModel, tripId = "dublin", uid = OWNER, email = OWNER_EMAIL, onBack = {}, onAddBooking = {}, onEditBooking = {}, onMerged = {}) }
    }

    @Test
    fun profile() {
        val viewModel = viewModel()
        capture("profile") { ProfileScreen(viewModel = viewModel, bottomBar = { HomeNavigationBar(HomeTab.PROFILE) {} }) }
    }

    @Test
    fun trip_detail() {
        val viewModel = viewModel()
        capture("trip_detail") { TripDetailScreen(viewModel = viewModel, tripId = "liverpool", uid = OWNER, email = OWNER_EMAIL, onBack = {}, onAddBooking = {}, onEditBooking = {}, onMerged = {}) }
    }

    @Test
    fun trip_manage() {
        val viewModel = viewModel()
        capture("trip_manage") { TripDetailScreen(viewModel = viewModel, tripId = "paris", uid = OWNER, email = OWNER_EMAIL, onBack = {}, onAddBooking = {}, onEditBooking = {}, onMerged = {}) }
    }

    @Test
    fun trip_deleting() {
        val viewModel = viewModel()
        capture("trip_deleting") { TripDetailScreen(viewModel = viewModel, tripId = "cornwall", uid = OWNER, email = OWNER_EMAIL, onBack = {}, onAddBooking = {}, onEditBooking = {}, onMerged = {}) }
    }

    @Test
    fun trip_detail_shared() {
        val viewModel = viewModel()
        capture("trip_detail_shared") { TripDetailScreen(viewModel = viewModel, tripId = "edinburgh", uid = OWNER, email = OWNER_EMAIL, onBack = {}, onAddBooking = {}, onEditBooking = {}, onMerged = {}) }
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
    fun settings() = capture("settings") {
        SettingsScreen(account = GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id"), user = user, onBack = {})
    }
}
