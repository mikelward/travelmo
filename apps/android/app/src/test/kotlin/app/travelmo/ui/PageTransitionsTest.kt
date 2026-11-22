package app.travelmo.ui

import androidx.activity.ComponentActivity
import androidx.compose.material3.Text
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.snapshots.Snapshot
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.navigation3.runtime.NavEntry
import androidx.navigation3.ui.NavDisplay
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** A page opens and closes in the short slide and fade, not Navigation 3's 700 ms default. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36])
class PageTransitionsTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    // A few frames' slack for the clock's frame rounding: still well under Navigation 3's 700 ms default.
    private val SETTLE = 100L

    private val stack = mutableStateListOf<Any>("list")

    private fun show() {
        composeRule.setContent {
            NavDisplay(
                backStack = stack,
                onBack = { stack.removeLastOrNull() },
                transitionSpec = { pageOpens(rtl = false) },
                popTransitionSpec = { pageCloses(rtl = false) },
                predictivePopTransitionSpec = { pageCloses(rtl = false) },
                entryProvider = { key -> NavEntry(key) { Text("page $key") } },
            )
        }
        composeRule.waitForIdle()
        composeRule.mainClock.autoAdvance = false
    }

    // Changed on the UI thread and settled for a frame, so the transition starts at a known time.
    private fun push(key: String) {
        composeRule.runOnUiThread {
            stack.add(key)
            Snapshot.sendApplyNotifications()
        }
        composeRule.mainClock.advanceTimeByFrame()
    }

    private fun pop() {
        composeRule.runOnUiThread {
            stack.removeLastOrNull()
            Snapshot.sendApplyNotifications()
        }
        composeRule.mainClock.advanceTimeByFrame()
    }

    @Test
    fun `a page opens within a quarter of a second and closes faster`() {
        show()
        push("trip")
        composeRule.mainClock.advanceTimeBy(PAGE_OPEN_MILLIS + SETTLE)
        composeRule.onNodeWithText("page trip").assertExists()
        composeRule.onNodeWithText("page list").assertDoesNotExist()

        pop()
        composeRule.mainClock.advanceTimeBy(PAGE_CLOSE_MILLIS + SETTLE)
        composeRule.onNodeWithText("page list").assertExists()
        composeRule.onNodeWithText("page trip").assertDoesNotExist()
    }

    @Test
    fun `mid-close both pages are drawn`() {
        show()
        push("trip")
        composeRule.mainClock.advanceTimeBy(PAGE_OPEN_MILLIS + SETTLE)
        pop()
        composeRule.mainClock.advanceTimeBy(PAGE_CLOSE_MILLIS / 2L)
        composeRule.onNodeWithText("page list").assertExists()
        composeRule.onNodeWithText("page trip").assertExists()
    }
}
