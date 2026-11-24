package app.travelmo.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollToNode
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.ui.theme.TravelmoTheme
import kotlin.time.Instant
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** The trip list's cards, from the fixtures on 1 November 2026. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36], qualifiers = "w411dp-h914dp-420dpi")
class TripListScreenTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `an upcoming trip's card says when every booking was cancelled`() {
        // York with its train cancelled too, so nothing of it is left.
        val york = fixtureCancelledSegments.map { it.copy(cancelledAt = "2026-10-28T09:00:00Z", cancelledBy = "m-cancel") }
        val store = FakeTripStore(
            trips = fixtureTrips.filter { it.id != "liverpool" } + fixtureCancelledTrip,
            segments = fixtureSegments + ("york" to york),
        )
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent { TravelmoTheme { TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = {}) } }
        composeRule.onNode(hasScrollToNodeAction()).performScrollToNode(hasText("Every booking cancelled"))
        composeRule.onNodeWithText("Every booking cancelled").assertExists()
    }
}
