package app.travelmo.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.core.HomeCorrection
import app.travelmo.data.RideSettings
import app.travelmo.ui.theme.TravelmoTheme
import java.time.Instant
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** The Reports tab's residence and visa days, counted from the fixtures' trips and home on 1 November 2026. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36], qualifiers = "w411dp-h914dp-420dpi")
class ResidenceDaysTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private fun show(store: FakeTripStore) {
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent { TravelmoTheme { ReportsScreen(viewModel = viewModel, onOpenTrip = {}, bottomBar = {}) } }
    }

    @Test
    fun `counts time away for UK settlement and days in for Schengen, from home and the trips`() {
        // Without the Edinburgh stay, whose booking names no place.
        val store = FakeTripStore(trips = fixtureTrips.filter { it.id != "edinburgh" })
        store.rides.value = RideSettings(homes = listOf(HomeCorrection("London", "GB", "2020-01-01")))
        show(store)
        composeRule.onNodeWithText("Residence and visa days").performScrollTo()
        // A week in Lisbon: the days of leaving and coming back are not absences.
        composeRule.onNodeWithText("4 of 180 days · 176 days left").performScrollTo()
        composeRule.onNodeWithText("15–18 Sept 2026 · 4 days · Portugal · Lisbon").performScrollTo()
        composeRule.onNodeWithText("UK settlement (indefinite leave to remain)").performScrollTo().performClick()
        composeRule.onNodeWithText("Schengen short stays (90 days in 180)").performClick()
        // Entering and leaving both count as days in the area.
        composeRule.onNodeWithText("6 of 90 days · 84 days left").performScrollTo()
    }

    @Test
    fun `asks for home's country when nothing gives one`() {
        show(FakeTripStore())
        composeRule.onNodeWithText("Days with no trip count as at home, but home has no country yet. Add one on your Profile.").performScrollTo()
    }
}
