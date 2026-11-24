package app.travelmo.ui

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.auth.GoogleAccount
import app.travelmo.auth.SignedIn
import app.travelmo.core.RideCompany
import app.travelmo.core.RideNear
import app.travelmo.data.RideSettings
import app.travelmo.ui.theme.TravelmoTheme
import io.kotest.matchers.shouldBe
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowToast
import androidx.core.net.toUri

/** Settings' car and ride companies: the user's own, added and removed as on the web. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36], qualifiers = "w411dp-h914dp-420dpi")
class RideCompaniesSettingTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private val cabs = RideCompany("Village Cabs", "https://cabs.example/", RideNear.HOME)

    private fun show(): FakeTripStore {
        val store = FakeTripStore()
        store.rides.value = RideSettings(companies = listOf(cabs))
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL)
        composeRule.setContent {
            TravelmoTheme {
                SettingsScreen(account = rememberSignedInAccount(GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id")), user = SignedIn(OWNER, OWNER_EMAIL), viewModel = viewModel, onBack = {})
            }
        }
        return store
    }

    @Test
    fun `adds a company for cars wherever a flight lands, and removes one`() {
        val store = show()
        composeRule.onNodeWithText("Village Cabs").performScrollTo()
        composeRule.onNodeWithText("Company name").performScrollTo().performTextInput("Island Cars")
        composeRule.onNodeWithText("Booking page").performScrollTo().performTextInput("https://cars.example/")
        composeRule.onNodeWithText("Add").performScrollTo()
        composeRule.onNodeWithText("Cars wherever I land").performClick()
        composeRule.onNodeWithText("Cars wherever I land").assertIsSelected()
        composeRule.onNodeWithText("Add").performScrollTo().performClick()
        composeRule.waitForIdle()
        store.rides.value.companies shouldBe listOf(cabs, RideCompany("Island Cars", "https://cars.example/", RideNear.ANYWHERE))
        composeRule.onNodeWithContentDescription("Remove Village Cabs").performScrollTo().performClick()
        composeRule.waitForIdle()
        store.rides.value.companies shouldBe listOf(RideCompany("Island Cars", "https://cars.example/", RideNear.ANYWHERE))
    }

    @Test
    fun `asks for an https link`() {
        val store = show()
        composeRule.onNodeWithText("Company name").performScrollTo().performTextInput("Island Cars")
        composeRule.onNodeWithText("Booking page").performScrollTo().performTextInput("http://cars.example/")
        composeRule.onNodeWithText("Add").performScrollTo().performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Use a link that starts with https://.").performScrollTo()
        store.rides.value.companies shouldBe listOf(cabs)
    }

    @Test
    fun `opens a company's page, and says so when nothing on the phone can`() {
        show()
        val application = shadowOf(composeRule.activity.application)
        composeRule.onNodeWithText("Village Cabs").performScrollTo().performClick()
        shadowOf(composeRule.activity).nextStartedActivity.data shouldBe "https://cabs.example/".toUri()
        // No app handles the link: a message, not a crash.
        application.checkActivities(true)
        composeRule.onNodeWithText("Village Cabs").performClick()
        composeRule.waitForIdle()
        ShadowToast.getTextOfLatestToast() shouldBe composeRule.activity.getString(app.travelmo.R.string.link_failed)
    }

    @Test
    fun `limits a company to the countries typed and names one that is not a country`() {
        val store = show()
        composeRule.onNodeWithText("Company name").performScrollTo().performTextInput("Cretan Cars")
        composeRule.onNodeWithText("Booking page").performScrollTo().performTextInput("https://cretan.example/")
        composeRule.onNodeWithText("Countries").performScrollTo().performTextInput("Greece, Narnia")
        composeRule.onNodeWithText("Add").performScrollTo()
        composeRule.onNodeWithText("Cars wherever I land").performClick()
        composeRule.onNodeWithText("Add").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Narnia isn't a country.").performScrollTo()
        store.rides.value.companies shouldBe listOf(cabs)
        composeRule.onNodeWithText("Greece, Narnia").performTextReplacement("Greece")
        composeRule.onNodeWithText("Add").performScrollTo().performClick()
        composeRule.waitForIdle()
        store.rides.value.companies shouldBe listOf(cabs, RideCompany("Cretan Cars", "https://cretan.example/", RideNear.ANYWHERE, listOf("GR")))
        composeRule.onNodeWithText("Cars wherever I land · Greece").performScrollTo()
    }
}
