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
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.swipeUp
import kotlin.time.Instant
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.auth.GoogleAccount
import app.travelmo.auth.SignedIn
import app.travelmo.core.FoundLoyalty
import app.travelmo.core.TravelProfile
import app.travelmo.data.TripStore
import app.travelmo.ui.theme.TravelmoTheme
import io.kotest.matchers.shouldBe
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** Wallet (documents, loyalty, Google Wallet shortcut) and Settings' Home & People sub-pages. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36], qualifiers = "w411dp-h914dp-420dpi")
class ProfileScreenTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private val user = SignedIn(OWNER, OWNER_EMAIL, true)

    private class FailingRemoval(private val fake: FakeTripStore = FakeTripStore()) : TripStore by fake {
        override suspend fun removeFoundLoyalty(uid: String, found: FoundLoyalty) {
            throw IllegalStateException("Couldn't reach the server")
        }
    }

    private fun showWallet(store: TripStore) {
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent { TravelmoTheme { ProfileScreen(viewModel = viewModel, onOpenSettings = {}, bottomBar = {}) } }
        composeRule.waitForIdle()
    }

    private fun showSettings(store: TripStore, section: SettingsSection) {
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL)
        composeRule.setContent {
            TravelmoTheme {
                SettingsSectionScreen(
                    account = rememberSignedInAccount(GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id")),
                    user = user,
                    viewModel = viewModel,
                    section = section,
                    onBack = {},
                )
            }
        }
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
        showSettings(store, SettingsSection.HOME)
        val message = "1 trip couldn't be read, so home can't be worked out yet."
        composeRule.onNodeWithText(message).performScrollTo().assertExists()
        composeRule.onNodeWithText("London, GB", substring = true).performScrollTo().assertExists()
        refuse = false
        composeRule.onNodeWithText("Try again").performScrollTo().performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText(message).assertDoesNotExist()
    }

    @Test
    fun `people shows You at the top, switches with Change, and merges with Also me`() {
        val store = FakeTripStore(
            people = listOf(
                app.travelmo.core.Person("mum", "Pat Example", bookings = 6),
                app.travelmo.core.Person("me", "Sam Example", bookings = 4, direct = 4),
                app.travelmo.core.Person("alt", "S Example", bookings = 1),
            ),
        )
        showSettings(store, SettingsSection.PEOPLE)
        composeRule.onNodeWithText("YOU").assertExists()
        // "Also me" on S Example (second in others after Pat Example) merges into Sam Example.
        composeRule.onAllNodesWithText("Also me")[1].performClick()
        composeRule.waitForIdle()
        store.peopleState.value.map { it.id } shouldBe listOf("mum", "me")
        store.peopleState.value.single { it.id == "me" }.aliases shouldBe listOf("S Example")
        composeRule.onNodeWithText("Also: S Example").assertExists()

        // "Change" switches who You is.
        composeRule.onNodeWithText("Change").performClick()
        composeRule.onNodeWithText("Who are you?").assertExists()
        composeRule.onAllNodesWithText("Pat Example").onLast().performClick()
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
        showSettings(store, SettingsSection.PEOPLE)
        composeRule.onNodeWithText("Pat Sample").performScrollTo().assertExists()
        // Others (excluding You = Sam Example): Pat Example, Pat Sample.
        composeRule.onAllNodesWithText("Same person as…")[1].performScrollTo().performClick()
        composeRule.onNodeWithText("Pat Sample is the same person as").assertExists()
        composeRule.onAllNodesWithText("Pat Example").onLast().performClick()
        composeRule.waitForIdle()
        store.peopleState.value.map { it.id } shouldBe listOf("now", "me")
        store.peopleState.value.first().aliases shouldBe listOf("P Example", "Pat Sample")
        composeRule.onNodeWithText("Also: P Example, Pat Sample").assertExists()
    }

    @Test
    fun `the people picker scrolls to the last of many people`() {
        val many = List(40) { app.travelmo.core.Person("p$it", "Person $it Example", bookings = 100 - it) }
        val store = FakeTripStore(people = many)
        showSettings(store, SettingsSection.PEOPLE)
        // p0 is You (highest bookings); p1 is the first other person.
        composeRule.onAllNodesWithText("Same person as…")[0].performScrollTo().performClick()
        composeRule.onAllNodesWithText("Person 39 Example").onLast().performScrollTo().performClick()
        composeRule.waitForIdle()
        store.peopleState.value.map { it.id } shouldBe many.map { it.id }.filter { it != "p1" }
    }

    @Test
    fun `Same person as says a loyalty holder's name is one of the user's people`() {
        val profile = TravelProfile(
            OWNER,
            foundLoyalty = listOf(FoundLoyalty("Example Air Club", "EA 2", messageId = "m2", at = "2026-11-01T00:00:00Z", person = "Samuel Example")),
        )
        val store = FakeTripStore(profile = profile, people = listOf(app.travelmo.core.Person("me", "Sam Example", bookings = 4, direct = 4)))
        showWallet(store)
        composeRule.onNodeWithText("Samuel Example").performClick()
        composeRule.waitForIdle()
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
        showWallet(store)
        composeRule.onNodeWithText("Cove Club").performScrollTo().performClick()
        composeRule.waitForIdle()
        composeRule.onRoot().performTouchInput { swipeUp() }
        composeRule.waitForIdle()
        composeRule.onNodeWithContentDescription("Remove Cove Club").performScrollTo().performClick()
        composeRule.waitForIdle()
        store.removedFound.map { it.number } shouldBe listOf("CC 4455")
    }

    @Test
    fun `a removal that fails says so`() {
        showWallet(FailingRemoval())
        composeRule.onNodeWithText("Cove Club").performScrollTo().performClick()
        composeRule.waitForIdle()
        composeRule.onRoot().performTouchInput { swipeUp() }
        composeRule.waitForIdle()
        composeRule.onNodeWithContentDescription("Remove Cove Club").performScrollTo().performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Couldn't reach the server").performScrollTo().assertExists()
    }

    @Test
    fun `numbers are grouped by whose they are, and saying whose goes to the store`() {
        val store = FakeTripStore()
        showWallet(store)
        composeRule.onNodeWithText("Sam Example").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("EA 7654321").performScrollTo().performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithContentDescription("Whose is Example Air Miles EA 7654321?").performScrollTo().performClick()
        composeRule.onNodeWithText("Mine").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("You").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Cove Club").performScrollTo().performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithContentDescription("Whose is Cove Club CC 4455?").performScrollTo().performClick()
        composeRule.onNodeWithText("Cancel").performClick()
        composeRule.waitForIdle()
        store.people shouldBe listOf(Triple("Example Air Miles", "EA 7654321", null))
    }

    @Test
    fun `a failing Same person as in Loyalty shows its error in Wallet`() {
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
        showWallet(store)
        composeRule.onNodeWithText("Samuel Example").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Same person as…").performClick()
        composeRule.onAllNodesWithText("Sam Example").onLast().performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Couldn't save alias").performScrollTo().assertExists()
    }

    @Test
    fun `empty wallet offers Google Wallet and manual Add document without requiring TripIt`() {
        val store = FakeTripStore(profile = null)
        showWallet(store)
        composeRule.onNodeWithText("Open Google Wallet").assertExists()
        composeRule.onNodeWithText("No documents yet.", substring = true).performScrollTo().assertExists()
        composeRule.onNodeWithText("TripIt", substring = true).assertDoesNotExist()
    }
}
