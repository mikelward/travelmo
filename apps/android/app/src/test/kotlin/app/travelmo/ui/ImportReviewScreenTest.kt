package app.travelmo.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.core.SenderPatterns
import app.travelmo.ui.theme.TravelmoTheme
import io.kotest.matchers.shouldBe
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** Import review: what it lists, a search, and its actions. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36], qualifiers = "w411dp-h914dp-420dpi")
class ImportReviewScreenTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private fun show(store: FakeTripStore, review: app.travelmo.data.ImportReview = FakeImportReview()) {
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, importReview = review)
        composeRule.setContent { TravelmoTheme { ImportReviewScreen(viewModel = viewModel, onBack = {}, zone = "Europe/London") } }
    }

    @Test
    fun `lists what did not become a booking, with when it was sent and read, and finds one by name`() {
        show(FakeTripStore())
        composeRule.onNodeWithText("Example Air e-Ticket XY12AB").performScrollTo()
        composeRule.onNodeWithText("Sent 23 May 2026 · Read 23 Nov 2026", substring = true).performScrollTo()
        composeRule.onNodeWithText("Read 23 Nov 2026 · unknown sender", substring = true).performScrollTo()
        composeRule.onNodeWithText("Your stay at Cove Liverpool").assertDoesNotExist()
        composeRule.onNodeWithText("Search").performTextInput("example air")
        composeRule.onNodeWithText("Our winter sale").assertDoesNotExist()
        composeRule.onNodeWithText("Example Air e-Ticket XY12AB").performScrollTo()
    }

    @Test
    fun `imports one anyway and teaches its sender, offering only what the rules don't already say`() {
        val store = FakeTripStore()
        val review = FakeImportReview()
        show(store, review)
        // The newsletter's sender is denied already: only Always is offered.
        composeRule.onNodeWithText("Never import news.example").assertDoesNotExist()
        composeRule.onNodeWithText("Always import news.example").performScrollTo().performClick()
        composeRule.waitForIdle()
        store.patterns.value shouldBe SenderPatterns(allow = listOf("news.example"))
        composeRule.onNodeWithText("Always importing news.example").performScrollTo()
        // Two Gmail messages and a Fastmail one to read again; the TripIt item has no email to read.
        composeRule.onAllNodesWithText("Import anyway").fetchSemanticsNodes().size shouldBe 3
        composeRule.onAllNodesWithText("Import anyway")[1].performScrollTo().performClick()
        composeRule.waitForIdle()
        review.asked shouldBe listOf("ticket")
    }

    @Test
    fun `a Fastmail email says where it came from and can be imported anyway`() {
        val review = FakeImportReview()
        show(FakeTripStore(), review)
        composeRule.onNodeWithText("Sent 2 Nov 2026 · Read 23 Nov 2026 · Example Ferries <sail@ferry.example> · Fastmail · Read, not a booking").performScrollTo()
        composeRule.onNodeWithText("Read 23 Nov 2026 · unknown sender · TripIt · Failed (Couldn't read it)").performScrollTo()
        composeRule.onNodeWithText("Never import ferry.example").performScrollTo()
        composeRule.onAllNodesWithText("Import anyway")[2].performScrollTo().performClick()
        composeRule.waitForIdle()
        review.asked shouldBe listOf("fm-ferry")
    }

    @Test
    fun `an action that works replaces what a failed one said on that row`() {
        val store = FakeTripStore()
        show(store, FailingReview())
        composeRule.onAllNodesWithText("Import anyway")[1].performScrollTo().performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Couldn't reach Travelmo.", substring = true).performScrollTo()
        composeRule.onNodeWithText("Always import air.example").performScrollTo().performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Couldn't reach Travelmo.", substring = true).assertDoesNotExist()
        composeRule.onNodeWithText("Always importing air.example").performScrollTo()
    }

    private class FailingReview : app.travelmo.data.ImportReview {
        override val available = true
        override suspend fun reimport(messageId: String): String = throw app.travelmo.data.TripActionFailed("Couldn't reach Travelmo. Check your connection and try again.")
    }
}
