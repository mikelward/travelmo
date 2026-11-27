package app.travelmo.ui

import app.travelmo.core.travelReport
import app.travelmo.data.InMemoryReportSnapshotStore
import app.travelmo.data.TripStore
import app.travelmo.data.encodeReportSnapshot
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.R
import app.travelmo.auth.GoogleAccount
import app.travelmo.auth.SignInResult
import app.travelmo.auth.SignedIn
import app.travelmo.core.AccessConfig
import app.travelmo.core.AccountAccess
import app.travelmo.core.AddressHolder
import app.travelmo.core.BackfillShown
import app.travelmo.core.FlightStatus
import app.travelmo.core.HomePeriod
import app.travelmo.core.PendingEmail
import app.travelmo.core.Place
import app.travelmo.core.Segment
import app.travelmo.core.SegmentType
import app.travelmo.core.Trip
import app.travelmo.core.TripWithSegments
import app.travelmo.core.accessDecision
import app.travelmo.core.accessInvite
import app.travelmo.core.displayTitles
import app.travelmo.data.FastmailStatus
import app.travelmo.data.GmailStatus
import app.travelmo.data.RideSettings
import app.travelmo.shared.Res
import app.travelmo.shared.add_reminder
import app.travelmo.shared.connect_imap
import app.travelmo.ui.theme.TravelmoTheme
import com.github.takahirom.roborazzi.captureRoboImage
import com.github.takahirom.roborazzi.captureScreenRoboImage
import com.mikelward.androidlog.android.ShareOutcome
import com.mikelward.androidzoom.FontSizeSettings
import com.mikelward.androidzoom.compose.FontSizeState
import com.mikepenz.aboutlibraries.Libs
import com.mikepenz.aboutlibraries.util.withJson
import kotlin.time.Instant
import java.util.TimeZone
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import org.jetbrains.compose.resources.getString
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

    private fun viewModel() = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) }, tripActions = FakeTripActions())

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

    // For the Play listing: a trip under way and the next few, each with its city's landmark, and no warnings.
    @Test
    fun trip_list_cities() {
        val trips = listOf(
            Trip("tokyo", "Tokyo", "2026-10-29", "2026-11-04", OWNER),
            Trip("new-york", "New York", "2026-11-20", "2026-11-24", OWNER),
            Trip("london", "London for Christmas", "2026-12-18", "2026-12-27", OWNER),
            Trip("rome", "Rome", "2027-01-15", "2027-01-19", OWNER),
            Trip("barcelona", "Barcelona", "2027-02-12", "2027-02-16", OWNER),
            Trip("sydney", "Sydney", "2027-03-05", "2027-03-14", OWNER),
            Trip("istanbul", "Istanbul", "2027-04-09", "2027-04-12", OWNER),
        )
        val segments = mapOf(
            "tokyo" to listOf(
                Segment("t-hotel", "tokyo", SegmentType.LODGING, "Example Hotel Shinjuku", "2026-10-30T15:00:00+09:00", "2026-11-04T11:00:00+09:00", destination = Place("Example Hotel Shinjuku", city = "Tokyo", country = "JP")),
                Segment("t-dinner", "tokyo", SegmentType.ACTIVITY, "Dinner at Example Sushi", "2026-11-02T19:30:00+09:00", destination = Place("Example Sushi", city = "Tokyo", country = "JP")),
            ),
        )
        val viewModel = TripsViewModel(FakeTripStore(trips = trips, segments = segments, profile = null, shared = emptyList()), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        capture("trip_list_cities") {
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

    // Searching: the field in the wordmark's place, with Back and Clear.
    @Test
    fun trip_list_search() {
        val viewModel = viewModel()
        viewModel.searchTrips("dublin")
        capture("trip_list_search") {
            TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = {}, bottomBar = { HomeNavigationBar(HomeTab.TRIPS) {} })
        }
    }

    // The funnel's menu, one filter on. A menu is a window of its own, so the whole screen is captured.
    @Test
    fun trip_list_filters() {
        val viewModel = viewModel()
        viewModel.setListFilters(app.travelmo.core.ListFilters(hideCancelled = true))
        val fontSize = FontSizeState(FontSizeSettings(scale = 1f), onScaleSettled = {}, onPinchEnabledChange = {})
        composeRule.setContent {
            TravelmoTheme(fontSize = fontSize) {
                TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = {}, bottomBar = { HomeNavigationBar(HomeTab.TRIPS) {} })
            }
        }
        composeRule.onNodeWithContentDescription("Filters").performClick()
        composeRule.waitForIdle()
        captureScreenRoboImage(filePath = "$outputDir/trip_list_filters.png")
    }

    // A trip whose bookings look like two in one: Check on its card.
    @Test
    fun trip_list_mixed() {
        val store = FakeTripStore(trips = fixtureTrips.map { if (it.id == "liverpool") it.copy(mixed = true) else it })
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) }, tripActions = FakeTripActions())
        capture("trip_list_mixed") {
            TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = {}, bottomBar = { HomeNavigationBar(HomeTab.TRIPS) {} })
        }
    }

    // A trip under way with a flight in three hours: its gate on the card.
    @Test
    fun trip_list_flight() {
        val viewModel = TripsViewModel(flightTripStore(), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        capture("trip_list_flight") {
            TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = {}, bottomBar = { HomeNavigationBar(HomeTab.TRIPS) {} })
        }
    }

    // The same flight landed 12 minutes ago: its gate and carousel, then the car booked for its landing.
    @Test
    fun trip_list_landed() {
        val viewModel = TripsViewModel(landedTripStore(), OWNER, OWNER_EMAIL, clock = { Instant.parse(LANDED_NOW) })
        capture("trip_list_landed") {
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

    // Report a bug, signed in: sent to Travelmo, from a trip's page, saying
    // its bookings go too; and from the trip list, where they don't.
    @Test
    fun report_send_trip() = reportSend("report_send_trip", dark = false, onTrip = true)

    @Test
    fun report_send_trip_dark() = reportSend("report_send_trip_dark", dark = true, onTrip = true)

    @Test
    fun report_send() = reportSend("report_send", dark = false, onTrip = false)

    private fun reportSend(name: String, dark: Boolean, onTrip: Boolean) {
        val viewModel = viewModel()
        val fontSize = FontSizeState(FontSizeSettings(scale = 1f), onScaleSettled = {}, onPinchEnabledChange = {})
        val sender = BugReportSender { _, _, _ -> }
        val screen = if (onTrip) ReportScreen("Trip") { null } else ReportScreen("Trips")
        composeRule.setContent {
            TravelmoTheme(darkTheme = dark, fontSize = fontSize) {
                CompositionLocalProvider(LocalBugReportSender provides sender, LocalReportScreen provides screen) {
                    if (onTrip) {
                        TripDetailScreen(viewModel = viewModel, tripId = "liverpool", uid = OWNER, onBack = {}, onAddBooking = {}, onEditBooking = {}, onMerged = {})
                    } else {
                        TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = {}, bottomBar = { HomeNavigationBar(HomeTab.TRIPS) {} })
                    }
                }
            }
        }
        composeRule.onNodeWithContentDescription("More options").performClick()
        composeRule.waitForIdle()
        // The dialog's text field never lets Compose call itself idle here,
        // so the clock is stepped by hand to let it settle.
        composeRule.mainClock.autoAdvance = false
        composeRule.onNodeWithText("Report a bug").performClick()
        composeRule.mainClock.advanceTimeBy(1_000)
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
        capture("profile") { ProfileScreen(viewModel = viewModel, onOpenSettings = {}, bottomBar = { HomeNavigationBar(HomeTab.PROFILE) {} }) }
    }

    @Test
    fun profile_dark() {
        val viewModel = viewModel()
        capture("profile_dark", dark = true) { ProfileScreen(viewModel = viewModel, onOpenSettings = {}, bottomBar = { HomeNavigationBar(HomeTab.PROFILE) {} }) }
    }

    // The list with a trip the user is only watching: none of its travelers is them.
    @Test
    fun trip_list_watching() {
        val store = FakeTripStore(
            trips = fixtureTrips + fixtureFlightTrip.copy(title = "Mum's trip", travelers = listOf("Pat Example")),
            people = listOf(
                app.travelmo.core.Person("me", "Sam Example", bookings = 4, direct = 4),
                app.travelmo.core.Person("mum", "Pat Example", bookings = 1),
            ),
        )
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        capture("trip_list_watching") { TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = {}) }
    }

    // The Profile scrolled to the people the user's bookings name, one taken to be the user.
    @Test
    fun profile_people() {
        val store = FakeTripStore(
            people = listOf(
                app.travelmo.core.Person("me", "Sam Example", bookings = 4, direct = 4),
                app.travelmo.core.Person("mum", "Pat Example", bookings = 6),
            ),
        )
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent {
            TravelmoTheme { ProfileScreen(viewModel = viewModel, onOpenSettings = {}, bottomBar = { HomeNavigationBar(HomeTab.PROFILE) {} }) }
        }
        composeRule.onNode(androidx.compose.ui.test.hasScrollToNodeAction()).performScrollToNode(androidx.compose.ui.test.hasText("This is me"))
        composeRule.waitForIdle()
        composeRule.onRoot().captureRoboImage(filePath = "$outputDir/profile_people.png")
    }

    // The Profile scrolled to home: London since 2022 by a correction.
    @Test
    fun profile_home() = profileHome("profile_home", dark = false)

    @Test
    fun profile_home_dark() = profileHome("profile_home_dark", dark = true)

    private fun profileHome(name: String, dark: Boolean) {
        val store = FakeTripStore()
        store.rides.value = app.travelmo.data.RideSettings(homes = listOf(app.travelmo.core.HomeCorrection("London", "GB", "2022-01-15")))
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent {
            TravelmoTheme(darkTheme = dark) { ProfileScreen(viewModel = viewModel, onOpenSettings = {}, bottomBar = { HomeNavigationBar(HomeTab.PROFILE) {} }) }
        }
        composeRule.onNode(androidx.compose.ui.test.hasScrollToNodeAction()).performScrollToNode(androidx.compose.ui.test.hasText("Set"))
        composeRule.waitForIdle()
        composeRule.onRoot().captureRoboImage(filePath = "$outputDir/$name.png")
    }

    @Test
    fun booking_detail() {
        val viewModel = viewModel()
        capture("booking_detail") { BookingDetailScreen(viewModel = viewModel, tripId = "liverpool", segmentId = "l-stay", uid = OWNER, onBack = {}, onEdit = {}, onTripGone = {}) }
    }

    @Test
    fun booking_detail_dark() {
        val viewModel = viewModel()
        capture("booking_detail_dark", dark = true) { BookingDetailScreen(viewModel = viewModel, tripId = "liverpool", segmentId = "l-stay", uid = OWNER, onBack = {}, onEdit = {}, onTripGone = {}) }
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

    // Merge with: the trip's other stay, offered from the first stay's menu.
    @Test
    fun trip_detail_merge() = tripMerge("trip_detail_merge", dark = false)

    @Test
    fun trip_detail_merge_dark() = tripMerge("trip_detail_merge_dark", dark = true)

    // Split…: the trip's bookings to tick, the train's email picking its booking.
    @Test
    fun trip_detail_split() = tripSplit("trip_detail_split", dark = false)

    @Test
    fun trip_detail_split_dark() = tripSplit("trip_detail_split_dark", dark = true)

    @Test
    fun trip_detail_mixed() = tripMixed("trip_detail_mixed", dark = false)

    @Test
    fun trip_detail_mixed_dark() = tripMixed("trip_detail_mixed_dark", dark = true)

    // A relative's flight in the air while the user's is: the notice, with Split…, and It's one trip.
    private fun tripMixed(name: String, dark: Boolean) {
        val flight = Segment(
            "l-out", "liverpool", SegmentType.FLIGHT, "XX 1 LHR to DXB", "2026-12-12T09:00:00+00:00", "2026-12-12T19:00:00+04:00",
            origin = Place("Heathrow", code = "LHR"), destination = Place("Dubai", code = "DXB"),
        )
        val theirs = flight.copy(id = "l-theirs", title = "YY 9 SYD to SIN", start = "2026-12-12T14:00:00+11:00", end = "2026-12-12T21:00:00+08:00", origin = Place("Sydney", code = "SYD"), destination = Place("Singapore", code = "SIN"))
        val store = FakeTripStore(segments = fixtureSegments + ("liverpool" to fixtureSegments.getValue("liverpool") + flight + theirs))
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) }, tripActions = FakeTripActions())
        capture(name, dark = dark) {
            TripDetailScreen(viewModel = viewModel, tripId = "liverpool", uid = OWNER, onBack = {}, onAddBooking = {}, onEditBooking = {}, onMerged = {})
        }
    }

    @Test
    fun trip_detail_travelers() = tripTravelers("trip_detail_travelers", dark = false)

    @Test
    fun trip_detail_travelers_dark() = tripTravelers("trip_detail_travelers_dark", dark = true)

    // Travelers… with one name unticked.
    private fun tripTravelers(name: String, dark: Boolean) {
        val viewModel = viewModel()
        val fontSize = FontSizeState(FontSizeSettings(scale = 1f), onScaleSettled = {}, onPinchEnabledChange = {})
        composeRule.setContent {
            TravelmoTheme(darkTheme = dark, fontSize = fontSize) {
                TripDetailScreen(viewModel = viewModel, tripId = "liverpool", uid = OWNER, onBack = {}, onAddBooking = {}, onEditBooking = {}, onMerged = {})
            }
        }
        composeRule.waitForIdle()
        composeRule.onNodeWithContentDescription("More options").performClick()
        composeRule.onNodeWithText("Travelers…").performClick()
        composeRule.onNodeWithText("Alex Example").performClick()
        composeRule.waitForIdle()
        captureScreenRoboImage(filePath = "$outputDir/$name.png")
    }

    private fun tripSplit(name: String, dark: Boolean) {
        val viewModel = viewModel()
        val fontSize = FontSizeState(FontSizeSettings(scale = 1f), onScaleSettled = {}, onPinchEnabledChange = {})
        composeRule.setContent {
            TravelmoTheme(darkTheme = dark, fontSize = fontSize) {
                TripDetailScreen(viewModel = viewModel, tripId = "liverpool", uid = OWNER, onBack = {}, onAddBooking = {}, onEditBooking = {}, onMerged = {})
            }
        }
        composeRule.waitForIdle()
        composeRule.onNodeWithContentDescription("More options").performClick()
        composeRule.onNodeWithText("Split…").performClick()
        composeRule.onNodeWithText("${fixtureTrainEmail.label} (1)").performClick()
        composeRule.waitForIdle()
        captureScreenRoboImage(filePath = "$outputDir/$name.png")
    }

    private fun tripMerge(name: String, dark: Boolean) {
        val second = Segment("l-stay-2", "liverpool", SegmentType.LODGING, "Cove Liverpool apartment", "2026-12-12T16:00:00+00:00", "2026-12-13T11:00:00+00:00")
        val store = FakeTripStore(segments = fixtureSegments + ("liverpool" to fixtureSegments.getValue("liverpool") + second))
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        val fontSize = FontSizeState(FontSizeSettings(scale = 1f), onScaleSettled = {}, onPinchEnabledChange = {})
        composeRule.setContent {
            TravelmoTheme(darkTheme = dark, fontSize = fontSize) {
                TripDetailScreen(viewModel = viewModel, tripId = "liverpool", uid = OWNER, onBack = {}, onAddBooking = {}, onEditBooking = {}, onMerged = {})
            }
        }
        composeRule.waitForIdle()
        composeRule.onAllNodesWithContentDescription("Booking actions")[1].performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Merge with…").performClick()
        composeRule.waitForIdle()
        captureScreenRoboImage(filePath = "$outputDir/$name.png")
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

    // A flight the viewer marked "I've checked in": the mark and its undo.
    @Test
    fun trip_detail_checked_in() {
        val store = flightTripStore()
        store.checkedIn.value = mapOf("sydney" to setOf("s-flight"))
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        capture("trip_detail_checked_in") { TripDetailScreen(viewModel = viewModel, tripId = "sydney", uid = OWNER, onBack = {}, onAddBooking = {}, onEditBooking = {}, onMerged = {}) }
    }

    // A trip shared with the viewer: its violet SHARED label.
    @Test
    fun trip_detail_shared_dark() {
        val viewModel = viewModel()
        capture("trip_detail_shared_dark", dark = true) { TripDetailScreen(viewModel = viewModel, tripId = "paris", uid = OWNER, onBack = {}, onAddBooking = {}, onEditBooking = {}, onMerged = {}) }
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

    // Boston from London is abroad: the owner's reminders before every
    // international trip, one ticked off, and a one-off of their own.
    @Test
    fun trip_detail_checklist() = tripChecklist("trip_detail_checklist", dark = false)

    @Test
    fun trip_detail_checklist_dark() = tripChecklist("trip_detail_checklist_dark", dark = true)

    private fun tripChecklist(name: String, dark: Boolean) {
        val store = FakeTripStore(trips = fixtureTrips + fixtureBostonTrip, segments = fixtureSegments + (fixtureBostonTrip.id to fixtureBostonSegments))
        store.standing.value = fixtureStandingReminders
        store.checklists.value = mapOf(fixtureBostonTrip.id to fixtureBostonChecklist)
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        capture(name, dark = dark) { TripDetailScreen(viewModel = viewModel, tripId = "boston", uid = OWNER, onBack = {}, onAddBooking = {}, onEditBooking = {}, onMerged = {}) }
    }

    // Settings scrolled to the reminders before international trips.
    @Test
    fun settings_trip_reminders() {
        val store = FakeTripStore()
        store.standing.value = fixtureStandingReminders
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) }, pushDevice = FakePushDevice())
        composeRule.setContent {
            TravelmoTheme(darkTheme = false, fontSize = FontSizeState(FontSizeSettings(scale = 1f), onScaleSettled = {}, onPinchEnabledChange = {})) {
                SettingsScreen(account = rememberSignedInAccount(GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id")), user = user, viewModel = viewModel, onBack = {})
            }
        }
        composeRule.onNodeWithText(runBlocking { getString(Res.string.add_reminder) }).performScrollTo()
        composeRule.waitForIdle()
        composeRule.onRoot().captureRoboImage(filePath = "$outputDir/settings_trip_reminders.png")
    }

    // Settings scrolled to Refresh from email, part way through one.
    @Test
    fun settings_refresh() = settingsRefresh("settings_refresh", dark = false)

    @Test
    fun settings_refresh_dark() = settingsRefresh("settings_refresh_dark", dark = true)

    private fun settingsRefresh(name: String, dark: Boolean) {
        val running = app.travelmo.core.RefreshShown(scanned = 120, done = false, updatedAt = FROZEN_NOW, total = 340, running = true)
        val viewModel = TripsViewModel(FakeTripStore(refreshProgress = running), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) }, tripActions = FakeTripActions())
        composeRule.setContent {
            TravelmoTheme(darkTheme = dark, fontSize = FontSizeState(FontSizeSettings(scale = 1f), onScaleSettled = {}, onPinchEnabledChange = {})) {
                SettingsScreen(account = rememberSignedInAccount(GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id")), user = user, viewModel = viewModel, onBack = {})
            }
        }
        composeRule.onNodeWithText("Refreshing your bookings", substring = true).performScrollTo()
        composeRule.waitForIdle()
        composeRule.onRoot().captureRoboImage(filePath = "$outputDir/$name.png")
    }

    // Settings' Refresh from email, done with emails it couldn't read.
    @Test
    fun settings_refresh_failed() {
        val done = app.travelmo.core.RefreshShown(scanned = 340, done = true, updatedAt = FROZEN_NOW, total = 340, updated = 12, failed = 2, failedIds = listOf("booked", "fastmail-h1"))
        val hotel = app.travelmo.core.ParsedRecord("fastmail-h1", "imported", FROZEN_NOW, source = "fastmail", subject = "Your hotel in Paris", from = "Hôtel du Marais")
        val store = FakeTripStore(refreshProgress = done, parsed = fixtureParsed + hotel, gmailStatuses = listOf(GmailStatus("owner@example.com", connectedAt = "2026-10-01T00:00:00Z")))
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) }, tripActions = FakeTripActions())
        composeRule.setContent {
            TravelmoTheme(fontSize = FontSizeState(FontSizeSettings(scale = 1f), onScaleSettled = {}, onPinchEnabledChange = {})) {
                SettingsScreen(account = rememberSignedInAccount(GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id")), user = user, viewModel = viewModel, onBack = {})
            }
        }
        composeRule.onNodeWithText("Try again").performScrollTo()
        composeRule.waitForIdle()
        composeRule.onRoot().captureRoboImage(filePath = "$outputDir/settings_refresh_failed.png")
    }

    @Test
    fun trip_manage() {
        val viewModel = viewModel()
        capture("trip_manage") { TripDetailScreen(viewModel = viewModel, tripId = "amsterdam", uid = OWNER, onBack = {}, onAddBooking = {}, onEditBooking = {}, onMerged = {}) }
    }

    @Test
    fun trip_deleting() {
        val viewModel = viewModel()
        capture("trip_deleting") { TripDetailScreen(viewModel = viewModel, tripId = "cornwall", uid = OWNER, onBack = {}, onAddBooking = {}, onEditBooking = {}, onMerged = {}) }
    }

    @Test
    fun trip_detail_shared() {
        val viewModel = viewModel()
        capture("trip_detail_shared") { TripDetailScreen(viewModel = viewModel, tripId = "paris", uid = OWNER, onBack = {}, onAddBooking = {}, onEditBooking = {}, onMerged = {}) }
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
            CalendarScreen(viewModel = viewModel, uid = OWNER, month = null, onMonthChange = {}, onOpenTrip = {}, onOpenSettings = {}, bottomBar = { HomeNavigationBar(HomeTab.CALENDAR) {} })
        }
    }

    @Test
    fun calendar_dark() {
        val viewModel = viewModel()
        capture("calendar_dark", dark = true) {
            CalendarScreen(viewModel = viewModel, uid = OWNER, month = null, onMonthChange = {}, onOpenTrip = {}, onOpenSettings = {}, bottomBar = { HomeNavigationBar(HomeTab.CALENDAR) {} })
        }
    }

    @Test
    fun reports() {
        val viewModel = viewModel()
        capture("reports") { ReportsScreen(viewModel = viewModel, onOpenTrip = {}, onOpenSettings = {}, bottomBar = { HomeNavigationBar(HomeTab.REPORTS) {} }) }
    }

    // Reports drawn from the last visit's counts while the bookings are still being read: the year picker waits.
    @Test
    fun reports_saved() = reportsSaved("reports_saved", dark = false)

    @Test
    fun reports_saved_dark() = reportsSaved("reports_saved_dark", dark = true)

    private fun reportsSaved(name: String, dark: Boolean) {
        val stalled = object : TripStore by FakeTripStore() {
            override fun segments(tripId: String): Flow<List<Segment>> = flow { awaitCancellation() }
            override suspend fun segmentsOnce(tripId: String): app.travelmo.data.Seen<List<Segment>> = awaitCancellation()
        }
        val last = travelReport(fixtureTrips.map { TripWithSegments(it, fixtureSegments[it.id].orEmpty()) }, FROZEN_NOW.take(10))
        val viewModel = TripsViewModel(stalled, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) }, reportSnapshotStore = InMemoryReportSnapshotStore(encodeReportSnapshot(OWNER, last)))
        capture(name, dark = dark) { ReportsScreen(viewModel = viewModel, onOpenTrip = {}, onOpenSettings = {}, bottomBar = { HomeNavigationBar(HomeTab.REPORTS) {} }) }
    }

    // A country opened to the trips with days there.
    @Test
    fun reports_country() = reportsCountry("reports_country", dark = false)

    @Test
    fun reports_country_dark() = reportsCountry("reports_country_dark", dark = true)

    private fun reportsCountry(name: String, dark: Boolean) {
        val viewModel = viewModel()
        composeRule.setContent {
            TravelmoTheme(darkTheme = dark) { ReportsScreen(viewModel = viewModel, onOpenTrip = {}, onOpenSettings = {}, bottomBar = { HomeNavigationBar(HomeTab.REPORTS) {} }) }
        }
        composeRule.onNodeWithText("Days in each country", substring = true).performScrollTo().performClick()
        composeRule.onNodeWithText("Portugal").performScrollTo().performClick()
        composeRule.onNodeWithText("14–19 Sept 2026 · 6 days").performScrollTo()
        composeRule.waitForIdle()
        composeRule.onRoot().captureRoboImage(filePath = "$outputDir/$name.png")
    }

    // Reports scrolled to downloading a summary of the trips.
    @Test
    fun reports_download() = reportsDownload("reports_download", dark = false)

    @Test
    fun reports_download_dark() = reportsDownload("reports_download_dark", dark = true)

    private fun reportsDownload(name: String, dark: Boolean) {
        val viewModel = viewModel()
        composeRule.setContent {
            TravelmoTheme(darkTheme = dark) { ReportsScreen(viewModel = viewModel, onOpenTrip = {}, onOpenSettings = {}, bottomBar = { HomeNavigationBar(HomeTab.REPORTS) {} }) }
        }
        composeRule.onNode(androidx.compose.ui.test.hasScrollToNodeAction()).performScrollToNode(androidx.compose.ui.test.hasText("Download CSV"))
        composeRule.waitForIdle()
        composeRule.onRoot().captureRoboImage(filePath = "$outputDir/$name.png")
    }

    @Test
    fun reports_dark() {
        val viewModel = viewModel()
        capture("reports_dark", dark = true) { ReportsScreen(viewModel = viewModel, onOpenTrip = {}, onOpenSettings = {}, bottomBar = { HomeNavigationBar(HomeTab.REPORTS) {} }) }
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
    fun import_review() = importReview("import_review", dark = false)

    @Test
    fun import_review_dark() = importReview("import_review_dark", dark = true)

    /** After Import anyway on the e-ticket: what came of it, and its report to copy. */
    @Test
    fun import_review_report() = importReview("import_review_report", dark = false, reimported = "ticket")

    private fun importReview(name: String, dark: Boolean, reimported: String? = null) {
        // Newest, an airline's welcome to a new status, whose loyalty was kept.
        val status = app.travelmo.core.ParsedRecord(
            "status", "not_booking", "2026-11-23T12:30:00Z", from = "Example Air <news@t.delta.com>", subject = "Welcome to Silver Medallion® Status",
            loyalty = listOf("Delta: Silver Medallion · 49,606 Miles"),
        )
        val viewModel = TripsViewModel(FakeTripStore(parsed = listOf(status) + fixtureParsed), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) }, importReview = FakeImportReview())
        reimported?.let { viewModel.reimport("report", it) }
        capture(name, dark = dark) {
            ImportReviewScreen(viewModel = viewModel, onBack = {}, zone = "Europe/London")
        }
    }

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
            gmails = listOf("owner@example.com", "owner.trips@example.org"),
        )
        val viewModel = TripsViewModel(
            FakeTripStore(
                addressHolder = addresses,
                // Two Gmail mailboxes, one reading past emails, the other read.
                gmailStatuses = listOf(
                    GmailStatus("owner@example.com", BackfillShown(scanned = 1200, imported = 14, done = false, updatedAt = FROZEN_NOW, running = true)),
                    GmailStatus("owner.trips@example.org", BackfillShown(scanned = 300, imported = 2, done = true, updatedAt = FROZEN_NOW)),
                ),
            ),
            OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) }, pushDevice = FakePushDevice(),
            accountDeletion = FakeAccountDeletion(), emailLinks = FakeEmailLinks(), tripActions = FakeTripActions(), gmailActions = FakeGmailActions(),
        )
        capture(name, dark = dark) {
            SettingsScreen(account = rememberSignedInAccount(GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id")), user = user, viewModel = viewModel, onBack = {})
        }
    }

    // Settings scrolled to the sender rules: one never-import domain stored.
    @Test
    fun settings_senders() = settingsSenders("settings_senders", dark = false)

    @Test
    fun settings_senders_dark() = settingsSenders("settings_senders_dark", dark = true)

    private fun settingsSenders(name: String, dark: Boolean) {
        val viewModel = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent {
            TravelmoTheme(darkTheme = dark) {
                SettingsScreen(account = rememberSignedInAccount(GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id")), user = user, viewModel = viewModel, onBack = {})
            }
        }
        composeRule.onNodeWithText("Save").performScrollTo()
        composeRule.waitForIdle()
        composeRule.onRoot().captureRoboImage(filePath = "$outputDir/$name.png")
    }

    // Settings scrolled to the car and ride companies: a minicab firm near home.
    @Test
    fun settings_rides() = settingsRides("settings_rides", dark = false)

    @Test
    fun settings_rides_dark() = settingsRides("settings_rides_dark", dark = true)

    private fun settingsRides(name: String, dark: Boolean) {
        val store = FakeTripStore()
        store.rides.value = app.travelmo.data.RideSettings(companies = listOf(app.travelmo.core.RideCompany("Village Cabs", "https://cabs.example/", app.travelmo.core.RideNear.HOME)))
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent {
            TravelmoTheme(darkTheme = dark) {
                SettingsScreen(account = rememberSignedInAccount(GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id")), user = user, viewModel = viewModel, onBack = {})
            }
        }
        composeRule.onNodeWithText("Add").performScrollTo()
        composeRule.waitForIdle()
        composeRule.onRoot().captureRoboImage(filePath = "$outputDir/$name.png")
    }

    // Settings scrolled to Fastmail, not connected: the token field and Connect.
    @Test
    fun settings_fastmail() = fastmail("settings_fastmail", status = null, last = "Connect Fastmail")

    // Fastmail connected, its whole mailbox read, and the note to delete the token after disconnecting.
    @Test
    fun settings_fastmail_connected() = fastmail(
        "settings_fastmail_connected",
        status = FastmailStatus("owner@fastmail.example", BackfillShown(scanned = 840, imported = 9, done = true, updatedAt = FROZEN_NOW)),
        last = "After you disconnect, delete the token in Fastmail.",
    )

    // Scrolled until [last], the section's end, is on screen, so the whole section shows.
    private fun fastmail(name: String, status: FastmailStatus?, last: String) {
        val viewModel = TripsViewModel(
            FakeTripStore(fastmailStatus = status), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) },
            gmailActions = FakeGmailActions(), fastmailActions = FakeFastmailActions(),
        )
        val fontSize = FontSizeState(FontSizeSettings(scale = 1f), onScaleSettled = {}, onPinchEnabledChange = {})
        composeRule.setContent {
            TravelmoTheme(fontSize = fontSize) {
                SettingsScreen(account = rememberSignedInAccount(GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id")), user = user, viewModel = viewModel, onBack = {})
            }
        }
        composeRule.onNodeWithText(last).performScrollTo()
        composeRule.waitForIdle()
        composeRule.onRoot().captureRoboImage(filePath = "$outputDir/$name.png")
    }

    // Settings scrolled to Other email (IMAP), none connected: the app password links, the address and app password fields, and Connect.
    @Test
    fun settings_imap() = imap("settings_imap", mailboxes = emptyList())

    // Two IMAP mailboxes: iCloud's whole mailbox read, and Yahoo's app password turned down by its server; then the form for another.
    @Test
    fun settings_imap_connected() = imap(
        "settings_imap_connected",
        mailboxes = listOf(
            app.travelmo.core.ImapMailbox("owner@icloud.example", "2026-10-01T00:00:00Z", BackfillShown(scanned = 120, imported = 4, done = true, updatedAt = FROZEN_NOW)),
            app.travelmo.core.ImapMailbox("trips@yahoo.example", "2026-10-02T00:00:00Z", loginFailedAt = "2026-10-31T12:00:00Z"),
        ),
    )

    private fun imap(name: String, mailboxes: List<app.travelmo.core.ImapMailbox>) {
        val viewModel = TripsViewModel(
            FakeTripStore(imapStatuses = mailboxes), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) },
            gmailActions = FakeGmailActions(), fastmailActions = FakeFastmailActions(), imapActions = FakeImapActions(),
        )
        val fontSize = FontSizeState(FontSizeSettings(scale = 1f), onScaleSettled = {}, onPinchEnabledChange = {})
        composeRule.setContent {
            TravelmoTheme(fontSize = fontSize) {
                SettingsScreen(account = rememberSignedInAccount(GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id")), user = user, viewModel = viewModel, onBack = {})
            }
        }
        // The section's end on screen, so the whole section shows.
        composeRule.onNodeWithText(runBlocking { getString(Res.string.connect_imap) }).performScrollTo()
        composeRule.waitForIdle()
        composeRule.onRoot().captureRoboImage(filePath = "$outputDir/$name.png")
    }

    // Settings scrolled to the calendar feeds: TripIt's, read yesterday.
    @Test
    fun settings_feeds() = settingsFeeds("settings_feeds", dark = false)

    @Test
    fun settings_feeds_dark() = settingsFeeds("settings_feeds_dark", dark = true)

    private fun settingsFeeds(name: String, dark: Boolean) {
        val store = FakeTripStore()
        store.feedList.value = listOf(
            app.travelmo.data.CalendarFeedShown("f1", "https://www.tripit.com/feed/ical/private/abc/tripit.ics", lastFetchedAt = "2026-11-22T06:00:00Z", lastResult = "2 events imported."),
        )
        val actions = object : app.travelmo.data.FeedActions {
            override val available = true
            override suspend fun add(url: String) = ""
            override suspend fun remove(id: String) {}
        }
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) }, feedActions = actions)
        composeRule.setContent {
            TravelmoTheme(darkTheme = dark) {
                SettingsScreen(account = rememberSignedInAccount(GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id")), user = user, viewModel = viewModel, onBack = {})
            }
        }
        composeRule.onNodeWithText("Add feed").performScrollTo()
        composeRule.waitForIdle()
        composeRule.onRoot().captureRoboImage(filePath = "$outputDir/$name.png")
    }

    // Settings scrolled to Google Calendar: two calendars, one read yesterday.
    @Test
    fun settings_google_calendar() = settingsGoogleCalendar("settings_google_calendar", dark = false)

    @Test
    fun settings_google_calendar_dark() = settingsGoogleCalendar("settings_google_calendar_dark", dark = true)

    private fun settingsGoogleCalendar(name: String, dark: Boolean) {
        val store = FakeTripStore()
        store.calendar.value = app.travelmo.data.GoogleCalendarShown(
            app.travelmo.data.GoogleCalendarConnection(
                "owner@example.com",
                listOf(
                    app.travelmo.data.GoogleCalendarChoice("primary", "Owner", selected = true, lastReadAt = "2026-11-22T06:00:00Z", lastResult = "3 events imported."),
                    app.travelmo.data.GoogleCalendarChoice("travel", "Travel", selected = false),
                ),
            ),
        )
        val actions = object : app.travelmo.data.GoogleCalendarActions {
            override val available = true
            override suspend fun connectUrl() = ""
            override suspend fun select(ids: List<String>) = false
            override suspend fun disconnect() {}
        }
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) }, googleCalendarActions = actions)
        composeRule.setContent {
            TravelmoTheme(darkTheme = dark) {
                SettingsScreen(account = rememberSignedInAccount(GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id")), user = user, viewModel = viewModel, onBack = {})
            }
        }
        composeRule.onNodeWithText("Save choice").performScrollTo()
        composeRule.waitForIdle()
        composeRule.onRoot().captureRoboImage(filePath = "$outputDir/$name.png")
    }

    // Settings scrolled to the calendar export link.
    @Test
    fun settings_export() = settingsExport("settings_export", dark = false)

    @Test
    fun settings_export_dark() = settingsExport("settings_export_dark", dark = true)

    private fun settingsExport(name: String, dark: Boolean) {
        val store = FakeTripStore()
        store.export.value = app.travelmo.data.CalendarExportShown("k3x9q2m7p4w8z5r6t2y8")
        val actions = object : app.travelmo.data.CalendarExportActions {
            override val available = true
            override suspend fun issue() {}
            override suspend fun stop() {}
        }
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) }, calendarExportActions = actions, parserUrl = "https://parser.example")
        composeRule.setContent {
            TravelmoTheme(darkTheme = dark) {
                SettingsScreen(account = rememberSignedInAccount(GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id")), user = user, viewModel = viewModel, onBack = {})
            }
        }
        composeRule.onNodeWithText("Turn off").performScrollTo()
        composeRule.waitForIdle()
        composeRule.onRoot().captureRoboImage(filePath = "$outputDir/$name.png")
    }

    // Settings scrolled to an address to forward bookings to.
    @Test
    fun settings_forward() = settingsForward("settings_forward", dark = false)

    @Test
    fun settings_forward_dark() = settingsForward("settings_forward_dark", dark = true)

    private fun settingsForward(name: String, dark: Boolean) {
        val store = FakeTripStore()
        store.forward.value = app.travelmo.data.Forwarding("trips-k3x9q2m7p4w8z5r6@forward.example")
        val actions = object : app.travelmo.data.ForwardActions {
            override val available = true
            override suspend fun issue() {}
            override suspend fun stop() {}
        }
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) }, forwardActions = actions, forwardOffered = true)
        composeRule.setContent {
            TravelmoTheme(darkTheme = dark) {
                SettingsScreen(account = rememberSignedInAccount(GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id")), user = user, viewModel = viewModel, onBack = {})
            }
        }
        composeRule.onNodeWithText("Turn off").performScrollTo()
        composeRule.waitForIdle()
        composeRule.onRoot().captureRoboImage(filePath = "$outputDir/$name.png")
    }

    // An admin's Access page: those let in, the
    // admin's own address with no Revoke.
    @Test
    fun access() = access("access", dark = false)

    @Test
    fun access_dark() = access("access_dark", dark = true)

    private fun access(name: String, dark: Boolean) {
        val records = mapOf(
            OWNER_EMAIL to mapOf("email" to OWNER_EMAIL) + accessDecision(AccountAccess.APPROVED, "admin", FROZEN_NOW),
            "sam.example@example.com" to waitingRecord("sam.example@example.com", "u-sam"),
            "alex@example.org" to waitingRecord("alex@example.org", "u-alex"),
            "partner@example.com" to accessInvite("partner@example.com", OWNER, FROZEN_NOW),
            "friend@example.com" to mapOf("email" to "friend@example.com") + accessDecision(AccountAccess.APPROVED, OWNER, FROZEN_NOW),
        )
        val store = FakeTripStore(access = records, accessConfig = AccessConfig(listOf(OWNER_EMAIL)))
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        capture(name, dark = dark) { AccessScreen(viewModel = viewModel, onBack = {}) }
    }

    // A new account that never asked: Request access, and the other address
    // it may have been invited at.
    @Test
    fun invite_only() = inviteOnly("invite_only", dark = false)

    @Test
    fun invite_only_dark() = inviteOnly("invite_only_dark", dark = true)

    private fun inviteOnly(name: String, dark: Boolean) {
        val viewModel = TripsViewModel(
            FakeTripStore(access = emptyMap(), hasUserDocument = false), "u-new", "new@example.com", clock = { Instant.parse(FROZEN_NOW) },
            accountDeletion = FakeAccountDeletion(), emailLinks = FakeEmailLinks(),
        )
        capture(name, dark = dark) {
            InviteOnlyScreen(account = rememberSignedInAccount(GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id")), viewModel = viewModel, status = AccountAccess.NONE)
        }
    }

    @Test
    fun deletion_unfinished() = deletionUnfinished("deletion_unfinished", dark = false)

    @Test
    fun deletion_unfinished_dark() = deletionUnfinished("deletion_unfinished_dark", dark = true)

    private fun deletionUnfinished(name: String, dark: Boolean) {
        val viewModel = TripsViewModel(FakeTripStore(), "u-new", "new@example.com", clock = { Instant.parse(FROZEN_NOW) }, accountDeletion = FakeAccountDeletion())
        capture(name, dark = dark) {
            FinishDeletionScreen(account = rememberSignedInAccount(GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id")), viewModel = viewModel)
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
