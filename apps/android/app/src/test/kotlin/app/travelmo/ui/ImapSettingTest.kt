package app.travelmo.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.auth.GoogleAccount
import app.travelmo.auth.SignedIn
import app.travelmo.core.ImapMailbox
import app.travelmo.ui.theme.TravelmoTheme
import io.kotest.matchers.shouldBe
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** Settings' "Other email (IMAP)" at its limit: a connected mailbox can still be given a new app password. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36], qualifiers = "w411dp-h914dp-420dpi")
class ImapSettingTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `at the limit, a connected mailbox connects again with a new app password`() {
        val mailboxes = (1..5).map { ImapMailbox("me$it@icloud.com", "2026-11-0${it}T00:00:00Z", loginFailedAt = "2026-11-20T00:00:00Z") }
        val actions = FakeImapActions()
        val viewModel = TripsViewModel(FakeTripStore(imapStatuses = mailboxes), OWNER, OWNER_EMAIL, imapActions = actions)
        composeRule.setContent {
            TravelmoTheme {
                SettingsScreen(account = GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id"), user = SignedIn(OWNER, OWNER_EMAIL), viewModel = viewModel, onBack = {})
            }
        }
        composeRule.onNodeWithText("You can connect up to 5 mailboxes this way.", substring = true).performScrollTo()
        composeRule.onNode(hasSetTextAction() and hasText("Email address")).performScrollTo().performTextInput("me1@icloud.com")
        composeRule.onNode(hasSetTextAction() and hasText("App password")).performScrollTo().performTextInput("new-app-password")
        composeRule.onNodeWithText("Connect").performScrollTo().performClick()
        composeRule.waitForIdle()
        actions.calls shouldBe listOf("connect me1@icloud.com -")
    }
}
