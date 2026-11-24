package app.travelmo.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.ui.theme.TravelmoTheme
import io.kotest.matchers.shouldBe
import kotlin.time.Instant
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** A trip with no flight back says so on its page, finds it in Gmail, adds it or stops once it's one way. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36], qualifiers = "w411dp-h914dp-420dpi")
class JourneyGapTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private val store = FakeTripStore(
        trips = listOf(fixtureBostonTrip),
        segments = mapOf("boston" to fixtureBostonSegments.filter { it.id == "b-out" }),
    )
    private val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })

    @Test
    fun `the trip page says the flight back is missing and offers what to do`() {
        var added: String? = null
        composeRule.setContent {
            TravelmoTheme {
                TripDetailScreen(viewModel = viewModel, tripId = "boston", uid = OWNER, onBack = {}, onAddBooking = { added = it }, onEditBooking = {}, onMerged = {})
            }
        }
        composeRule.onNodeWithText("No flight back to London found").performScrollTo()
        composeRule.onNodeWithText("Find it in Gmail").performClick()
        shadowOf(composeRule.activity).nextStartedActivity.dataString shouldBe "https://mail.google.com/mail/u/0/#search/E5WSJI"
        composeRule.onNodeWithText("Add it yourself").performClick()
        added shouldBe "2026-11-24"
        composeRule.onNodeWithText("This trip is one way").performClick()
        composeRule.waitForIdle()
        store.rides.value.oneWayTrips shouldBe listOf("boston")
        composeRule.onNodeWithText("No flight back to London found").assertDoesNotExist()
    }
}
