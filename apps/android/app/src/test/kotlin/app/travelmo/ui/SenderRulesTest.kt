package app.travelmo.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.auth.GoogleAccount
import app.travelmo.auth.SignedIn
import app.travelmo.core.SenderPatterns
import app.travelmo.ui.theme.TravelmoTheme
import io.kotest.matchers.shouldBe
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** Settings' sender rules: the stored lists, edited and saved as the web saves them. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36], qualifiers = "w411dp-h914dp-420dpi")
class SenderRulesTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `shows the stored rules and saves them as typed, one domain a line`() {
        val store = FakeTripStore()
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL)
        composeRule.setContent {
            TravelmoTheme {
                SettingsScreen(account = GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id"), user = SignedIn(OWNER, OWNER_EMAIL), viewModel = viewModel, onBack = {})
            }
        }
        composeRule.onNodeWithText("news.example").performScrollTo()
        composeRule.onNodeWithText("Always import").performScrollTo().performTextReplacement(" Air.Example \n\ncove.example")
        composeRule.onNodeWithText("Save").performScrollTo().performClick()
        composeRule.waitForIdle()
        store.patterns.value shouldBe SenderPatterns(allow = listOf("air.example", "cove.example"), deny = listOf("news.example"))
        composeRule.onNodeWithText("Saved").performScrollTo()
    }

    @Test
    fun `locks the lists while they save, so nothing typed then is lost`() {
        val store = FakeTripStore()
        val gate = kotlinx.coroutines.CompletableDeferred<Unit>()
        store.senderSave = gate
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL)
        composeRule.setContent {
            TravelmoTheme {
                SettingsScreen(account = GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id"), user = SignedIn(OWNER, OWNER_EMAIL), viewModel = viewModel, onBack = {})
            }
        }
        composeRule.onNodeWithText("Always import").performScrollTo().performTextReplacement("air.example")
        composeRule.onNodeWithText("Save").performScrollTo().performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("air.example").assertIsNotEnabled()
        composeRule.onNodeWithText("news.example").assertIsNotEnabled()
        gate.complete(Unit)
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Saved").performScrollTo()
        composeRule.onNodeWithText("air.example").assertIsEnabled()
    }
}
