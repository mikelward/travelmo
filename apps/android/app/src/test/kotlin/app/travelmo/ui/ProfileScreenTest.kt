package app.travelmo.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onLast
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.core.FoundLoyalty
import app.travelmo.core.TravelProfile
import app.travelmo.data.TripStore
import app.travelmo.ui.theme.TravelmoTheme
import io.kotest.matchers.shouldBe
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** The Profile hub, unified loyalty list, people, and home error recovery. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36], qualifiers = "w411dp-h914dp-420dpi")
class ProfileScreenTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private class FailingRemoval(private val fake: FakeTripStore = FakeTripStore()) : TripStore by fake {
        override suspend fun removeFoundLoyalty(uid: String, found: FoundLoyalty) {
            throw IllegalStateException("Couldn't reach the server")
        }
    }

    private fun show(store: TripStore) {
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL)
        composeRule.setContent { TravelmoTheme { ProfileScreen(viewModel = viewModel, onOpenSettings = {}, bottomBar = {}) } }
    }

    private fun openSection(label: String) {
        composeRule.onNodeWithText(label).performClick()
        composeRule.waitForIdle()
    }

    @Test
    fun `a trip that can't be read holds back home over time, but not the corrections, until read again`() {
        val base = FakeTripStore()
        base.rides.value = app.travelmo.data.RideSettings(homes = listOf(app.travelmo.core.HomeCorrection("London", "GB", "2020-01-01")))
        var refuse = true
        val store = object : TripStore by base {
            override suspend fun segmentsOnce(tripId: String): app.travelmo.data.Seen<List<app.travelmo.core.Segment>> {
                if (tripId == "lisbon" && refuse) throw IllegalStateException("refused")
                return base.segmentsOnce(tripId)
            }
        }
        show(store)
        openSection("Home")
        val message = "1 trip couldn't be read, so home can't be worked out yet."
        composeRule.onNode(hasScrollToNodeAction()).performScrollToNode(hasText(message))
        // The correction and its Remove stay, to be changed while home waits.
        composeRule.onNode(hasScrollToNodeAction()).performScrollToNode(hasText("London, GB", substring = true))
        refuse = false
        composeRule.onNode(hasScrollToNodeAction()).performScrollToNode(hasText("Try again"))
        composeRule.onNodeWithText("Try again").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText(message).assertDoesNotExist()
    }

    @Test
    fun `people are listed with the one taken to be the user and This is me moves it`() {
        val store = FakeTripStore(
            people = listOf(
                app.travelmo.core.Person("mum", "Pat Example", bookings = 6),
                app.travelmo.core.Person("me", "Sam Example", bookings = 4, direct = 4),
            ),
        )
        show(store)
        openSection("People")
        composeRule.onNodeWithText("YOU").assertExists()
        composeRule.onNodeWithText("This is me").performClick()
        composeRule.waitForIdle()
        store.peopleState.value.single { it.me }.id shouldBe "mum"
    }

    @Test
    fun `Same person as merges two people into one`() {
        val store = FakeTripStore(
            people = listOf(
                app.travelmo.core.Person("now", "Pat Example", aliases = listOf("P Example"), bookings = 6),
                app.travelmo.core.Person("before", "Pat Sample", bookings = 2),
                app.travelmo.core.Person("me", "Sam Example", bookings = 4, direct = 4),
            ),
        )
        show(store)
        openSection("People")
        composeRule.onNode(hasScrollToNodeAction()).performScrollToNode(hasText("Pat Sample"))
        // Listed most named first: Pat Example, Sam Example, Pat Sample.
        composeRule.onAllNodesWithText("Same person as…")[2].performClick()
        composeRule.onNodeWithText("Pat Sample is the same person as").assertExists()
        composeRule.onAllNodesWithText("Pat Example").onLast().performClick()
        composeRule.waitForIdle()
        store.peopleState.value.map { it.id } shouldBe listOf("now", "me")
        store.peopleState.value.first().aliases shouldBe listOf("P Example", "Pat Sample")
    }

    @Test
    fun `the people picker scrolls to the last of many people`() {
        val many = List(40) { app.travelmo.core.Person("p$it", "Person $it Example", bookings = 100 - it) }
        val store = FakeTripStore(people = many)
        show(store)
        openSection("People")
        composeRule.onNode(hasScrollToNodeAction()).performScrollToNode(hasText("Person 0 Example"))
        composeRule.onAllNodesWithText("Same person as…")[0].performClick()
        composeRule.onNodeWithText("Person 39 Example").performScrollTo().performClick()
        composeRule.waitForIdle()
        store.peopleState.value.map { it.id } shouldBe many.map { it.id }.filter { it != "p0" }
    }

    @Test
    fun `Same person as says a loyalty holder's name is one of the user's people`() {
        val profile = TravelProfile(
            OWNER,
            foundLoyalty = listOf(FoundLoyalty("Example Air Club", "EA 2", messageId = "m2", at = "2026-11-01T00:00:00Z", person = "Samuel Example")),
        )
        val store = FakeTripStore(profile = profile, people = listOf(app.travelmo.core.Person("me", "Sam Example", bookings = 4, direct = 4)))
        show(store)
        openSection("Loyalty programs")
        composeRule.onNodeWithText("Same person as…").performClick()
        composeRule.onNodeWithText("Samuel Example is the same person as").assertExists()
        composeRule.onAllNodesWithText("Sam Example").onLast().performClick()
        composeRule.waitForIdle()
        store.peopleState.value.single().aliases shouldBe listOf("Samuel Example")
        composeRule.onAllNodesWithText("Samuel Example").assertCountEquals(0)
    }

    @Test
    fun `removing a found number goes to the store`() {
        val store = FakeTripStore()
        show(store)
        openSection("Loyalty programs")
        composeRule.onNodeWithText("Cove Club").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithContentDescription("Remove Cove Club").performClick()
        composeRule.waitForIdle()
        store.removedFound.map { it.number } shouldBe listOf("CC 4455")
    }

    @Test
    fun `a removal that fails says so`() {
        show(FailingRemoval())
        openSection("Loyalty programs")
        composeRule.onNodeWithText("Cove Club").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithContentDescription("Remove Cove Club").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Couldn't reach the server").assertExists()
    }

    @Test
    fun `numbers are grouped by whose they are, and saying whose goes to the store`() {
        val store = FakeTripStore()
        show(store)
        openSection("Loyalty programs")
        composeRule.onNodeWithText("EA 7654321").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithContentDescription("Whose is Example Air Miles EA 7654321?").performClick()
        composeRule.onNodeWithText("Mine").performClick()
        composeRule.onNodeWithText("Cove Club").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithContentDescription("Whose is Cove Club CC 4455?").performClick()
        composeRule.onNodeWithText("Cancel").performClick()
        composeRule.waitForIdle()
        // Naming someone new is a text field in a dialog, which Robolectric
        // never idles with; FirestoreTripsTest covers what it saves.
        store.people shouldBe listOf(Triple("Example Air Miles", "EA 7654321", null))
    }

    @Test
    fun `a failing Same person as in Loyalty shows its error in Loyalty`() {
        val profile = TravelProfile(
            OWNER,
            foundLoyalty = listOf(FoundLoyalty("Example Air Club", "EA 2", messageId = "m2", at = "2026-11-01T00:00:00Z", person = "Samuel Example")),
        )
        val fake = FakeTripStore(profile = profile, people = listOf(app.travelmo.core.Person("me", "Sam Example", bookings = 4, direct = 4)))
        val store = object : TripStore by fake {
            override suspend fun setAliases(uid: String, personId: String, aliases: List<String>) {
                throw IllegalStateException("Couldn't save alias")
            }
        }
        show(store)
        openSection("Loyalty programs")
        composeRule.onNodeWithText("Same person as…").performClick()
        composeRule.onAllNodesWithText("Sam Example").onLast().performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Couldn't save alias").assertExists()
    }
}
