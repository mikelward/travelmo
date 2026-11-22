package app.travelmo.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.auth.GoogleAccount
import app.travelmo.auth.SignInResult
import app.travelmo.ui.theme.TravelmoTheme
import com.mikelward.androidlog.android.ShareOutcome
import io.kotest.matchers.shouldBe
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** Which sign-in outcomes offer the debug log, and what sharing it says. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36])
class SignInScreenTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private var shares = 0

    private fun show(result: SignInResult, outcome: ShareOutcome = ShareOutcome.SHARED) {
        composeRule.setContent {
            TravelmoTheme {
                SignInScreen(
                    account = GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id"),
                    signIn = { result },
                    shareLog = { shares++; outcome },
                )
            }
        }
        composeRule.onNodeWithText("Sign in with Google").performClick()
        composeRule.waitForIdle()
    }

    @Test
    fun `a refused sign-in says so and shares the debug log`() {
        show(SignInResult.Refused)
        composeRule.onNodeWithText("Google didn’t finish signing you in", substring = true).assertExists()
        composeRule.onNodeWithText("Share the debug log").performClick()
        composeRule.waitForIdle()
        shares shouldBe 1
    }

    @Test
    fun `a failed sign-in offers the debug log and says when only the clipboard took it`() {
        show(SignInResult.Failed, ShareOutcome.COPIED_ONLY)
        composeRule.onNodeWithText("Share the debug log").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("No app would take the report", substring = true).assertExists()
    }

    @Test
    fun `backing out of the picker offers nothing`() {
        show(SignInResult.Canceled)
        composeRule.onNodeWithText("Share the debug log").assertDoesNotExist()
    }

    @Test
    fun `no account on the device offers nothing to share`() {
        show(SignInResult.NoAccount)
        composeRule.onNodeWithText("Share the debug log").assertDoesNotExist()
    }
}
