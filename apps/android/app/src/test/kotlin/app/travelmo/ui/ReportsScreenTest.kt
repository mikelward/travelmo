package app.travelmo.ui

import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.core.CountryCounting
import app.travelmo.core.HomeCorrection
import app.travelmo.core.Place
import app.travelmo.data.InMemoryCountingStore
import app.travelmo.data.RideSettings
import app.travelmo.data.TripStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.filterNotNull
import app.travelmo.core.Segment
import app.travelmo.core.SegmentType
import app.travelmo.core.Trip
import app.travelmo.core.CountryReport
import app.travelmo.core.TravelReport
import app.travelmo.core.YearReport
import app.travelmo.data.InMemoryReportSnapshotStore
import app.travelmo.data.decodeReportSnapshot
import app.travelmo.data.encodeReportSnapshot
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.flow
import app.travelmo.ui.theme.TravelmoTheme
import io.kotest.matchers.shouldBe
import kotlin.time.Instant
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** The Reports tab's days in each country, each opening to its stays. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36], qualifiers = "w411dp-h914dp-420dpi")
class ReportsScreenTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `a country opens to its stays, each opening the trip that took the user there`() {
        val opened = mutableListOf<String>()
        val viewModel = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent { TravelmoTheme { ReportsScreen(viewModel = viewModel, onOpenTrip = { opened += it }, onOpenSettings = {}, bottomBar = {}) } }
        openSection("Days in each country")
        composeRule.onNodeWithText("Portugal").performScrollTo().performClick()
        composeRule.onNodeWithText("14–19 Sept 2026 · 6 days").performScrollTo()
        // The stay's trip, above the favorite places that name it too.
        composeRule.onAllNodesWithText("Lisbon")[0].performClick()
        composeRule.waitForIdle()
        opened shouldBe listOf("lisbon")
    }

    @Test
    fun `days that can't be placed open each of their trips`() {
        val opened = mutableListOf<String>()
        // Two weekends back to back whose stays name no place: one run of days, two trips.
        val stay = { id: String, start: String, end: String -> Segment("$id-stay", id, SegmentType.LODGING, "Example Inn", "${start}T15:00:00+00:00", "${end}T11:00:00+00:00") }
        val store = FakeTripStore(
            trips = listOf(Trip("first", "First weekend", "2026-10-09", "2026-10-10", OWNER), Trip("second", "Second weekend", "2026-10-11", "2026-10-12", OWNER)),
            segments = mapOf("first" to listOf(stay("first", "2026-10-09", "2026-10-10")), "second" to listOf(stay("second", "2026-10-11", "2026-10-12"))),
        )
        store.rides.value = RideSettings(homes = listOf(HomeCorrection("London", "GB", "2020-01-01")))
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent { TravelmoTheme { ReportsScreen(viewModel = viewModel, onOpenTrip = { opened += it }, onOpenSettings = {}, bottomBar = {}) } }
        openSection("Days in each country")
        composeRule.onNodeWithText("9–12 Oct 2026 · 4 days").performScrollTo()
        composeRule.onNodeWithText("Second weekend").performClick()
        composeRule.onNodeWithText("First weekend").performClick()
        composeRule.waitForIdle()
        opened shouldBe listOf("second", "first")
    }

    @Test
    fun `downloads trips by place and abroad only through the file picker`() {
        val viewModel = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent { TravelmoTheme { ReportsScreen(viewModel = viewModel, onOpenTrip = {}, onOpenSettings = {}, bottomBar = {}) } }
        composeRule.onNode(hasScrollToNodeAction()).performScrollToNode(hasText("Download CSV"))
        composeRule.onNodeWithText("One row per place").performClick()
        composeRule.onNodeWithText("Outside my home country only").performClick()
        composeRule.onNodeWithText("Outside my home country only").assertIsOn()
        // Trips up to today unless another day is picked.
        composeRule.onNodeWithText("Trips starting up to", substring = true).assertExists()
        composeRule.onNodeWithText("Download CSV").performClick()
        composeRule.waitForIdle()
        val asked = shadowOf(composeRule.activity).nextStartedActivityForResult.intent
        asked.action shouldBe Intent.ACTION_CREATE_DOCUMENT
        asked.type shouldBe "text/csv"
        asked.getStringExtra(Intent.EXTRA_TITLE) shouldBe "travelmo-places.csv"
    }

    @Test
    fun `works out days in each country only once its section is opened`() {
        val viewModel = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent { TravelmoTheme { ReportsScreen(viewModel = viewModel, onOpenTrip = {}, onOpenSettings = {}, bottomBar = {}) } }
        composeRule.onNodeWithText("Days in each country", substring = true).performScrollTo()
        composeRule.onNodeWithText("Part days").assertDoesNotExist()
        openSection("Days in each country")
        composeRule.onNodeWithText("Part days").performScrollTo()
        // And closes again.
        openSection("Days in each country")
        composeRule.onNodeWithText("Part days").assertDoesNotExist()
    }

    @Test
    fun `says there is nothing to count in each country before any trip has begun`() {
        // Only a trip still ahead.
        val store = FakeTripStore(trips = listOf(Trip("later", "Later", "2027-01-08", "2027-01-10", OWNER)), segments = emptyMap())
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent { TravelmoTheme { ReportsScreen(viewModel = viewModel, onOpenTrip = {}, onOpenSettings = {}, bottomBar = {}) } }
        openSection("Days in each country")
        composeRule.onNodeWithText("No trip has begun yet, so there are no days to count.").performScrollTo()
        composeRule.onNodeWithText("Working it out…").assertDoesNotExist()
    }

    @Test
    fun `offers the trips download only once home's corrections have answered`() {
        val settings = MutableStateFlow<RideSettings?>(null)
        val store = object : TripStore by FakeTripStore() {
            override fun rideSettings(uid: String): Flow<RideSettings?> = settings.filterNotNull()
        }
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent { TravelmoTheme { ReportsScreen(viewModel = viewModel, onOpenTrip = {}, onOpenSettings = {}, bottomBar = {}) } }
        composeRule.onNode(hasScrollToNodeAction()).performScrollToNode(hasText("Trips per year"))
        composeRule.onNodeWithText("Download CSV").assertDoesNotExist()
        settings.value = RideSettings(homes = listOf(HomeCorrection("London", "GB", "2020-01-01")))
        composeRule.onNode(hasScrollToNodeAction()).performScrollToNode(hasText("Download CSV"))
    }

    /** Opens (or closes) a section that is worked out only when opened. */
    private fun openSection(title: String) {
        composeRule.onNodeWithText(title, substring = true).performScrollTo().performClick()
        composeRule.waitForIdle()
    }

    @Test
    fun `asks for home's country when every day counted is at home`() {
        // Only a class near home, and a home with no country: no day is in any country.
        val store = FakeTripStore(
            trips = listOf(Trip("class", "Pottery class", "2026-10-10", "2026-10-10", OWNER)),
            segments = mapOf("class" to listOf(Segment("c", "class", SegmentType.ACTIVITY, "Pottery class", "2026-10-10T10:00:00+01:00", "2026-10-10T12:00:00+01:00"))),
        )
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent { TravelmoTheme { ReportsScreen(viewModel = viewModel, onOpenTrip = {}, onOpenSettings = {}, bottomBar = {}) } }
        openSection("Days in each country")
        composeRule.onNodeWithText("Days in each country", substring = true).performScrollTo()
    }

    @Test
    fun `counts nights instead of part days when picked, and keeps the choice`() {
        val counting = InMemoryCountingStore()
        val viewModel = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) }, countingStore = counting)
        composeRule.setContent { TravelmoTheme { ReportsScreen(viewModel = viewModel, onOpenTrip = {}, onOpenSettings = {}, bottomBar = {}) } }
        openSection("Days in each country")
        composeRule.onNodeWithText("Part days").performScrollTo().performClick()
        composeRule.onNodeWithText("Nights").performClick()
        composeRule.onNodeWithText("Portugal").performScrollTo().performClick()
        // Five nights in Lisbon, read as a hotel booking: to the morning after the last.
        composeRule.onNodeWithText("14–19 Sept 2026 · 5 nights").performScrollTo()
        counting.read() shouldBe CountryCounting.NIGHTS
    }

    @Test
    fun `keeps the count picker when whole days leave nothing to show`() {
        // Away and back over the last two days: both cross a border, so neither is a whole day.
        val flight = { id: String, from: String, to: String, start: String, end: String ->
            Segment(id, "paris", SegmentType.FLIGHT, "XX 1 $from to $to", start, end, origin = Place(from, code = from), destination = Place(to, code = to))
        }
        val store = FakeTripStore(
            trips = listOf(Trip("paris", "Paris", "2026-10-31", "2026-11-01", OWNER)),
            segments = mapOf("paris" to listOf(flight("out", "LHR", "CDG", "2026-10-31T09:00:00+00:00", "2026-10-31T11:20:00+01:00"), flight("back", "CDG", "LHR", "2026-11-01T08:00:00+01:00", "2026-11-01T08:20:00+00:00"))),
        )
        store.rides.value = RideSettings(homes = listOf(HomeCorrection("London", "GB", "2020-01-01")))
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) }, countingStore = InMemoryCountingStore(CountryCounting.WHOLE))
        composeRule.setContent { TravelmoTheme { ReportsScreen(viewModel = viewModel, onOpenTrip = {}, onOpenSettings = {}, bottomBar = {}) } }
        openSection("Days in each country")
        composeRule.onNodeWithText("Whole days").performScrollTo()
    }

    @Test
    fun `draws the last counts and map at once, before the bookings answer`() {
        // Bookings that never answer, and counts saved on an earlier visit.
        val store = object : TripStore by FakeTripStore() {
            override fun segments(tripId: String): Flow<List<Segment>> = flow { awaitCancellation() }
            override suspend fun segmentsOnce(tripId: String): app.travelmo.data.Seen<List<Segment>> = awaitCancellation()
        }
        val last = TravelReport(7, 30, listOf(CountryReport("PT", 20, 5), CountryReport("FR", 8, 2)), listOf(YearReport("2026", 7, 30, 2)), emptyList(), emptyList(), 0, 0, 0)
        val snapshots = InMemoryReportSnapshotStore(encodeReportSnapshot(OWNER, last))
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) }, reportSnapshotStore = snapshots)
        composeRule.setContent { TravelmoTheme { ReportsScreen(viewModel = viewModel, onOpenTrip = {}, onOpenSettings = {}, bottomBar = {}) } }
        composeRule.onNodeWithText("7 trips · 30 days away · 2 countries").assertExists()
        // Another year, and the trips download, wait for the bookings.
        composeRule.onNodeWithText("All years").assertIsNotEnabled()
        composeRule.onNode(hasScrollToNodeAction()).performScrollToNode(hasText("Trips per year"))
        composeRule.onNodeWithText("Download CSV").assertDoesNotExist()
    }

    @Test
    fun `keeps the counts and map worked out for the next visit`() {
        val snapshots = InMemoryReportSnapshotStore()
        val viewModel = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) }, reportSnapshotStore = snapshots)
        composeRule.setContent { TravelmoTheme { ReportsScreen(viewModel = viewModel, onOpenTrip = {}, onOpenSettings = {}, bottomBar = {}) } }
        composeRule.onNodeWithText("4 trips · 16 days away · 3 countries").assertExists()
        composeRule.waitForIdle()
        decodeReportSnapshot(snapshots.read(), OWNER)?.trips shouldBe 4
    }
}
