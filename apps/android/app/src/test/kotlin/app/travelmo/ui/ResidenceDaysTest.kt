package app.travelmo.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTextReplacement
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
    fun `counts UK settlement from the move to the UK and lists the days it can't place`() {
        // The Edinburgh stay's booking names no place.
        val store = FakeTripStore()
        store.rides.value = RideSettings(homes = listOf(HomeCorrection("London", "GB", "2024-03-03")))
        show(store)
        composeRule.onNodeWithText("Since you moved to the UK on 3 Mar 2024").performScrollTo()
        composeRule.onNodeWithText("Days we can't place").performScrollTo()
        // Listed there, and as time away.
        composeRule.onAllNodesWithText("31 Oct – 1 Nov 2026 · 2 days · Edinburgh").assertCountEquals(2)
        composeRule.onNodeWithText("Give these trips' bookings a place, or set home on your Profile.").performScrollTo()
    }

    @Test
    fun `counts to a day picked instead of today`() {
        val store = FakeTripStore(trips = fixtureTrips.filter { it.id != "edinburgh" })
        store.rides.value = RideSettings(homes = listOf(HomeCorrection("London", "GB", "2020-01-01")))
        show(store)
        composeRule.onNodeWithText("4 of 180 days · 176 days left").performScrollTo()
        composeRule.onNodeWithText("If you applied on Sun 1 Nov 2026").performScrollTo().performClick()
        composeRule.onNodeWithContentDescription("Switch to text input mode", substring = true).performClick()
        composeRule.onNode(hasSetTextAction() and hasText("Date", substring = true)).performTextReplacement("09012026")
        composeRule.onNodeWithText("OK").performClick()
        // Before the Lisbon trip, nothing away yet.
        composeRule.onNodeWithText("If you applied on Tue 1 Sept 2026").performScrollTo()
        composeRule.onNodeWithText("0 of 180 days · 180 days left").performScrollTo()
    }

    @Test
    fun `lists the latest five stretches and the rest on asking`() {
        // The Lisbon trip again in each of the first seven months of the year.
        val lisbon = fixtureTrips.single { it.id == "lisbon" }
        val months = (1..7).map { "0$it" }
        val trips = months.map { m -> lisbon.copy(id = "l$m", title = "Lisbon $m", start = lisbon.start.replace("-09-", "-$m-"), end = lisbon.end.replace("-09-", "-$m-")) }
        val segments = months.associate { m -> "l$m" to fixtureSegments.getValue("lisbon").map { it.copy(id = "${it.id}-$m", tripId = "l$m", start = it.start.replace("-09-", "-$m-"), end = it.end?.replace("-09-", "-$m-")) } }
        val store = FakeTripStore(trips = trips, segments = segments)
        store.rides.value = RideSettings(homes = listOf(HomeCorrection("London", "GB", "2020-01-01")))
        show(store)
        composeRule.onNodeWithText("Show 2 more").performScrollTo()
        composeRule.onNodeWithText("Portugal · Lisbon 01", substring = true).assertDoesNotExist()
        composeRule.onNodeWithText("Show 2 more").performClick()
        composeRule.onNodeWithText("Portugal · Lisbon 01", substring = true).performScrollTo()
        composeRule.onNodeWithText("Show fewer").performScrollTo().performClick()
        composeRule.onNodeWithText("Portugal · Lisbon 01", substring = true).assertDoesNotExist()
    }

    @Test
    fun `asks for home's country when nothing gives one`() {
        show(FakeTripStore())
        composeRule.onNodeWithText("Days with no trip count as at home, but home has no country yet. Add one on your Profile.").performScrollTo()
    }
}
