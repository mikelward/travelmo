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
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertIsNotFocused
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import io.kotest.matchers.shouldBe
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performScrollToNode
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.ui.theme.TravelmoTheme
import kotlin.time.Instant
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.robolectric.shadows.ShadowLooper
import java.util.concurrent.TimeUnit
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
        composeRule.onNodeWithContentDescription("Filters").performClick()
        composeRule.onNodeWithText("Hide cancelled").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Called off").assertDoesNotExist()
        filters.read().hideCancelled shouldBe true
    }

    // The dialog itself is checked on a device: under Robolectric an AlertDialog never goes idle.
    @Test
    fun `the list's menu offers Add a trip`() {
        val viewModel = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent { TravelmoTheme { TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = {}) } }
        composeRule.onNodeWithContentDescription("More options").performClick()
        composeRule.onNodeWithText("Add a trip").assertExists()
    }

    @Test
    fun `a trip page's menu adds a booking, with no floating button`() {
        var added: String? = null
        val viewModel = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent { TravelmoTheme { TripDetailScreen(viewModel = viewModel, tripId = "liverpool", uid = OWNER, onBack = {}, onAddBooking = { added = it }, onEditBooking = {}, onMerged = {}) } }
        composeRule.onAllNodesWithText("Add a booking").assertCountEquals(0)
        composeRule.onNodeWithContentDescription("More options").performClick()
        composeRule.onNodeWithText("Add a booking").performClick()
        added shouldBe "2026-12-12"
    }

    @Test
    fun `the filters go by a trip's own flags at once and record them on trips without`() {
        val fake = FakeTripStore(trips = fixtureTrips + fixtureFlightTrip.copy(title = "Flagged off", allCancelled = true, localOnly = false))
        // Its bookings never answer: only its flags can hide it.
        val store = object : TripStore by fake {
            override fun segments(tripId: String): Flow<List<Segment>> = if (tripId == fixtureFlightTrip.id) flow { awaitCancellation() } else fake.segments(tripId)
            override suspend fun segmentsOnce(tripId: String): app.travelmo.data.Seen<List<Segment>> = if (tripId == fixtureFlightTrip.id) awaitCancellation() else fake.segmentsOnce(tripId)
        }
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) }, listFilterStore = app.travelmo.data.InMemoryListFilterStore())
        composeRule.setContent { TravelmoTheme { TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = {}) } }
        composeRule.onNodeWithText("Flagged off").assertExists()
        composeRule.onNodeWithContentDescription("Filters").performClick()
        composeRule.onNodeWithText("Hide cancelled").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Flagged off").assertDoesNotExist()
        // The trips without flags had their bookings read, and their flags recorded.
        fake.flagsSet["liverpool"] shouldBe app.travelmo.core.TripFlags(allCancelled = false, localOnly = false, travelers = listOf("Sam Example", "Alex Example"), setting = "city")
        fake.flagsSet.keys shouldNotContain fixtureFlightTrip.id
        // Each trip read once for it, however the others' repairs came and went.
        fake.repairs.groupingBy { it }.eachCount().values.all { it == 1 } shouldBe true
    }

    @Test
    fun `a trip none of whose travelers is the user says Watching and the filter hides it`() {
        val store = FakeTripStore(
            trips = fixtureTrips + fixtureFlightTrip.copy(title = "Mum's trip", travelers = listOf("Pat Example")),
            people = listOf(
                app.travelmo.core.Person("me", "Sam Example", bookings = 4, direct = 4),
                app.travelmo.core.Person("mum", "Pat Example", bookings = 1),
            ),
        )
        val filters = app.travelmo.data.InMemoryListFilterStore()
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) }, listFilterStore = filters)
        composeRule.setContent { TravelmoTheme { TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = {}) } }
        composeRule.waitForIdle()
        composeRule.onNode(hasText("Mum's trip") and hasText("Watching", substring = true, ignoreCase = true)).assertExists()
        composeRule.onNodeWithContentDescription("Filters").performClick()
        composeRule.onNodeWithText("Hide trips I’m not on").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Mum's trip").assertDoesNotExist()
        filters.read().hideWatching shouldBe true
    }

    @Test
    fun `a trip that looks like two says Problem until the owner says it is one`() {
        val store = FakeTripStore(
            trips = fixtureTrips + fixtureFlightTrip.copy(title = "Mixed trip", mixed = true) + fixtureFlightTrip.copy(id = "settled", title = "Settled trip", mixed = true, oneTrip = true),
        )
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent { TravelmoTheme { TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = {}) } }
        composeRule.waitForIdle()
        composeRule.onNode(hasText("Mixed trip") and hasText("Problem", substring = true, ignoreCase = true)).assertExists()
        composeRule.onNode(hasText("Settled trip") and hasText("Problem", substring = true, ignoreCase = true)).assertDoesNotExist()
    }

    @Test
    fun `search opens in the top bar and back closes and clears it`() {
        val viewModel = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent { TravelmoTheme { TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = {}) } }
        composeRule.onNodeWithText("Travelmo").assertExists()
        composeRule.onNode(hasSetTextAction()).assertDoesNotExist()
        composeRule.onNodeWithContentDescription("Search trips").performClick()
        composeRule.onNode(hasSetTextAction()).assertIsFocused()
        composeRule.onNodeWithText("Travelmo").assertDoesNotExist()
        composeRule.onNode(hasSetTextAction()).performTextInput("dublin")
        composeRule.onNodeWithText("Paris").assertDoesNotExist()
        composeRule.onNodeWithContentDescription("Close search").performClick()
        viewModel.searchText.value shouldBe ""
        composeRule.onNodeWithText("Travelmo").assertExists()
        composeRule.onNodeWithText("Paris").assertExists()
    }

    @Test
    fun `an empty search closes once a tap outside takes its focus`() {
        val viewModel = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent { TravelmoTheme { TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = {}) } }
        composeRule.onNodeWithContentDescription("Search trips").performClick()
        composeRule.onNode(hasSetTextAction()).assertIsFocused()
        composeRule.onNodeWithText("Upcoming").performClick()
        composeRule.onNode(hasSetTextAction()).assertDoesNotExist()
        composeRule.onNodeWithText("Travelmo").assertExists()
    }

    @Test
    fun `a tap outside the search field takes its focus away`() {
        val viewModel = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent { TravelmoTheme { TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = {}) } }
        composeRule.onNodeWithContentDescription("Search trips").performClick()
        composeRule.onNode(hasSetTextAction()).performTextInput("dublin")
        composeRule.onNode(hasSetTextAction()).assertIsFocused()
        composeRule.onNodeWithText("Upcoming").performClick()
        composeRule.onNode(hasSetTextAction()).assertIsNotFocused()
        // The search stays.
        viewModel.searchText.value shouldBe "dublin"
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
        composeRule.onNodeWithContentDescription("Search trips").performClick()
        composeRule.onNode(hasSetTextAction()).performTextInput("called")
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
    fun `a trip under way the user is only watching offers no check-in`() {
        val store = FakeTripStore(
            trips = fixtureTrips + fixtureFlightTrip,
            segments = fixtureSegments + ("sydney" to listOf(fixtureNextFlight.copy(travelers = listOf("Pat Example")))),
            flightStatuses = mapOf("XX100_2026-11-02_SYD" to fixtureNextFlightStatus),
            people = listOf(
                app.travelmo.core.Person("me", "Sam Example", bookings = 4, direct = 4),
                app.travelmo.core.Person("mum", "Pat Example", bookings = 1),
            ),
        )
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent { TravelmoTheme { TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = {}) } }
        composeRule.onNodeWithText("XX 100 SYD to SIN").assertExists()
        composeRule.onNodeWithText("Online check-in open, usually until departure · Ref XX7Q2P").assertDoesNotExist()
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
        composeRule.onNodeWithContentDescription("Search trips").performClick()
        val search = composeRule.onNode(hasSetTextAction())

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

    @Test
    fun `back to the list after a while on a trip finds its bookings still listened to, not listened to again`() {
        val store = FakeTripStore()
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        var showList by mutableStateOf(true)
        composeRule.setContent {
            TravelmoTheme {
                KeepTripListLive(viewModel)
                if (showList) TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = {})
            }
        }
        composeRule.waitForIdle()
        // Paris is under way, so its card listens to its bookings.
        val listened = store.segmentListens.getValue("paris")
        // The list's clock moves on each minute; the same trips keep the same listeners.
        ShadowLooper.idleMainLooper(61, TimeUnit.SECONDS)
        composeRule.waitForIdle()
        store.segmentListens["paris"] shouldBe listened
        // Off to a trip for longer than the list's own listeners outlast it, and back.
        showList = false
        composeRule.waitForIdle()
        ShadowLooper.idleMainLooper(10, TimeUnit.SECONDS)
        showList = true
        composeRule.waitForIdle()
        store.segmentListens["paris"] shouldBe listened
    }

    @Test
    fun `renders every country landmark with dashed disputed borders`() {
        val dashed = app.travelmo.core.landmarks.filter { it.dashed != null }
        dashed.size shouldBe 7
        composeRule.setContent {
            TravelmoTheme {
                androidx.compose.foundation.layout.Column {
                    for (landmark in dashed) TripLandmark(title = landmark.name, setting = null)
                }
            }
        }
        composeRule.waitForIdle()
    }
}
