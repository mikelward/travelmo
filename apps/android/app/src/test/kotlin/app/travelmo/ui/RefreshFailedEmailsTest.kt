package app.travelmo.ui

import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.auth.GoogleAccount
import app.travelmo.auth.SignedIn
import app.travelmo.core.ParsedRecord
import app.travelmo.core.RefreshShown
import app.travelmo.data.GmailStatus
import app.travelmo.ui.theme.TravelmoTheme
import io.kotest.matchers.shouldBe
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** Settings' Refresh from email, done with emails it couldn't read: listed, each Gmail one opening in Gmail, and Try again. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36], qualifiers = "w411dp-h914dp-420dpi")
class RefreshFailedEmailsTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `lists the emails a refresh could not read and tries them again`() {
        val hotel = ParsedRecord("fastmail-h1", "imported", FROZEN_NOW, source = "fastmail", subject = "Your hotel")
        val store = FakeTripStore(
            refreshProgress = RefreshShown(90, true, FROZEN_NOW, total = 90, failed = 3, failedIds = listOf("booked", "fastmail-h1")),
            parsed = fixtureParsed + hotel,
            gmailStatuses = listOf(GmailStatus("owner@example.com", connectedAt = "2026-10-01T00:00:00Z")),
        )
        val actions = FakeTripActions()
        val opened = mutableListOf<String>()
        val chrome = object : AppChrome by NoAppChrome {
            override fun openLink(url: String, what: String) {
                opened += url
            }
        }
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, tripActions = actions)
        composeRule.setContent {
            TravelmoTheme {
                // Inside the theme, which provides Android's own.
                CompositionLocalProvider(LocalAppChrome provides chrome) {
                    SettingsScreen(account = rememberSignedInAccount(GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id")), user = SignedIn(OWNER, OWNER_EMAIL), viewModel = viewModel, onBack = {})
                }
            }
        }
        composeRule.onNodeWithText("3 emails couldn't be read, even on a second try:", substring = true).performScrollTo()
        composeRule.onNodeWithText("• Your stay at Cove Liverpool · Cove <stay@cove.example>").performScrollTo()
        composeRule.onNodeWithText("• Your hotel").performScrollTo()
        composeRule.onNodeWithText("and 1 more").performScrollTo()
        // Only the Gmail one opens in Gmail.
        composeRule.onAllNodesWithText("Open in Gmail").assertCountEquals(1)
        composeRule.onNodeWithText("Open in Gmail").performScrollTo().performClick()
        opened shouldBe listOf("https://mail.google.com/mail/u/?authuser=owner%40example.com#all/booked")
        composeRule.onNodeWithText("Try again").performScrollTo().performClick()
        composeRule.waitForIdle()
        actions.calls shouldBe listOf("refresh the failed emails")
    }
}
