package app.travelmo.ui

import io.kotest.matchers.collections.shouldNotContain
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.Flow
import app.travelmo.core.Segment
import app.travelmo.data.TripStore
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.semantics.SemanticsProperties
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
        composeRule.onNode(hasScrollToNodeAction()).performScrollToNode(hasText("York"))
        // Struck through, which a screen reader says.
        composeRule.onNode(hasText("York") and SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "Cancelled")).assertExists()
    }

    @Test
    fun `a trip under way's card says it was cancelled, and nothing of what comes next`() {
        val store = FakeTripStore(
            trips = fixtureTrips + fixtureFlightTrip.copy(cancelledAt = "2026-10-28T09:00:00Z"),
            segments = fixtureSegments + ("sydney" to listOf(fixtureNextFlight)),
        )
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent { TravelmoTheme { TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = {}) } }
        composeRule.onNode(hasText("Singapore") and SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "Cancelled")).assertExists()
        composeRule.onNode(hasText("Dublin") and SemanticsMatcher.expectValue(SemanticsProperties.StateDescription, "Cancelled")).assertDoesNotExist()
        composeRule.onNodeWithText("XX 100 SYD to SIN").assertDoesNotExist()
    }

    @Test
    fun `the filters hide a cancelled trip and keep the choice`() {
        val filters = app.travelmo.data.InMemoryListFilterStore()
        val store = FakeTripStore(
            trips = fixtureTrips + fixtureFlightTrip.copy(title = "Called off", cancelledAt = "2026-10-28T09:00:00Z"),
            segments = fixtureSegments + ("sydney" to listOf(fixtureNextFlight)),
        )
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) }, listFilterStore = filters)
        composeRule.setContent { TravelmoTheme { TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = {}) } }
        composeRule.onNodeWithText("Called off").assertExists()
        composeRule.onNodeWithText("Hide cancelled").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Called off").assertDoesNotExist()
        filters.read().hideCancelled shouldBe true
    }

    @Test
    fun `the filters go by a trip's own flags at once and record them on trips without`() {
        val fake = FakeTripStore(trips = fixtureTrips + fixtureFlightTrip.copy(title = "Flagged off", allCancelled = true, localOnly = false))
        // Its bookings never answer: only its flags can hide it.
        val store = object : TripStore by fake {
            override fun segments(tripId: String): Flow<List<Segment>> = if (tripId == fixtureFlightTrip.id) flow { awaitCancellation() } else fake.segments(tripId)
        }
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) }, listFilterStore = app.travelmo.data.InMemoryListFilterStore())
        composeRule.setContent { TravelmoTheme { TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = {}) } }
        composeRule.onNodeWithText("Flagged off").assertExists()
        composeRule.onNodeWithText("Hide cancelled").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Flagged off").assertDoesNotExist()
        // The trips without flags had their bookings read, and their flags recorded.
        fake.flagsSet["liverpool"] shouldBe app.travelmo.core.TripFlags(allCancelled = false, localOnly = false)
        fake.flagsSet.keys shouldNotContain fixtureFlightTrip.id
        // Each trip read once for it, however the others' repairs came and went.
        fake.repairs.groupingBy { it }.eachCount().values.all { it == 1 } shouldBe true
    }

    @Test
    fun `a search that finds only hidden trips says nothing matches`() {
        val store = FakeTripStore(
            trips = fixtureTrips + fixtureFlightTrip.copy(title = "Called off", cancelledAt = "2026-10-28T09:00:00Z"),
            segments = fixtureSegments + ("sydney" to listOf(fixtureNextFlight)),
        )
        val filters = app.travelmo.data.InMemoryListFilterStore(app.travelmo.core.ListFilters(hideCancelled = true))
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) }, listFilterStore = filters)
        composeRule.setContent { TravelmoTheme { TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = {}) } }
        composeRule.onNodeWithText("Search trips").performTextInput("called")
        composeRule.waitForIdle()
        composeRule.onNodeWithText("No trips match.").assertExists()
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
