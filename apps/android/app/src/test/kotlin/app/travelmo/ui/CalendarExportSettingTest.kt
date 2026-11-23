package app.travelmo.ui

import android.content.ClipboardManager
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.core.net.toUri
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.auth.GoogleAccount
import app.travelmo.auth.SignedIn
import app.travelmo.data.CalendarExportActions
import app.travelmo.data.CalendarExportShown
import app.travelmo.data.calendarExportOf
import app.travelmo.ui.theme.TravelmoTheme
import io.kotest.matchers.shouldBe
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** Settings' "Calendar export": the link created, copied, opened, replaced and turned off through the parser, as on the web. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36], qualifiers = "w411dp-h914dp-420dpi")
class CalendarExportSettingTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private fun show(store: FakeTripStore, parserUrl: String = "https://parser.example") {
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, calendarExportActions = FakeExportActions(store), parserUrl = parserUrl)
        composeRule.setContent {
            TravelmoTheme {
                SettingsScreen(account = GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id"), user = SignedIn(OWNER, OWNER_EMAIL), viewModel = viewModel, onBack = {})
            }
        }
    }

    private fun confirm(label: String) {
        composeRule.onAllNodes(hasText(label) and hasAnyAncestor(isDialog()))[0].performClick()
    }

    @Test
    fun `creates the link, copies it, adds it to Google Calendar, replaces it and turns it off`() {
        val store = FakeTripStore()
        show(store)
        composeRule.onNodeWithText("Create calendar link").performScrollTo().performClick()
        composeRule.waitForIdle()
        val link = "https://parser.example/cal/${TOKEN}1.ics"
        composeRule.onNodeWithText(link).performScrollTo()

        composeRule.onNodeWithText("Copy link").performScrollTo().performClick()
        composeRule.activity.getSystemService(ClipboardManager::class.java).primaryClip!!.getItemAt(0).text.toString() shouldBe link

        composeRule.onNodeWithText("Add to Google Calendar").performScrollTo().performClick()
        shadowOf(composeRule.activity).nextStartedActivity.data shouldBe
            "https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2Fparser.example%2Fcal%2F${TOKEN}1.ics".toUri()

        composeRule.onNodeWithText("Replace link").performScrollTo().performClick()
        confirm("Replace link")
        composeRule.waitForIdle()
        composeRule.onNodeWithText("https://parser.example/cal/${TOKEN}2.ics").performScrollTo()

        composeRule.onNodeWithText("Turn off").performScrollTo().performClick()
        confirm("Turn off")
        composeRule.waitForIdle()
        store.export.value shouldBe CalendarExportShown(null)
        composeRule.onNodeWithText("Create calendar link").performScrollTo()
    }

    @Test
    fun `is not offered by a build with no parser`() {
        show(FakeTripStore(), parserUrl = "")
        composeRule.onNodeWithText("Calendar export").assertDoesNotExist()
    }

    @Test
    fun `reads the token from its document`() {
        calendarExportOf(mapOf("token" to "${TOKEN}1", "createdAt" to "2026-11-23T00:00:00Z")) shouldBe CalendarExportShown("${TOKEN}1")
        calendarExportOf(mapOf("token" to "short")) shouldBe CalendarExportShown(null)
        calendarExportOf(null) shouldBe CalendarExportShown(null)
    }

    private class FakeExportActions(private val store: FakeTripStore) : CalendarExportActions {
        private var issued = 0
        override val available = true
        override suspend fun issue() {
            store.export.value = CalendarExportShown("$TOKEN${++issued}")
        }
        override suspend fun stop() {
            store.export.value = CalendarExportShown(null)
        }
    }

    private companion object {
        const val TOKEN = "k3x9q2m7p4w8z5r6t2y8"
    }
}
