package app.travelmo.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.ui.theme.TravelmoTheme
import io.kotest.matchers.shouldBe
import java.time.Instant
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** The Reports tab's days in each country, each opening to its trips. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36], qualifiers = "w411dp-h914dp-420dpi")
class ReportsScreenTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun `a country opens to the trips with days there, each opening its trip`() {
        val opened = mutableListOf<String>()
        val viewModel = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent { TravelmoTheme { ReportsScreen(viewModel = viewModel, onOpenTrip = { opened += it }, bottomBar = {}) } }
        composeRule.onNodeWithText("Portugal").performScrollTo().performClick()
        composeRule.onNodeWithText("Lisbon · ", substring = true).performScrollTo().performClick()
        composeRule.waitForIdle()
        opened shouldBe listOf("lisbon")
    }
}
