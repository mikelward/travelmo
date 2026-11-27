package app.travelmo.ui

import androidx.compose.runtime.setValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
import app.travelmo.data.GmailStatus
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.IntentFilter
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
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onLast
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.core.Segment
import app.travelmo.core.SegmentType
import app.travelmo.core.emailLinkFor
import app.travelmo.ui.theme.TravelmoTheme
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import kotlin.time.Instant
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
    fun `a flight's row shows its gate and carousel`() {
        composeRule.setContent { TravelmoTheme { SegmentRow(stay, flightLines = listOf("Departs from terminal 1, gate 8", "Bags on carousel 16")) } }
        composeRule.onNodeWithText("Departs from terminal 1, gate 8 · Bags on carousel 16").assertExists()
    }

    @Test
    fun `a flight offers I've checked in and once marked says so with an undo`() {
        val asked = mutableListOf<Boolean>()
        var state by mutableStateOf(app.travelmo.core.FlightCheckIn.OFFER)
        composeRule.setContent { TravelmoTheme { SegmentRow(fixtureNextFlight, checkIn = SegmentCheckIn(state) { asked += it }) } }
        composeRule.onNodeWithText("I’ve checked in").performClick()
        state = app.travelmo.core.FlightCheckIn.DONE
        composeRule.onNodeWithText("Checked in").assertExists()
        composeRule.onNodeWithText("Undo").performClick()
        asked shouldBe listOf(true, false)
    }

    @Test
    fun `a tap on the row opens the booking, which carries the small print`() {
        var opened = 0
        composeRule.setContent { TravelmoTheme { SegmentRow(tour, onOpen = { opened++ }) } }
        // The reference, provider, notes and travelers are on the details, not the row.
        composeRule.onNodeWithText("Ref LFC-4471", substring = true).assertDoesNotExist()
        composeRule.onNodeWithText("Anfield stadium tour").performClick()
        opened shouldBe 1
    }

    @Test
    fun `the owner renames the trip from its menu, not by the dates`() {
        val viewModel = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent {
            TravelmoTheme {
                TripDetailScreen(viewModel = viewModel, tripId = "liverpool", uid = OWNER, onBack = {}, onAddBooking = {}, onEditBooking = {}, onMerged = {})
            }
        }
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Rename").assertDoesNotExist()
        composeRule.onNodeWithContentDescription("More options").performClick()
        // The dialog it opens has a text field that never lets Compose call itself idle here, so it is not opened.
        composeRule.onNodeWithText("Rename").assertExists()
    }

    @Test
    fun `Split moves every booking from one email to a new trip and opens it`() {
        val store = FakeTripStore()
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        val opened = mutableListOf<String>()
        composeRule.setContent {
            TravelmoTheme {
                TripDetailScreen(viewModel = viewModel, tripId = "liverpool", uid = OWNER, onBack = {}, onAddBooking = {}, onEditBooking = {}, onMerged = { opened += it })
            }
        }
        composeRule.waitForIdle()
        composeRule.onNodeWithContentDescription("More options").performClick()
        composeRule.onNodeWithText("Split…").performClick()
        // The train's email gave only the train: one tap picks it.
        composeRule.onNodeWithText("${fixtureTrainEmail.label} (1)").performClick()
        composeRule.onNodeWithText("Move 1 booking to a new trip").performClick()
        composeRule.waitForIdle()
        store.splits shouldBe listOf(Triple("liverpool", listOf("l-train"), OWNER))
        opened shouldBe listOf("split-trip")
    }

    @Test
    fun `Travelers takes a name off the trip and keeps those already off unticked`() {
        // The tour, cancelled, names someone on nothing else: still on the trip, so left ticked.
        val segments = fixtureSegments + ("liverpool" to fixtureSegments.getValue("liverpool").map { if (it.id == "l-tour") it.copy(cancelledAt = "2026-11-01T00:00:00Z", travelers = listOf("Alex Other")) else it })
        val store = FakeTripStore(trips = fixtureTrips.map { if (it.id == "liverpool") it.copy(removedTravelers = listOf("Pat Example")) else it }, segments = segments)
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent {
            TravelmoTheme {
                TripDetailScreen(viewModel = viewModel, tripId = "liverpool", uid = OWNER, onBack = {}, onAddBooking = {}, onEditBooking = {}, onMerged = {})
            }
        }
        composeRule.waitForIdle()
        composeRule.onNodeWithContentDescription("More options").performClick()
        composeRule.onNodeWithText("Travelers…").performClick()
        // A name taken off before is listed, unticked, so it can be put back.
        composeRule.onNodeWithText("Pat Example").assertExists()
        composeRule.onNodeWithText("Sam Example").performClick()
        composeRule.onNodeWithText("Save").performClick()
        composeRule.waitForIdle()
        store.removedTravelers shouldBe listOf("liverpool" to listOf("Sam Example", "Pat Example"))
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
    fun `a viewer who cannot edit gets Directions and Copy reference alone`() {
        composeRule.setContent { TravelmoTheme { SegmentRow(stay) } }
        composeRule.onNodeWithContentDescription("Booking actions").performClick()
        composeRule.onNodeWithText("Directions").assertExists()
        composeRule.onNodeWithText("Copy reference").assertExists()
        // Sources are on the booking's details.
        composeRule.onNodeWithText("Sources").assertDoesNotExist()
        composeRule.onNodeWithText("Edit").assertDoesNotExist()
        composeRule.onNodeWithText("Delete").assertDoesNotExist()
    }

    @Test
    fun `an editor gets the actions`() {
        composeRule.setContent { TravelmoTheme { SegmentRow(stay, editor) } }
        composeRule.onNodeWithContentDescription("Booking actions").performClick()
        for (item in listOf("Directions", "Copy reference", "Edit", "Move to another trip…", "Delete")) composeRule.onNodeWithText(item).assertExists()
    }

    @Test
    fun `Directions opens Google Maps to the stay for anyone who sees it`() {
        composeRule.setContent { TravelmoTheme { SegmentRow(stay) } }
        composeRule.onNodeWithContentDescription("Booking actions").performClick()
        composeRule.onNodeWithText("Directions").performClick()
        shadowOf(composeRule.activity).nextStartedActivity.dataString shouldBe "https://www.google.com/maps/dir/?api=1&destination=Cove%20Liverpool"
    }

    @Test
    fun `a booking with no sources, sender, reference or place has no menu for a viewer`() {
        composeRule.setContent { TravelmoTheme { SegmentRow(fixtureUntimedActivity.copy(destination = null)) } }
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
    fun `a viewer can copy a booking's reference from the menu`() {
        composeRule.setContent { TravelmoTheme { SegmentRow(stay) } }
        composeRule.onNodeWithContentDescription("Booking actions").performClick()
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
        composeRule.onNodeWithText("Directions").assertExists()
        composeRule.onNodeWithText("Copy reference").assertDoesNotExist()
    }

    private fun clipboard() = composeRule.activity.getSystemService(ClipboardManager::class.java)

    private fun clipboardText() = clipboard().primaryClip!!.getItemAt(0).text.toString()

    @Test
    fun `merging offers the trip's other bookings of the kind and keeps the one whose menu was used`() {
        val second = Segment("l-stay-2", "liverpool", SegmentType.LODGING, "Cove Liverpool apartment", "2026-12-12T16:00:00+00:00", "2026-12-13T11:00:00+00:00")
        val store = FakeTripStore(segments = fixtureSegments + ("liverpool" to fixtureSegments.getValue("liverpool") + second))
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent {
            TravelmoTheme {
                TripDetailScreen(viewModel = viewModel, tripId = "liverpool", uid = OWNER, onBack = {}, onAddBooking = {}, onEditBooking = {}, onMerged = {})
            }
        }
        composeRule.waitForIdle()
        // The train has no other train to merge with.
        composeRule.onAllNodesWithContentDescription("Booking actions")[0].performClick()
        composeRule.onNodeWithText("Merge with…").assertDoesNotExist()
        composeRule.onNodeWithText("Edit").performClick()
        composeRule.onAllNodesWithContentDescription("Booking actions")[1].performClick()
        composeRule.onNodeWithText("Merge with…").performClick()
        composeRule.onAllNodesWithText("Cove Liverpool apartment").onLast().performClick()
        composeRule.waitForIdle()
        store.mergedBookings shouldBe listOf(Triple("liverpool", "l-stay", "l-stay-2"))
    }

    @Test
    fun `moving a booking offers a new trip first and the trips around its dates with the rest behind More`() {
        val store = FakeTripStore()
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent {
            TravelmoTheme {
                TripDetailScreen(viewModel = viewModel, tripId = "liverpool", uid = OWNER, onBack = {}, onAddBooking = {}, onEditBooking = {}, onMerged = {})
            }
        }
        composeRule.waitForIdle()
        composeRule.onAllNodesWithContentDescription("Booking actions")[1].performClick()
        composeRule.onNodeWithText("Move to another trip…").performClick()
        composeRule.onNodeWithText("New trip").assertExists()
        // Dublin ends ten days before the stay; Lisbon is months away.
        composeRule.onNodeWithText("Dublin", substring = true).assertExists()
        composeRule.onNodeWithText("Lisbon", substring = true).assertDoesNotExist()
        composeRule.onNodeWithText("More…").performClick()
        composeRule.onNodeWithText("Lisbon", substring = true).assertExists()
        composeRule.onNodeWithText("More…").assertDoesNotExist()
        composeRule.onNodeWithText("New trip").performClick()
        composeRule.waitForIdle()
        store.movedToNew shouldBe listOf(Triple("liverpool", "l-stay", OWNER))
    }

}
