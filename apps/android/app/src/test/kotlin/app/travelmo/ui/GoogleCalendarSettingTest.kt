package app.travelmo.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.core.net.toUri
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.auth.GoogleAccount
import app.travelmo.auth.SignedIn
import app.travelmo.data.GoogleCalendarActions
import app.travelmo.data.GoogleCalendarChoice
import app.travelmo.data.GoogleCalendarConnection
import app.travelmo.data.GoogleCalendarShown
import app.travelmo.data.googleCalendarOf
import app.travelmo.ui.theme.TravelmoTheme
import io.kotest.matchers.shouldBe
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** Settings' "Google Calendar": connected in the browser, its calendars chosen and saved, and disconnected, as on the web. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36], qualifiers = "w411dp-h914dp-420dpi")
class GoogleCalendarSettingTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private val connection = GoogleCalendarConnection(
        "owner@example.com",
        listOf(
            GoogleCalendarChoice("primary", "Owner", selected = true, lastReadAt = "2026-11-22T06:00:00Z", lastResult = "3 events imported."),
            GoogleCalendarChoice("trips", "Travel", selected = false),
        ),
    )

    private fun show(store: FakeTripStore, actions: FakeCalendarActions) {
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, googleCalendarActions = actions)
        composeRule.setContent {
            TravelmoTheme {
                SettingsScreen(account = rememberSignedInAccount(GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id")), user = SignedIn(OWNER, OWNER_EMAIL), viewModel = viewModel, onBack = {})
            }
        }
    }

    @Test
    fun `connects in the browser`() {
        show(FakeTripStore(), FakeCalendarActions(FakeTripStore()))
        composeRule.onNodeWithText("Connect Google Calendar").performScrollTo().performClick()
        composeRule.waitForIdle()
        shadowOf(composeRule.activity).nextStartedActivity.data shouldBe "https://accounts.example/consent".toUri()
    }

    @Test
    fun `chooses calendars, saves the choice and disconnects`() {
        val store = FakeTripStore()
        store.calendar.value = GoogleCalendarShown(connection)
        val actions = FakeCalendarActions(store)
        show(store, actions)
        composeRule.onNodeWithText("Connected as owner@example.com.").performScrollTo()
        composeRule.onNodeWithText("Read 2026-11-22 · 3 events imported.").performScrollTo()
        composeRule.onNodeWithText("Save choice").performScrollTo()
        composeRule.onNodeWithText("Travel").performClick()
        composeRule.onNodeWithText("Save choice").performClick()
        composeRule.waitForIdle()
        actions.chosen.toSet() shouldBe setOf("primary", "trips")
        composeRule.onNodeWithText("Saved; the newly chosen calendars were read.").performScrollTo()
        composeRule.onNodeWithText("Disconnect").performScrollTo().performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Connect Google Calendar").performScrollTo()
    }

    @Test
    fun `reads the connection from the user document`() {
        val stored = mapOf(
            "googleCalendar" to mapOf(
                "emailAddress" to "owner@example.com",
                "connectedAt" to "2026-11-01T00:00:00Z",
                "calendars" to listOf(
                    mapOf("id" to "primary", "summary" to "Owner", "selected" to true, "lastReadAt" to "2026-11-22T06:00:00Z", "lastResult" to "3 events imported."),
                    mapOf("id" to "trips", "summary" to "Travel", "selected" to false),
                    mapOf("summary" to "No id"),
                ),
            ),
        )
        googleCalendarOf(stored) shouldBe GoogleCalendarShown(connection)
        googleCalendarOf(mapOf()) shouldBe GoogleCalendarShown(null)
    }

    private class FakeCalendarActions(private val store: FakeTripStore) : GoogleCalendarActions {
        var chosen: List<String> = emptyList()
        override val available = true
        override suspend fun connectUrl() = "https://accounts.example/consent"
        override suspend fun select(ids: List<String>): Boolean {
            chosen = ids
            val now = store.calendar.value.connection!!
            store.calendar.value = GoogleCalendarShown(now.copy(calendars = now.calendars.map { it.copy(selected = it.id in ids) }))
            return true
        }
        override suspend fun disconnect() {
            store.calendar.value = GoogleCalendarShown(null)
        }
    }
}
