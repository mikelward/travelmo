package app.travelmo.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasScrollToNodeAction
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.core.HomeCorrection
import app.travelmo.data.RideSettings
import app.travelmo.ui.theme.TravelmoTheme
import io.kotest.matchers.shouldBe
import java.time.LocalDate
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** The Profile's home: worked out with the user's corrections over it, which are added and removed there, as on the web. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36], qualifiers = "w411dp-h914dp-420dpi")
class HomeCorrectionsTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private val london = HomeCorrection("London", "GB", "2022-01-15")

    // The Profile is a lazy list: an item is there once the list has scrolled to it.
    private fun item(text: String): SemanticsNodeInteraction {
        composeRule.onNode(hasScrollToNodeAction()).performScrollToNode(hasText(text))
        return composeRule.onNodeWithText(text)
    }

    private fun show(): FakeTripStore {
        val store = FakeTripStore()
        store.rides.value = RideSettings(homes = listOf(london))
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL)
        composeRule.setContent { TravelmoTheme { ProfileScreen(viewModel = viewModel, bottomBar = {}) } }
        return store
    }

    @Test
    fun `shows home with the corrections and removes one`() {
        val store = show()
        item("Home: London since Jan 2022")
        item("London, GB from 15 Jan 2022")
        composeRule.onNode(hasScrollToNodeAction()).performScrollToNode(hasContentDescription("Remove London, GB from 15 Jan 2022"))
        composeRule.onNodeWithContentDescription("Remove London, GB from 15 Jan 2022").performClick()
        composeRule.waitForIdle()
        store.rides.value.homes shouldBe emptyList()
    }

    @Test
    fun `adds a correction from a city a country and a date`() {
        val store = show()
        item("City").performTextInput("Elsternwick")
        item("Country").performTextInput("Australia")
        item("From…").performClick()
        composeRule.onAllNodes(hasText("OK") and hasAnyAncestor(isDialog()))[0].performClick()
        item("Set").performClick()
        composeRule.waitForIdle()
        store.rides.value.homes shouldBe listOf(london, HomeCorrection("Elsternwick", "AU", LocalDate.now().toString()))
    }

    @Test
    fun `says what is wrong with a correction`() {
        val store = show()
        item("City").performTextInput("London")
        item("Country").performTextInput("Narnia")
        item("From…").performClick()
        composeRule.onAllNodes(hasText("OK") and hasAnyAncestor(isDialog()))[0].performClick()
        item("Set").performClick()
        item("Use a two-letter country code, such as GB.")
        store.rides.value.homes shouldBe listOf(london)
    }
}
