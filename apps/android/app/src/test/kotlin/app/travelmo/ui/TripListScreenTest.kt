package app.travelmo.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.kotest.matchers.shouldBe
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextClearance
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

    @Test
    fun `a trip under way's card names the next booking then when then the flight's gate`() {
        val viewModel = TripsViewModel(flightTripStore(), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent { TravelmoTheme { TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = {}) } }
        composeRule.onNodeWithText("XX 100 SYD to SIN").assertExists()
        composeRule.onNodeWithText("Departs in 3 h · Mon 2 Nov 02:00").assertExists()
        composeRule.onNodeWithText("Terminal 1 · Gate 8").assertExists()
    }

    @Test
    fun `I've checked in on the card takes its check-in line away`() {
        val store = flightTripStore()
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent { TravelmoTheme { TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = {}) } }
        composeRule.onNodeWithText("Online check-in open, usually until departure · Ref XX7Q2P").assertExists()
        composeRule.onNodeWithText("I’ve checked in").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Online check-in open, usually until departure · Ref XX7Q2P").assertDoesNotExist()
        composeRule.onNodeWithText("I’ve checked in").assertDoesNotExist()
        store.checkedIn.value shouldBe mapOf("sydney" to setOf("s-flight"))
    }

    @Test
    fun `a check-in mark that could not be saved says so and leaves the line`() {
        val store = flightTripStore().apply { failCheckedIn = true }
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent { TravelmoTheme { TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = {}) } }
        composeRule.onNodeWithText("I’ve checked in").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Couldn't save your check-in. Try again.").assertExists()
        composeRule.onNodeWithText("Online check-in open, usually until departure · Ref XX7Q2P").assertExists()
    }

    @Test
    fun `searching finds trips by a booking's provider or place and by date`() {
        val viewModel = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent { TravelmoTheme { TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = {}) } }
        val search = composeRule.onNodeWithText("Search trips")

        // Avanti runs the train to Liverpool; Dublin's flight lands at DUB.
        search.performTextInput("avanti")
        composeRule.waitUntil { viewModel.searchResult.value?.bookingsSearched == true }
        composeRule.onNodeWithText("Liverpool").assertExists()
        composeRule.onNodeWithText("Dublin").assertDoesNotExist()

        search.performTextClearance()
        search.performTextInput("DUB")
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Dublin").assertExists()
        composeRule.onNodeWithText("Liverpool").assertDoesNotExist()

        search.performTextClearance()
        search.performTextInput("March 2026")
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Amsterdam").assertExists()
        composeRule.onNodeWithText("Dublin").assertDoesNotExist()

        search.performTextClearance()
        search.performTextInput("madrid")
        composeRule.waitForIdle()
        composeRule.onNodeWithText("No trips match.").assertExists()
    }
}
