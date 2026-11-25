package app.travelmo.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.core.FoundLoyalty
import app.travelmo.data.TripStore
import app.travelmo.ui.theme.TravelmoTheme
import io.kotest.matchers.shouldBe
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** The Profile tab's loyalty numbers found in emails, and what Remove does. */
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

    @Test
    fun `people are listed with the one taken to be the user and This is me moves it`() {
        val store = FakeTripStore(
            people = listOf(
                app.travelmo.core.Person("mum", "Pat Example", bookings = 6),
                app.travelmo.core.Person("me", "Sam Example", bookings = 4, direct = 4),
            ),
        )
        show(store)
        composeRule.onNode(hasScrollToNodeAction()).performScrollToNode(hasText("This is me"))
        composeRule.onNode(hasScrollToNodeAction()).performScrollToNode(hasText("YOU"))
        composeRule.onNodeWithText("YOU").assertExists()
        composeRule.onNodeWithText("This is me").performClick()
        composeRule.waitForIdle()
        store.peopleState.value.single { it.me }.id shouldBe "mum"
    }

    @Test
    fun `removing a found number goes to the store`() {
        val store = FakeTripStore()
        show(store)
        composeRule.onNodeWithContentDescription("Remove Cove Club").performScrollTo().performClick()
        composeRule.waitForIdle()
        store.removedFound.map { it.number } shouldBe listOf("CC 4455")
    }

    @Test
    fun `a removal that fails says so`() {
        show(FailingRemoval())
        composeRule.onNodeWithContentDescription("Remove Cove Club").performScrollTo().performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Couldn't reach the server").performScrollTo()
    }

    @Test
    fun `numbers are grouped by whose they are, and saying whose goes to the store`() {
        val store = FakeTripStore()
        show(store)
        composeRule.onNodeWithText("Sam Example").performScrollTo()
        composeRule.onNodeWithContentDescription("Whose is Example Air Miles EA 7654321?").performScrollTo().performClick()
        composeRule.onNodeWithText("Mine").performClick()
        composeRule.onNodeWithContentDescription("Whose is Cove Club CC 4455?").performScrollTo().performClick()
        composeRule.onNodeWithText("Cancel").performClick()
        composeRule.waitForIdle()
        // Naming someone new is a text field in a dialog, which Robolectric
        // never idles with; FirestoreTripsTest covers what it saves.
        store.people shouldBe listOf(Triple("Example Air Miles", "EA 7654321", null))
    }
}
