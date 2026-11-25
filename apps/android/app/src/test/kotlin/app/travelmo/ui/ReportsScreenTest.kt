package app.travelmo.ui

import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.core.HomeCorrection
import app.travelmo.data.RideSettings
import app.travelmo.core.Segment
import app.travelmo.core.SegmentType
import app.travelmo.core.Trip
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
    fun `asks for home's country when every day counted is at home`() {
        // Only a class near home, and a home with no country: no day is in any country.
        val store = FakeTripStore(
            trips = listOf(Trip("class", "Pottery class", "2026-10-10", "2026-10-10", OWNER)),
            segments = mapOf("class" to listOf(Segment("c", "class", SegmentType.ACTIVITY, "Pottery class", "2026-10-10T10:00:00+01:00", "2026-10-10T12:00:00+01:00"))),
        )
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent { TravelmoTheme { ReportsScreen(viewModel = viewModel, onOpenTrip = {}, onOpenSettings = {}, bottomBar = {}) } }
        composeRule.onNodeWithText("Days in each country").performScrollTo()
    }
}
