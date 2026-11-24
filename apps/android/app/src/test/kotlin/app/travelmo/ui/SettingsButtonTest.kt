package app.travelmo.ui

import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.ui.theme.TravelmoTheme
import io.kotest.matchers.shouldBe
import kotlin.time.Instant
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** Every tab's top bar has the Settings gear, and it opens Settings. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36], qualifiers = "w411dp-h914dp-420dpi")
class SettingsButtonTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private val viewModel = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })

    private fun opensSettings(screen: @Composable (onOpenSettings: () -> Unit) -> Unit) {
        var opened = 0
        composeRule.setContent { TravelmoTheme { screen { opened++ } } }
        composeRule.onNodeWithContentDescription("Settings").performClick()
        opened shouldBe 1
    }

    @Test
    fun `Trips has the Settings gear`() = opensSettings {
        TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = it)
    }

    @Test
    fun `Calendar has the Settings gear`() = opensSettings {
        CalendarScreen(viewModel = viewModel, uid = OWNER, month = null, onMonthChange = {}, onOpenTrip = {}, onOpenSettings = it, bottomBar = {})
    }

    @Test
    fun `Reports has the Settings gear`() = opensSettings {
        ReportsScreen(viewModel = viewModel, onOpenTrip = {}, onOpenSettings = it, bottomBar = {})
    }

    @Test
    fun `Profile has the Settings gear`() = opensSettings {
        ProfileScreen(viewModel = viewModel, onOpenSettings = it, bottomBar = {})
    }
}
