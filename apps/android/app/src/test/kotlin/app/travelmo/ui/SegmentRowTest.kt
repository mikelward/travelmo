package app.travelmo.ui

import android.content.ClipboardManager
import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.core.SegmentType
import app.travelmo.core.emailLinkFor
import app.travelmo.ui.theme.TravelmoTheme
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import java.time.Instant
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowToast

/** A booking row: its type as an icon, and its sources and actions behind ⋮. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36], qualifiers = "w411dp-h914dp-420dpi")
class SegmentRowTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private val liverpool = fixtureSegments.getValue("liverpool")
    private val stay = liverpool.first { it.type == SegmentType.LODGING }
    private val tour = liverpool.first { it.type == SegmentType.ACTIVITY }
    private val editor = BookingActions(onEdit = {}, onDelete = {}, onMove = {})

    @Test
    fun `the type is an icon named for it`() {
        composeRule.setContent { TravelmoTheme { SegmentRow(stay) } }
        composeRule.onNodeWithContentDescription("Stay").assertExists()
        composeRule.onNodeWithText("STAY").assertDoesNotExist()
    }

    @Test
    fun `every type has its own icon`() {
        val icons = SegmentType.entries.map(::segmentIcon)
        icons.toSet().size shouldBe SegmentType.entries.size
    }

    @Test
    fun `the row no longer carries a line of sources and the sender`() {
        composeRule.setContent { TravelmoTheme { SegmentRow(stay, editor) } }
        composeRule.onNodeWithText("From cove.example", substring = true).assertDoesNotExist()
        composeRule.onNodeWithText("Source", substring = true).assertDoesNotExist()
    }

    @Test
    fun `a viewer who cannot edit gets Sources alone`() {
        composeRule.setContent { TravelmoTheme { SegmentRow(stay) } }
        composeRule.onNodeWithContentDescription("Booking actions").performClick()
        composeRule.onNodeWithText("Sources").assertExists()
        composeRule.onNodeWithText("Edit").assertDoesNotExist()
        composeRule.onNodeWithText("Delete").assertDoesNotExist()
    }

    @Test
    fun `an editor gets Sources and the actions`() {
        composeRule.setContent { TravelmoTheme { SegmentRow(stay, editor) } }
        composeRule.onNodeWithContentDescription("Booking actions").performClick()
        for (item in listOf("Sources", "Edit", "Move to another trip…", "Delete")) composeRule.onNodeWithText(item).assertExists()
    }

    @Test
    fun `a booking with no sources, sender or reference has no menu for a viewer`() {
        composeRule.setContent { TravelmoTheme { SegmentRow(fixtureUntimedActivity) } }
        composeRule.onNodeWithContentDescription("Booking actions").assertDoesNotExist()
    }

    @Test
    fun `an editor's menu on a booking with no sources or reference has only the actions`() {
        composeRule.setContent { TravelmoTheme { SegmentRow(fixtureUntimedActivity, editor) } }
        composeRule.onNodeWithContentDescription("Booking actions").performClick()
        composeRule.onNodeWithText("Edit").assertExists()
        composeRule.onNodeWithText("Sources").assertDoesNotExist()
        composeRule.onNodeWithText("Copy reference").assertDoesNotExist()
    }

    @Test
    fun `a viewer can copy a booking's reference from the menu, ahead of Sources`() {
        composeRule.setContent { TravelmoTheme { SegmentRow(stay) } }
        composeRule.onNodeWithContentDescription("Booking actions").performClick()
        val copy = composeRule.onNodeWithText("Copy reference").fetchSemanticsNode().boundsInRoot.top
        val sources = composeRule.onNodeWithText("Sources").fetchSemanticsNode().boundsInRoot.top
        (copy < sources) shouldBe true
        composeRule.onNodeWithText("Copy reference").performClick()
        clipboardText() shouldBe "CV-55120"
        clipboard().primaryClipDescription!!.label shouldBe "Booking reference"
        // Android confirms the copy itself (13 and later, all the app runs on).
        ShadowToast.getLatestToast().shouldBeNull()
    }

    @Test
    fun `a booking without a reference has no Copy reference`() {
        composeRule.setContent { TravelmoTheme { SegmentRow(stay.copy(confirmation = null)) } }
        composeRule.onNodeWithContentDescription("Booking actions").performClick()
        composeRule.onNodeWithText("Sources").assertExists()
        composeRule.onNodeWithText("Copy reference").assertDoesNotExist()
    }

    @Test
    fun `a long press on the reference line copies the reference, and TalkBack offers it`() {
        composeRule.setContent { TravelmoTheme { SegmentRow(tour) } }
        val line = composeRule.onNodeWithText("Liverpool FC · Ref LFC-4471")
        line.assert(SemanticsMatcher("long-click labeled Copy reference") { it.config.getOrNull(SemanticsActions.OnLongClick)?.label == "Copy reference" })
        line.performTouchInput { longClick() }
        clipboardText() shouldBe "LFC-4471"
    }

    @Test
    fun `a pinch that starts on the reference line does not copy it`() {
        composeRule.setContent { TravelmoTheme { SegmentRow(tour) } }
        composeRule.onNodeWithText("Liverpool FC · Ref LFC-4471").performTouchInput {
            down(0, center)
            advanceEventTime(50)
            down(1, center + Offset(10f, 0f))
            for (step in 1..10) {
                advanceEventTime(100)
                moveTo(0, center - Offset(step * 10f, 0f))
                moveTo(1, center + Offset(10f + step * 10f, 0f))
            }
            up(0)
            up(1)
        }
        composeRule.waitForIdle()
        clipboard().hasPrimaryClip() shouldBe false
    }

    private fun clipboard() = composeRule.activity.getSystemService(ClipboardManager::class.java)

    private fun clipboardText() = clipboard().primaryClip!!.getItemAt(0).text.toString()

    @Test
    fun `Sources lists every source and the sender`() {
        composeRule.setContent { TravelmoTheme { SegmentRow(stay) } }
        composeRule.onNodeWithContentDescription("Booking actions").performClick()
        composeRule.onNodeWithText("Sources").performClick()
        for (label in listOf("Booking confirmed: Cove Liverpool", "Your stay is coming up", "Liverpool weekend", "TripIt", "From cove.example")) {
            composeRule.onNodeWithText(label).assertExists()
        }
        composeRule.onNodeWithText("Close").performClick()
        composeRule.onNodeWithText("Your stay is coming up").assertDoesNotExist()
    }

    @Test
    fun `an email the viewer imported opens in Gmail, and one someone else imported does not`() {
        composeRule.setContent { TravelmoTheme { SegmentRow(stay, emailLink = { emailLinkFor(it, OWNER, ownsTrip = true) }) } }
        composeRule.onNodeWithContentDescription("Booking actions").performClick()
        composeRule.onNodeWithText("Sources").performClick()
        val started = shadowOf(composeRule.activity)

        composeRule.onNodeWithText("Your stay is coming up").performClick()
        started.nextStartedActivity.shouldBeNull()

        composeRule.onNodeWithText("Booking confirmed: Cove Liverpool").performClick()
        val intent = started.nextStartedActivity
        intent.action shouldBe Intent.ACTION_VIEW
        intent.dataString shouldBe "https://mail.google.com/mail/u/0/#all/m-cove"
    }

    @Test
    fun `the trip page opens the viewer's own import in Gmail`() {
        val viewModel = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent {
            TravelmoTheme {
                TripDetailScreen(viewModel = viewModel, tripId = "liverpool", uid = OWNER, email = OWNER_EMAIL, onBack = {}, onAddBooking = {}, onEditBooking = {}, onMerged = {})
            }
        }
        composeRule.waitForIdle()
        // The stay is the second booking.
        composeRule.onAllNodesWithContentDescription("Booking actions")[1].performClick()
        composeRule.onNodeWithText("Sources").performClick()
        composeRule.onNodeWithText("Booking confirmed: Cove Liverpool").performClick()
        shadowOf(composeRule.activity).nextStartedActivity.dataString shouldBe "https://mail.google.com/mail/u/0/#all/m-cove"
    }

    @Test
    fun `the trip page opens the viewer's own import in the Gmail account they connected`() {
        val store = FakeTripStore(gmailAccount = "owner@example.com")
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent {
            TravelmoTheme {
                TripDetailScreen(viewModel = viewModel, tripId = "liverpool", uid = OWNER, email = OWNER_EMAIL, onBack = {}, onAddBooking = {}, onEditBooking = {}, onMerged = {})
            }
        }
        composeRule.waitForIdle()
        composeRule.onAllNodesWithContentDescription("Booking actions")[1].performClick()
        composeRule.onNodeWithText("Sources").performClick()
        composeRule.onNodeWithText("Booking confirmed: Cove Liverpool").performClick()
        shadowOf(composeRule.activity).nextStartedActivity.dataString shouldBe
            "https://mail.google.com/mail/u/?authuser=owner%40example.com#all/m-cove"
    }
}
