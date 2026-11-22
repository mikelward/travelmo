package app.travelmo.ui

import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.BuildConfig
import app.travelmo.ui.theme.TravelmoTheme
import com.mikelward.androidlog.android.ShareOutcome
import io.kotest.matchers.shouldBe
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowToast

/** The overflow every screen ends with: Report a bug shares what the activity provides, and About names the build. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36])
class AppMenuTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private var reports = 0

    private fun show(outcome: ShareOutcome = ShareOutcome.SHARED) {
        composeRule.setContent {
            TravelmoTheme {
                CompositionLocalProvider(LocalReportBug provides { reports++; outcome }) { AppMenu() }
            }
        }
        composeRule.onNodeWithContentDescription("More options").performClick()
        composeRule.waitForIdle()
    }

    @Test
    fun `report a bug shares the provided report`() {
        show()
        composeRule.onNodeWithText("Report a bug").performClick()
        composeRule.waitForIdle()
        reports shouldBe 1
        ShadowToast.shownToastCount() shouldBe 0
    }

    @Test
    fun `a report only the clipboard took says so`() {
        show(ShareOutcome.COPIED_ONLY)
        composeRule.onNodeWithText("Report a bug").performClick()
        composeRule.waitForIdle()
        ShadowToast.getTextOfLatestToast() shouldBe "No app would take the report, so it is on the clipboard instead."
    }

    @Test
    fun `about names the build`() {
        show()
        composeRule.onNodeWithText("About").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Version ${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})").assertExists()
        composeRule.onNodeWithText("OK").performClick()
        composeRule.onNodeWithText("Version", substring = true).assertDoesNotExist()
    }
}
