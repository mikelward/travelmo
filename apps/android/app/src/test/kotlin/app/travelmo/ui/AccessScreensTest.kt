package app.travelmo.ui

import androidx.activity.ComponentActivity
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.auth.GoogleAccount
import app.travelmo.core.AccessConfig
import app.travelmo.core.AccountAccess
import app.travelmo.core.accessDecision
import app.travelmo.core.accessRecordOf
import app.travelmo.core.accessRequest
import app.travelmo.ui.theme.TravelmoTheme
import io.kotest.matchers.shouldBe
import java.time.Instant
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** The invite-only screen and the admins' Access page (SPEC "Access"), and the menu's way there. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36], qualifiers = "w411dp-h914dp-420dpi")
class AccessScreensTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private val newcomer = "new@example.com"
    private val account = GoogleAccount(firebaseAvailable = { true }, webClientId = "client-id")

    private fun newcomerModel(store: FakeTripStore) =
        TripsViewModel(store, "u-new", newcomer, clock = { Instant.parse(FROZEN_NOW) }, emailLinks = FakeEmailLinks())

    /** The invite-only screen as the app shows it: while the account is not approved, following its state live. */
    private fun showInviteOnly(viewModel: TripsViewModel) {
        composeRule.setContent {
            TravelmoTheme {
                val access by viewModel.access.collectAsStateWithLifecycle()
                val known = access as? AccessState.Known
                if (known != null && known.status != AccountAccess.APPROVED) InviteOnlyScreen(account, viewModel, known.status)
            }
        }
    }

    @Test
    fun `a new account cannot ask for access, and is told to ask someone to share a trip`() {
        val store = FakeTripStore(access = emptyMap(), hasUserDocument = false)
        showInviteOnly(newcomerModel(store))
        composeRule.onNodeWithText("Travelmo is invite-only").assertExists()
        composeRule.onNodeWithText("You're signed in as $newcomer. Ask someone who uses Travelmo to share a trip with you.").assertExists()
        composeRule.onNodeWithText("Request access").assertDoesNotExist()
        composeRule.onNodeWithText("Invited at another address?").performScrollTo()
        store.accessWrites shouldBe emptyList()
    }

    @Test
    fun `an approval takes the invite-only screen away`() {
        val store = FakeTripStore(access = mapOf(newcomer to accessRequest(newcomer, "u-new", FROZEN_NOW)), hasUserDocument = false)
        showInviteOnly(newcomerModel(store))
        composeRule.onNodeWithText("Travelmo is invite-only").assertExists()
        store.accessFields.value += newcomer to store.accessFields.value.getValue(newcomer) + accessDecision(AccountAccess.APPROVED, "admin", FROZEN_NOW)
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Travelmo is invite-only").assertDoesNotExist()
    }

    @Test
    fun `a declined account is told so, and offered no other address`() {
        val store = FakeTripStore(access = mapOf(newcomer to mapOf("email" to newcomer) + accessDecision(AccountAccess.DECLINED, "admin", FROZEN_NOW)), hasUserDocument = false)
        showInviteOnly(newcomerModel(store))
        composeRule.onNodeWithText("Your request for $newcomer wasn't approved.").assertExists()
        composeRule.onNodeWithText("Invited at another address?").assertDoesNotExist()
        composeRule.onNodeWithText("Sign out").performScrollTo()
        composeRule.onAllNodesWithText("Delete account")[0].performScrollTo()
    }

    @Test
    fun `a waiting account sends a link to the address it was invited at`() {
        val links = FakeEmailLinks()
        val store = FakeTripStore(access = emptyMap(), hasUserDocument = false)
        showInviteOnly(TripsViewModel(store, "u-new", newcomer, clock = { Instant.parse(FROZEN_NOW) }, emailLinks = links))
        composeRule.onNodeWithContentDescription("Email address").performScrollTo().performTextInput("work@example.org")
        composeRule.onNodeWithText("Send link").performClick()
        composeRule.waitForIdle()
        links.added shouldBe listOf("work@example.org")
        composeRule.onNodeWithText("We sent a link to work@example.org. Open it to confirm.").performScrollTo()
    }

    private fun adminStore() = FakeTripStore(
        accessConfig = AccessConfig(listOf(OWNER_EMAIL)),
        access = mapOf(
            OWNER_EMAIL to mapOf("email" to OWNER_EMAIL) + accessDecision(AccountAccess.APPROVED, "admin", FROZEN_NOW),
            newcomer to accessRequest(newcomer, "u-new", "2026-10-30T09:00:00Z"),
            "friend@example.com" to mapOf("email" to "friend@example.com") + accessDecision(AccountAccess.APPROVED, "admin", FROZEN_NOW),
        ),
    )

    private fun showAccess(store: FakeTripStore) {
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent { TravelmoTheme { AccessScreen(viewModel = viewModel, onBack = {}) } }
    }

    @Test
    fun `an admin approves a request, and it moves to the approved`() {
        val store = adminStore()
        showAccess(store)
        composeRule.onNodeWithText("$newcomer · Fri 30 Oct").assertExists()
        composeRule.onNodeWithText("Approve").performClick()
        composeRule.waitForIdle()
        accessRecordOf(store.accessFields.value.getValue(newcomer))?.status shouldBe AccountAccess.APPROVED
        composeRule.onNodeWithText("No requests.").assertExists()
        composeRule.onNodeWithText(newcomer).assertExists()
    }

    @Test
    fun `an admin revokes anyone but an admin`() {
        val store = adminStore()
        showAccess(store)
        // The request's Decline, and one Revoke: not the admin's own address.
        composeRule.onAllNodesWithText("Revoke").fetchSemanticsNodes().size shouldBe 1
        composeRule.onNodeWithText("Revoke").performScrollTo().performClick()
        composeRule.waitForIdle()
        accessRecordOf(store.accessFields.value.getValue("friend@example.com"))?.status shouldBe AccountAccess.DECLINED
        composeRule.onNodeWithText("friend@example.com").assertDoesNotExist()
    }

    @Test
    fun `an admin invites an address`() {
        val store = adminStore()
        showAccess(store)
        composeRule.onNodeWithContentDescription("Email address to invite").performTextInput("Guest@Example.com")
        composeRule.onNodeWithText("Invite").performClick()
        composeRule.waitForIdle()
        accessRecordOf(store.accessFields.value.getValue("guest@example.com"))?.status shouldBe AccountAccess.APPROVED
        composeRule.onNodeWithText("guest@example.com").performScrollTo()
    }

    @Test
    fun `someone not an admin is told the page is admins' only`() {
        showAccess(FakeTripStore())
        composeRule.onNodeWithText("Only admins can see this page.").assertExists()
        composeRule.onNodeWithText("Invite").assertDoesNotExist()
    }

    @Test
    fun `the menu offers Access only where the app provides it`() {
        var opened = 0
        composeRule.setContent {
            TravelmoTheme { CompositionLocalProvider(LocalOpenAccess provides { opened++ }) { AppMenu() } }
        }
        composeRule.onNodeWithContentDescription("More options").performClick()
        composeRule.onNodeWithText("Access").performClick()
        composeRule.waitForIdle()
        opened shouldBe 1
    }

    @Test
    fun `the menu offers no Access to someone not an admin`() {
        composeRule.setContent { TravelmoTheme { AppMenu() } }
        composeRule.onNodeWithContentDescription("More options").performClick()
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Report a bug").assertExists()
        composeRule.onNodeWithText("Access").assertDoesNotExist()
    }
}
