package app.travelmo.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.ui.theme.TravelmoTheme
import app.travelmo.core.LookResult
import app.travelmo.core.LookedEmail
import io.kotest.matchers.shouldBe
import kotlin.time.Instant
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** A trip with no flight back says so on its page, looks for it, adds it or stops once it's one way. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36], qualifiers = "w411dp-h914dp-420dpi")
class JourneyGapTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private val store = FakeTripStore(
        trips = listOf(fixtureBostonTrip),
        segments = mapOf("boston" to fixtureBostonSegments.filter { it.id == "b-out" }),
    )
    private val actions = FakeTripActions().apply {
        looks = listOf(
            // A booking that doesn't fill the gap: looking goes on.
            LookResult(listOf(LookedEmail("m0", "Your Example Air newsletter", "not_booking", "Travelmo import report"), LookedEmail("m1", "Your flight to Boston", "imported")), next = 2),
            LookResult(listOf(LookedEmail("m2", "Your e-ticket", "imported"))),
        )
    }
    private val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) }, tripActions = actions)

    @Test
    fun `the trip page says the flight back is missing and offers what to do`() {
        var added: String? = null
        composeRule.setContent {
            TravelmoTheme {
                TripDetailScreen(viewModel = viewModel, tripId = "boston", uid = OWNER, onBack = {}, onAddBooking = { added = it }, onEditBooking = {}, onMerged = {})
            }
        }
        composeRule.onNodeWithText("No flight from Boston back to London found").performScrollTo()
        composeRule.onNodeWithText("Look for it").performClick()
        composeRule.onNodeWithText("Your Example Air newsletter").assertExists()
        composeRule.onNodeWithText("Keep looking").performScrollTo().performClick()
        composeRule.onNodeWithText("Your e-ticket").assertExists()
        composeRule.onNodeWithText("Keep looking").assertDoesNotExist()
        actions.calls shouldBe listOf("look Boston to London", "look Boston to London from 2")
        composeRule.onNodeWithText("Add it yourself").performClick()
        added shouldBe "2026-11-24"
        composeRule.onNodeWithText("This trip is one way").performClick()
        composeRule.waitForIdle()
        store.rides.value.oneWayTrips shouldBe listOf("boston")
        composeRule.onNodeWithText("No flight from Boston back to London found").assertDoesNotExist()
    }
}
