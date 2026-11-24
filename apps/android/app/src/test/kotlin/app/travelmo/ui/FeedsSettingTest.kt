package app.travelmo.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.auth.GoogleAccount
import app.travelmo.auth.SignedIn
import app.travelmo.data.CalendarFeedShown
import app.travelmo.data.FeedActions
import app.travelmo.data.TripActionFailed
import app.travelmo.data.calendarFeedOf
import app.travelmo.data.calendarResultOf
import app.travelmo.core.CalendarResult
import app.travelmo.ui.theme.TravelmoTheme
import io.kotest.matchers.shouldBe
import org.json.JSONObject
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** Settings' "Calendar feeds": listed with their last read, added and removed through the parser, as on the web. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36], qualifiers = "w411dp-h914dp-420dpi")
class FeedsSettingTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private val tripIt = CalendarFeedShown("f1", "https://www.tripit.com/feed/ical/private/abc/tripit.ics", lastFetchedAt = "2026-11-22T06:00:00Z", lastResult = "2 events imported.")

    private fun show(store: FakeTripStore, actions: FeedActions = FakeFeedActions(store)) {
        store.feedList.value = listOf(tripIt)
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, feedActions = actions)
        composeRule.setContent {
            TravelmoTheme {
                SettingsScreen(account = rememberSignedInAccount(GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id")), user = SignedIn(OWNER, OWNER_EMAIL), viewModel = viewModel, onBack = {})
            }
        }
    }

    @Test
    fun `lists each feed by its host with its last read, adds one, and removes one`() {
        val store = FakeTripStore()
        show(store)
        composeRule.onNodeWithText("www.tripit.com").performScrollTo()
        composeRule.onNodeWithText("Read 2026-11-22 · 2 events imported.").performScrollTo()
        composeRule.onNodeWithText("Calendar feed link").performScrollTo().performTextInput("webcal://calendar.example/trips.ics")
        composeRule.onNodeWithText("Add feed").performScrollTo().performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("1 event imported.").performScrollTo()
        store.feedList.value!!.map { it.url } shouldBe listOf(tripIt.url, "webcal://calendar.example/trips.ics")
        composeRule.onNodeWithContentDescription("Remove www.tripit.com").performScrollTo().performClick()
        composeRule.waitForIdle()
        store.feedList.value!!.map { it.id } shouldBe listOf("f2")
    }

    @Test
    fun `says why a link was refused`() {
        val store = FakeTripStore()
        show(store, object : FeedActions {
            override val available = true
            override suspend fun add(url: String): String = throw TripActionFailed("That link isn't a calendar.")
            override suspend fun remove(id: String) {}
        })
        composeRule.onNodeWithText("Calendar feed link").performScrollTo().performTextInput("https://example.com/")
        composeRule.onNodeWithText("Add feed").performScrollTo().performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("That link isn't a calendar.").performScrollTo()
    }

    @Test
    fun `reads feeds and the parser's counts as stored and sent`() {
        calendarFeedOf("f1", mapOf("url" to tripIt.url, "addedAt" to "2026-11-01T00:00:00Z", "lastFetchedAt" to "2026-11-22T06:00:00Z", "lastResult" to "2 events imported.")) shouldBe tripIt
        calendarFeedOf("f2", mapOf("label" to "No link")) shouldBe null
        calendarResultOf(JSONObject("""{"id":"f2","imported":2,"not_booking":1,"skipped":0}""")) shouldBe CalendarResult(imported = 2, notBooking = 1)
    }

    private class FakeFeedActions(private val store: FakeTripStore) : FeedActions {
        override val available = true
        override suspend fun add(url: String): String {
            store.feedList.value = store.feedList.value.orEmpty() + CalendarFeedShown("f2", url)
            return "1 event imported."
        }
        override suspend fun remove(id: String) {
            store.feedList.value = store.feedList.value.orEmpty().filter { it.id != id }
        }
    }
}
