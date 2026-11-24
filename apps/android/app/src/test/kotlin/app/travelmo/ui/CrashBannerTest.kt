package app.travelmo.ui

import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.auth.GoogleAccount
import app.travelmo.ui.theme.TravelmoTheme
import com.mikelward.androidlog.android.ShareOutcome
import com.mikelward.androidzoom.FontSizeSettings
import com.mikelward.androidzoom.compose.FontSizeState
import io.kotest.matchers.shouldBe
import kotlin.time.Instant
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowToast

/**
 * The crash banner on the screens it is shown on: up while the debug log
 * reports an unacknowledged crash, down once it no longer does. The fake
 * here lowers the state the way the log library does, on Dismiss and on a
 * share whose copy landed; which files make a crash is the library's, and
 * tested there.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36])
class CrashBannerTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private val crashed = MutableStateFlow(true)
    private var refreshes = 0
    private var shares = 0
    private var outcome = ShareOutcome.SHARED
    private var shareGate: CompletableDeferred<Unit>? = null

    private val report = CrashReport(
        crashed = crashed,
        refresh = { refreshes++ },
        dismiss = { crashed.value = false },
        share = {
            shares++
            shareGate?.await()
            // A landed copy (shared or clipboard only) lowers the banner; a failed share leaves it up.
            if (outcome != ShareOutcome.FAILED) crashed.value = false
            outcome
        },
    )

    private fun show(content: @Composable () -> Unit) {
        composeRule.setContent {
            TravelmoTheme { CompositionLocalProvider(LocalCrashReport provides report, content = content) }
        }
        composeRule.waitForIdle()
    }

    private fun showTripList() {
        val viewModel = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        show { TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = {}) }
    }

    @Test
    fun `the trip list shows the banner after a crash and asks for a fresh answer`() {
        showTripList()
        composeRule.onNodeWithText("Travelmo crashed").assertExists()
        refreshes shouldBe 1
    }

    @Test
    fun `the trip list shows no banner without a crash`() {
        crashed.value = false
        showTripList()
        composeRule.onNodeWithText("Travelmo crashed").assertDoesNotExist()
    }

    @Test
    fun `an empty trip list shows the banner too`() {
        val viewModel = TripsViewModel(FakeTripStore(trips = emptyList(), segments = emptyMap()), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        show { TripListScreen(viewModel = viewModel, uid = OWNER, onOpenTrip = {}, onOpenSettings = {}) }
        composeRule.onNodeWithText("Travelmo crashed").assertExists()
    }

    @Test
    fun `the sign-in screen shows the banner after a crash`() {
        show { SignInScreen(account = GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id")) }
        composeRule.onNodeWithText("Travelmo crashed").assertExists()
    }

    // A small phone at the largest text: the banner must not push Sign in out of reach.
    @Test
    @Config(qualifiers = "w320dp-h480dp")
    fun `the sign-in screen scrolls to its button below the banner`() {
        val fontSize = FontSizeState(FontSizeSettings(scale = 1.6f), onScaleSettled = {}, onPinchEnabledChange = {})
        composeRule.setContent {
            TravelmoTheme(fontSize = fontSize) {
                CompositionLocalProvider(LocalCrashReport provides report) {
                    SignInScreen(account = GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id"))
                }
            }
        }
        composeRule.onNodeWithText("Sign in with Google").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun `a crash reported while the screen is up raises the banner`() {
        crashed.value = false
        showTripList()
        crashed.value = true
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Travelmo crashed").assertExists()
    }

    @Test
    fun `dismiss lowers the banner`() {
        showTripList()
        composeRule.onNodeWithText("Dismiss").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Travelmo crashed").assertDoesNotExist()
        shares shouldBe 0
    }

    @Test
    fun `a landed share lowers the banner`() {
        showTripList()
        composeRule.onNodeWithText("Share").performClick()
        composeRule.waitForIdle()
        shares shouldBe 1
        composeRule.onNodeWithText("Travelmo crashed").assertDoesNotExist()
    }

    @Test
    fun `share is off while a share runs`() {
        val gate = CompletableDeferred<Unit>()
        shareGate = gate
        showTripList()
        composeRule.onNodeWithText("Share").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Sharing…").assertIsNotEnabled()
        gate.complete(Unit)
        composeRule.waitForIdle()
        shares shouldBe 1
        composeRule.onNodeWithText("Travelmo crashed").assertDoesNotExist()
    }

    @Test
    fun `a failed share says so and leaves the banner up to try again`() {
        outcome = ShareOutcome.FAILED
        showTripList()
        composeRule.onNodeWithText("Share").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Couldn't share the debug log.").assertExists()
        composeRule.onNodeWithText("Travelmo crashed").assertExists()
        composeRule.onNodeWithText("Share").assertIsEnabled()
    }

    @Test
    fun `a report only on the clipboard says where it went as the banner comes down`() {
        outcome = ShareOutcome.COPIED_ONLY
        showTripList()
        composeRule.onNodeWithText("Share").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Travelmo crashed").assertDoesNotExist()
        ShadowToast.getTextOfLatestToast() shouldBe "No app would take the report, so it is on the clipboard instead."
    }
}
