package app.travelmo.ui

import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.font.FontFamily
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.ui.theme.TravelmoTheme
import app.travelmo.ui.theme.Wordmark
import io.kotest.matchers.shouldBe
import kotlin.time.Instant
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** Every page's top bar sets its title in Fira Sans, the Trips wordmark and other pages' titles alike. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36], qualifiers = "w411dp-h914dp-420dpi")
class AppTopBarTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private val viewModel = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })

    /** Fira Sans, as composition resolves it ([Wordmark] is read from resources). */
    private var wordmark: FontFamily? = null

    private fun show(screen: @Composable () -> Unit) = composeRule.setContent {
        wordmark = Wordmark
        TravelmoTheme { screen() }
    }

    private fun titleFont(title: String): FontFamily? {
        val layouts = mutableListOf<TextLayoutResult>()
        composeRule.onNodeWithText(title).fetchSemanticsNode().config.getOrNull(SemanticsActions.GetTextLayoutResult)?.action?.invoke(layouts)
        return layouts.single().layoutInput.style.fontFamily
    }

    @Test
    fun `Trips' title is in Fira Sans`() {
        show { TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = {}) }
        titleFont("Travelmo") shouldBe wordmark
    }

    @Test
    fun `Calendar's title is in Fira Sans`() {
        show { CalendarScreen(viewModel = viewModel, uid = OWNER, month = null, onMonthChange = {}, onOpenTrip = {}, onOpenSettings = {}, bottomBar = {}) }
        titleFont("Calendar") shouldBe wordmark
    }

    @Test
    fun `Reports' title is in Fira Sans`() {
        show { ReportsScreen(viewModel = viewModel, onOpenTrip = {}, onOpenSettings = {}, bottomBar = {}) }
        titleFont("Reports") shouldBe wordmark
    }

    @Test
    fun `a page opened over the tabs has its title in Fira Sans and a back arrow`() {
        var back = 0
        show { AppTopBar("Settings", navigation = TopBarNavigation.Back { back++ }) }
        titleFont("Settings") shouldBe wordmark
        composeRule.onNodeWithContentDescription("Back").performClick()
        back shouldBe 1
    }

    @Test
    fun `a form's X cancels it`() {
        var closed = 0
        show { AppTopBar("Add booking", navigation = TopBarNavigation.Close { closed++ }) }
        composeRule.onNodeWithContentDescription("Cancel").performClick()
        closed shouldBe 1
    }
}
