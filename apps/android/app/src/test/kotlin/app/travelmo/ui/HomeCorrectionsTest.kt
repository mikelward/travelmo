package app.travelmo.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.SemanticsNodeInteraction
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.auth.GoogleAccount
import app.travelmo.auth.SignedIn
import app.travelmo.core.ChosenHomeAirports
import app.travelmo.core.HomeCorrection
import app.travelmo.core.NotHomeStay
import app.travelmo.core.Place
import app.travelmo.core.Segment
import app.travelmo.core.SegmentType
import app.travelmo.core.Trip
import app.travelmo.data.RideSettings
import app.travelmo.ui.theme.TravelmoTheme
import io.kotest.matchers.shouldBe
import java.time.LocalDate
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** Home in Settings: worked out with the user's corrections over it, which are added and removed there, as on the web. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36], qualifiers = "w411dp-h914dp-420dpi")
class HomeCorrectionsTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private val london = HomeCorrection("London", "GB", "2022-01-15")
    private val user = SignedIn(OWNER, OWNER_EMAIL, true)

    private fun item(text: String): SemanticsNodeInteraction =
        composeRule.onNodeWithText(text).performScrollTo()

    private fun showHome(viewModel: TripsViewModel) {
        composeRule.setContent {
            TravelmoTheme {
                SettingsSectionScreen(
                    account = rememberSignedInAccount(GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id")),
                    user = user,
                    viewModel = viewModel,
                    section = SettingsSection.HOME,
                    onBack = {},
                )
            }
        }
        composeRule.waitForIdle()
    }

    private fun show(): FakeTripStore {
        val store = FakeTripStore()
        store.rides.value = RideSettings(homes = listOf(london))
        showHome(TripsViewModel(store, OWNER, OWNER_EMAIL))
        return store
    }

    @Test
    fun `shows home with the corrections and removes one`() {
        val store = show()
        item("Home: London since Jan 2022")
        item("London, GB from 15 Jan 2022")
        composeRule.onNodeWithContentDescription("Remove London, GB from 15 Jan 2022").performScrollTo().performClick()
        composeRule.waitForIdle()
        store.rides.value.homes shouldBe emptyList()
    }

    @Test
    fun `adds a correction from a city a country and a date`() {
        val store = show()
        item("Add home").performClick()
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
        item("Add home").performClick()
        item("City").performTextInput("London")
        item("Country").performTextInput("Narnia")
        item("From…").performClick()
        composeRule.onAllNodes(hasText("OK") and hasAnyAncestor(isDialog()))[0].performClick()
        item("Set").performClick()
        item("Use a two-letter country code, such as GB.")
        store.rides.value.homes shouldBe listOf(london)
    }

    @Test
    fun `lists each home's airports and chooses them by code`() {
        val store = show()
        store.rides.value = store.rides.value.copy(homeAirports = listOf(ChosenHomeAirports("London", "GB", listOf("LHR"))))
        item("London airports: LHR")
        composeRule.onNodeWithContentDescription("Edit London airports").performScrollTo().performClick()
        item("London airports").performTextReplacement("LHR, lgw")
        item("Save").performClick()
        composeRule.waitForIdle()
        store.rides.value.homeAirports shouldBe listOf(ChosenHomeAirports("London", "GB", listOf("LHR", "LGW")))
        item("London airports: LHR, LGW")
    }

    @Test
    fun `lists a month of stays under home and says one was not home`() {
        val flat = { id: String, start: String, end: String ->
            Segment(id, "winter", SegmentType.LODGING, "Example Mews Flat", "${start}T15:00:00+00:00", end = "${end}T11:00:00+00:00", destination = Place("Example Mews Flat", city = "London", country = "GB"))
        }
        val store = FakeTripStore(
            trips = listOf(Trip("winter", "London", "2022-02-13", "2022-03-20", OWNER)),
            segments = mapOf("winter" to listOf(flat("f1", "2022-02-13", "2022-02-27"), flat("f2", "2022-02-27", "2022-03-20"))),
        )
        val actions = FakeTripActions()
        showHome(TripsViewModel(store, OWNER, OWNER_EMAIL, tripActions = actions))
        item("London, 13 Feb – 20 Mar 2022 · from your stays")
        item("Not home").performClick()
        composeRule.waitForIdle()
        store.rides.value.notHome shouldBe listOf(NotHomeStay("London", "GB", "2022-02-13"))
        actions.calls shouldBe listOf("regroup")
        composeRule.onAllNodesWithText("Not home").assertCountEquals(0)
    }

    @Test
    fun `says so when the trips couldn't be regrouped after Not home`() {
        val flat = { id: String, start: String, end: String ->
            Segment(id, "winter", SegmentType.LODGING, "Example Mews Flat", "${start}T15:00:00+00:00", end = "${end}T11:00:00+00:00", destination = Place("Example Mews Flat", city = "London", country = "GB"))
        }
        val store = FakeTripStore(
            trips = listOf(Trip("winter", "London", "2022-02-13", "2022-03-20", OWNER)),
            segments = mapOf("winter" to listOf(flat("f1", "2022-02-13", "2022-02-27"), flat("f2", "2022-02-27", "2022-03-20"))),
        )
        showHome(TripsViewModel(store, OWNER, OWNER_EMAIL, tripActions = FakeTripActions(failure = "Unavailable")))
        item("Not home").performClick()
        composeRule.waitForIdle()
        item(NOT_HOME_REGROUP_FAILED)
    }
}
