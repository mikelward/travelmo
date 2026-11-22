package app.travelmo.ui

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.hasScrollAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.auth.GoogleAccount
import app.travelmo.ui.theme.TravelmoTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/**
 * About's licenses action opens the Licenses screen in place of the app,
 * signed in or not; it lists the bundled libraries and the font, and Back
 * returns to the app as it was.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36])
class LicensesScreenTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private var open by mutableStateOf(false)
    private var appKey by mutableStateOf("signedIn:owner")

    private fun host(app: @Composable () -> Unit) {
        composeRule.setContent {
            TravelmoTheme {
                LicensesHost(open = open, onOpenChange = { open = it }, appKey = appKey, app = app)
            }
        }
    }

    private fun openFromAbout() {
        composeRule.onNodeWithContentDescription("More options").performClick()
        composeRule.onNodeWithText("About").performClick()
        composeRule.onNodeWithText("Open-source licenses").performClick()
        composeRule.waitForIdle()
    }

    // The list is parsed off the main thread, so it fills in after the title.
    private fun scrollTo(name: String) {
        composeRule.waitUntil(5_000) { composeRule.onAllNodes(hasScrollAction()).fetchSemanticsNodes().any { it.children.isNotEmpty() } }
        composeRule.onNode(hasScrollAction()).performScrollToNode(hasText(name))
        composeRule.onNodeWithText(name).assertExists()
    }

    @Test
    fun `about opens the licenses from the sign-in screen`() {
        host { SignInScreen(account = GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id")) }
        openFromAbout()
        composeRule.onNodeWithText("Open-source licenses").assertExists()
        scrollTo("Compose Material3 Components")
        scrollTo("Fira Sans")
        composeRule.onNodeWithContentDescription("Back").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Sign in with Google").assertExists()
    }

    @Test
    fun `a library's details name its authors and license`() {
        host { AppMenu() }
        openFromAbout()
        scrollTo("Fira Sans")
        composeRule.onNodeWithText("Fira Sans").performClick()
        composeRule.onNodeWithText("By The Mozilla Foundation and Telefonica S.A.").assertExists()
        composeRule.onNodeWithText("SIL Open Font License 1.1").assertExists()
        composeRule.onNodeWithText("OK").performClick()
        composeRule.onNodeWithText("SIL Open Font License 1.1").assertDoesNotExist()
    }

    @Test
    fun `back returns to the app as it was`() {
        host {
            var taps by rememberSaveable { mutableIntStateOf(0) }
            Column {
                Button(onClick = { taps++ }) { Text("Tapped $taps") }
                AppMenu()
            }
        }
        composeRule.onNodeWithText("Tapped 0").performClick()
        openFromAbout()
        composeRule.onNodeWithText("Tapped", substring = true).assertDoesNotExist()
        composeRule.onNodeWithContentDescription("Back").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Tapped 1").assertExists()
    }

    @Test
    fun `another account starts afresh`() {
        host {
            var taps by rememberSaveable { mutableIntStateOf(0) }
            Button(onClick = { taps++ }) { Text("Tapped $taps") }
        }
        composeRule.onNodeWithText("Tapped 0").performClick()
        composeRule.onNodeWithText("Tapped 1").assertExists()
        appKey = "signedOut"
        composeRule.waitForIdle()
        appKey = "signedIn:owner"
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Tapped 0").assertExists()
    }
}
