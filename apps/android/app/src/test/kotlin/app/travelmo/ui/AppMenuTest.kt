package app.travelmo.ui

import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.ResolveInfo
import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.getUnclippedBoundsInRoot
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import app.travelmo.data.TripActionFailed
import androidx.core.net.toUri
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.BuildConfig
import app.travelmo.log.DebugLogging
import app.travelmo.ui.theme.TravelmoTheme
import com.mikelward.androidlog.android.ShareOutcome
import io.kotest.matchers.shouldBe
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowToast

/**
 * The overflow every screen ends with: Report a bug shares what the activity
 * provides, About names the build, and an update Play reports shows a dot
 * and an item that opens the Play listing.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36])
class AppMenuTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private var reports = 0

    private fun show(outcome: ShareOutcome = ShareOutcome.SHARED, updateAvailable: Boolean = false, open: Boolean = true) {
        composeRule.setContent {
            TravelmoTheme {
                CompositionLocalProvider(LocalReportBug provides { reports++; outcome }, LocalUpdateAvailable provides updateAvailable) { AppMenu() }
            }
        }
        if (open) {
            composeRule.onNodeWithContentDescription("More options").performClick()
            composeRule.waitForIdle()
        }
    }

    private fun tapUpdate() {
        composeRule.onNodeWithText("Update available").performClick()
        composeRule.waitForIdle()
    }

    private fun listingIntent(prefix: String) = Intent(Intent.ACTION_VIEW, "$prefix${composeRule.activity.packageName}".toUri())

    // Robolectric starts any activity unless told to check, as a phone does, that some app takes the intent.
    private fun onlyTheseOpen(vararg intents: Intent) {
        shadowOf(composeRule.activity.application).checkActivities(true)
        val packageManager = shadowOf(composeRule.activity.packageManager)
        for (intent in intents) {
            packageManager.addResolveInfoForIntent(
                intent,
                ResolveInfo().apply {
                    activityInfo = ActivityInfo().apply {
                        packageName = "com.example.store"
                        name = "com.example.store.Listing"
                    }
                },
            )
        }
    }

    @Test
    fun `no update shows no dot and no item`() {
        show(open = false)
        composeRule.onNodeWithContentDescription("Update available").assertDoesNotExist()
        composeRule.onNodeWithContentDescription("More options").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("About").assertExists()
        composeRule.onNodeWithText("Update available").assertDoesNotExist()
    }

    @Test
    fun `an update shows the dot and offers it last`() {
        show(updateAvailable = true, open = false)
        composeRule.onNodeWithContentDescription("Update available").assertExists()
        composeRule.onNodeWithContentDescription("More options").performClick()
        composeRule.waitForIdle()
        val about = composeRule.onNodeWithText("About").getUnclippedBoundsInRoot()
        val update = composeRule.onNodeWithText("Update available").getUnclippedBoundsInRoot()
        (update.top >= about.bottom) shouldBe true
    }

    @Test
    fun `update available opens the Play listing in the Play Store`() {
        show(updateAvailable = true)
        tapUpdate()
        val started = shadowOf(composeRule.activity).nextStartedActivity
        started.action shouldBe Intent.ACTION_VIEW
        started.data shouldBe "market://details?id=${composeRule.activity.packageName}".toUri()
        composeRule.onNodeWithText("Update available").assertDoesNotExist()
    }

    @Test
    fun `without the Play Store the listing opens on the web`() {
        onlyTheseOpen(listingIntent("https://play.google.com/store/apps/details?id="))
        show(updateAvailable = true)
        tapUpdate()
        shadowOf(composeRule.activity).nextStartedActivity.data shouldBe "https://play.google.com/store/apps/details?id=${composeRule.activity.packageName}".toUri()
        ShadowToast.shownToastCount() shouldBe 0
    }

    @Test
    fun `with nothing to open the listing it says so`() {
        onlyTheseOpen()
        show(updateAvailable = true)
        tapUpdate()
        shadowOf(composeRule.activity).nextStartedActivity shouldBe null
        ShadowToast.getTextOfLatestToast() shouldBe "No app can open Google Play."
    }

    private fun tap(text: String) {
        composeRule.onNodeWithText(text).performClick()
        composeRule.waitForIdle()
    }

    private val consent = "To help fix the problem, this shares:"

    @Test
    fun `report a bug says what it shares before it first does`() {
        show()
        tap("Report a bug")
        composeRule.onNodeWithText(consent, substring = true).assertExists()
        composeRule.onNodeWithText("a screenshot of this screen", substring = true).assertExists()
        reports shouldBe 0
    }

    @Test
    fun `cancel shares nothing`() {
        show()
        tap("Report a bug")
        tap("Cancel")
        composeRule.onNodeWithText(consent, substring = true).assertDoesNotExist()
        reports shouldBe 0
    }

    @Test
    fun `continue shares the provided report and asks again next time`() {
        show()
        tap("Report a bug")
        tap("Continue")
        reports shouldBe 1
        ShadowToast.shownToastCount() shouldBe 0
        composeRule.onNodeWithContentDescription("More options").performClick()
        tap("Report a bug")
        composeRule.onNodeWithText(consent, substring = true).assertExists()
        reports shouldBe 1
    }

    @Test
    fun `don't show again skips the question next time`() {
        show()
        tap("Report a bug")
        tap("Don't show again")
        tap("Continue")
        reports shouldBe 1
        composeRule.onNodeWithContentDescription("More options").performClick()
        tap("Report a bug")
        composeRule.onNodeWithText(consent, substring = true).assertDoesNotExist()
        reports shouldBe 2
    }

    @Test
    fun `a report only the clipboard took says so`() {
        DebugLogging.skipReportConsent(composeRule.activity)
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

    // Signed in with a parser: sent to Travelmo.

    private val sentTexts = mutableListOf<Pair<String, String>>()

    private fun showSending(screen: ReportScreen = ReportScreen("Trips"), refuse: String? = null) {
        val sender = BugReportSender { _, text, from ->
            sentTexts += text to from.page
            refuse?.let { throw TripActionFailed(it) }
        }
        composeRule.setContent {
            TravelmoTheme {
                CompositionLocalProvider(LocalReportBug provides { reports++; ShareOutcome.SHARED }, LocalBugReportSender provides sender, LocalReportScreen provides screen) { AppMenu() }
            }
        }
        composeRule.onNodeWithContentDescription("More options").performClick()
        composeRule.waitForIdle()
        tap("Report a bug")
    }

    private val disclosure = "We'll see the app's log and a screenshot of this screen. We use them only to fix the problem."
    private val tripDisclosure =
        "We'll see this trip's bookings, including addresses, confirmation numbers and names, plus the app's log and a screenshot of this screen. We use them only to fix the problem."

    @Test
    fun `signed in a report says what goes and sends what was written`() {
        showSending()
        composeRule.onNodeWithText(disclosure).assertExists()
        composeRule.onNodeWithText(consent, substring = true).assertDoesNotExist()
        composeRule.onNodeWithText("What went wrong?").performTextInput("The map is blank")
        tap("Send")
        composeRule.onNodeWithText("Sent. We'll reply by email.").assertExists()
        sentTexts shouldBe listOf("The map is blank" to "Trips")
        reports shouldBe 0
        tap("Close")
        composeRule.onNodeWithText("Sent. We'll reply by email.").assertDoesNotExist()
    }

    @Test
    fun `nothing written still sends`() {
        showSending()
        tap("Send")
        sentTexts shouldBe listOf("" to "Trips")
    }

    @Test
    fun `from a trip's screens it says the trip's bookings go`() {
        showSending(ReportScreen("Trip") { null })
        composeRule.onNodeWithText(tripDisclosure).assertExists()
        composeRule.onNodeWithText(disclosure).assertDoesNotExist()
    }

    @Test
    fun `a failure says why and keeps the dialog to try again`() {
        showSending(refuse = "You've sent the most reports for today. Try again tomorrow.")
        tap("Send")
        composeRule.onNodeWithText("Couldn't send the report. You've sent the most reports for today. Try again tomorrow.").assertExists()
        composeRule.onNodeWithText("Send").assertExists()
    }

    @Test
    fun `share instead offers the share sheet as before`() {
        DebugLogging.skipReportConsent(composeRule.activity)
        showSending()
        tap("Share instead")
        reports shouldBe 1
        sentTexts shouldBe emptyList()
        composeRule.onNodeWithText(disclosure).assertDoesNotExist()
    }

    @Test
    fun `cancel sends nothing`() {
        showSending()
        tap("Cancel")
        sentTexts shouldBe emptyList()
        reports shouldBe 0
        composeRule.onNodeWithText(disclosure).assertDoesNotExist()
    }
}
