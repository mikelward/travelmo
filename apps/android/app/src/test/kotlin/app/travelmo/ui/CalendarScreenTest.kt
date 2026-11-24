package app.travelmo.ui

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.ui.theme.TravelmoTheme
import kotlin.time.Instant
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** The Calendar tab's month, switched with the arrows and Today below its top bar, on 1 November 2026. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36], qualifiers = "w411dp-h914dp-420dpi")
class CalendarScreenTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `the arrows and Today switch the month under a Calendar title`() {
        val viewModel = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent {
            var month by remember { mutableStateOf<String?>(null) }
            TravelmoTheme {
                CalendarScreen(viewModel = viewModel, uid = OWNER, month = month, onMonthChange = { month = it }, onOpenTrip = {}, onOpenSettings = {}, bottomBar = {})
            }
        }
        composeRule.onNodeWithText("Calendar").assertExists()
        composeRule.onNodeWithText("November 2026").assertExists()
        composeRule.onNodeWithText("Today").assertIsNotEnabled()
        composeRule.onNodeWithContentDescription("Next month").performClick()
        composeRule.onNodeWithText("December 2026").assertExists()
        composeRule.onNodeWithContentDescription("Previous month").performClick()
        composeRule.onNodeWithContentDescription("Previous month").performClick()
        composeRule.onNodeWithText("October 2026").assertExists()
        composeRule.onNodeWithText("Today").performClick()
        composeRule.onNodeWithText("November 2026").assertExists()
    }
}
