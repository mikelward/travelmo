package app.travelmo.ui

import android.content.ClipboardManager
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.auth.GoogleAccount
import app.travelmo.auth.SignedIn
import app.travelmo.data.ForwardActions
import app.travelmo.data.Forwarding
import app.travelmo.data.forwardingOf
import app.travelmo.ui.theme.TravelmoTheme
import io.kotest.matchers.shouldBe
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** Settings' "Forward by email": created, copied, replaced and turned off through the parser, as on the web. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36], qualifiers = "w411dp-h914dp-420dpi")
class ForwardSettingTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private fun show(store: FakeTripStore, offered: Boolean) {
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, forwardActions = FakeForwardActions(store), forwardOffered = offered)
        composeRule.setContent {
            TravelmoTheme {
                SettingsScreen(account = rememberSignedInAccount(GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id")), user = SignedIn(OWNER, OWNER_EMAIL), viewModel = viewModel, onBack = {})
            }
        }
    }

    @Test
    fun `creates an address, copies it, replaces it and turns it off`() {
        val store = FakeTripStore()
        show(store, offered = true)
        composeRule.onNodeWithText("Create forwarding address").performScrollTo().performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("trips-1@forward.example").performScrollTo()

        composeRule.onNodeWithText("Copy address").performScrollTo().performClick()
        composeRule.activity.getSystemService(ClipboardManager::class.java).primaryClip!!.getItemAt(0).text.toString() shouldBe "trips-1@forward.example"

        composeRule.onNodeWithText("Replace address").performScrollTo().performClick()
        composeRule.onNodeWithText("Replace the address?", substring = true).assertExists()
        composeRule.onNodeWithText("Keep").performClick()
        store.forward.value shouldBe Forwarding("trips-1@forward.example")
        composeRule.onNodeWithText("Replace address").performScrollTo().performClick()
        confirm("Replace address")
        composeRule.waitForIdle()
        composeRule.onNodeWithText("trips-2@forward.example").performScrollTo()

        composeRule.onNodeWithText("Turn off").performScrollTo().performClick()
        composeRule.onNodeWithText("Turn off the forwarding address?", substring = true).assertExists()
        confirm("Turn off")
        composeRule.waitForIdle()
        store.forward.value shouldBe Forwarding(null)
        composeRule.onNodeWithText("Create forwarding address").performScrollTo()
    }

    @Test
    fun `is offered only where forwarding is set up, or to someone who has an address`() {
        val store = FakeTripStore()
        show(store, offered = false)
        composeRule.onNodeWithText("Forward by email").assertDoesNotExist()
        store.forward.value = Forwarding("trips-1@forward.example")
        composeRule.waitForIdle()
        composeRule.onNodeWithText("trips-1@forward.example").performScrollTo()
    }

    @Test
    fun `reads the address from the user document`() {
        forwardingOf(mapOf("forward" to mapOf("address" to "trips-1@forward.example", "createdAt" to "2026-11-23T00:00:00Z"))) shouldBe Forwarding("trips-1@forward.example")
        forwardingOf(mapOf("forward" to "nonsense")) shouldBe Forwarding(null)
        forwardingOf(null) shouldBe Forwarding(null)
    }

    // The dialog's button, not the section's button of the same name.
    private fun confirm(label: String) {
        composeRule.onAllNodes(androidx.compose.ui.test.hasText(label) and androidx.compose.ui.test.hasAnyAncestor(androidx.compose.ui.test.isDialog()))[0].performClick()
    }

    private class FakeForwardActions(private val store: FakeTripStore) : ForwardActions {
        private var issued = 0
        override val available = true
        override suspend fun issue() {
            store.forward.value = Forwarding("trips-${++issued}@forward.example")
        }
        override suspend fun stop() {
            store.forward.value = Forwarding(null)
        }
    }
}
