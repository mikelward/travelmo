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
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.core.Place
import app.travelmo.core.Segment
import app.travelmo.core.SegmentType
import app.travelmo.core.emailLinkFor
import app.travelmo.ui.theme.TravelmoTheme
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import kotlin.time.Instant
import kotlinx.coroutines.runBlocking
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowToast

/** A booking's details: its small print, places, reference and sources, and the edit pencil. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36], qualifiers = "w411dp-h914dp-420dpi")
class BookingDetailTest {
    @get:Rule
    val composeRule = createAndroidComposeRule<ComponentActivity>()

    private val liverpool = fixtureSegments.getValue("liverpool")
    private val stay = liverpool.first { it.type == SegmentType.LODGING }
    private val tour = liverpool.first { it.type == SegmentType.ACTIVITY }

    private fun clipboard() = composeRule.activity.getSystemService(ClipboardManager::class.java)

    private fun screen(viewModel: TripsViewModel, onEdit: () -> Unit = {}, onBack: () -> Unit = {}, uid: String = OWNER) = composeRule.setContent {
        TravelmoTheme {
            BookingDetailScreen(viewModel = viewModel, tripId = "liverpool", segmentId = "l-stay", uid = uid, onBack = onBack, onEdit = onEdit, onTripGone = {})
        }
    }

    @Test
    fun `the details carry the provider, reference, notes and travelers`() {
        composeRule.setContent { TravelmoTheme { BookingDetails(stay.copy(travelers = listOf("Alex Example"))) } }
        for (text in listOf("Cove", "Ref CV-55120", "Late check-in after 22:00: call reception", "For Alex Example")) composeRule.onNodeWithText(text).assertExists()
    }

    @Test
    fun `a tap on the reference copies it, and TalkBack says so`() {
        composeRule.setContent { TravelmoTheme { BookingDetails(tour) } }
        val ref = composeRule.onNodeWithText("Ref LFC-4471")
        ref.assert(SemanticsMatcher("click labeled Copy reference") { it.config.getOrNull(SemanticsActions.OnClick)?.label == "Copy reference" })
        ref.performClick()
        clipboard().primaryClip!!.getItemAt(0).text.toString() shouldBe "LFC-4471"
        clipboard().primaryClipDescription!!.label shouldBe "Booking reference"
        // Android confirms the copy itself (13 and later, all the app runs on).
        ShadowToast.getLatestToast().shouldBeNull()
    }

    @Test
    fun `a tap on the place shows it in Google Maps`() {
        val withAddress = stay.copy(destination = stay.destination!!.copy(address = "4 Hope Street, Liverpool L1 9AB"))
        composeRule.setContent { TravelmoTheme { BookingDetails(withAddress) } }
        composeRule.onNodeWithText("4 Hope Street, Liverpool L1 9AB").assertExists()
        composeRule.onNodeWithText("4 Hope Street, Liverpool L1 9AB").performClick()
        shadowOf(composeRule.activity).nextStartedActivity.dataString shouldBe
            "https://www.google.com/maps/search/?api=1&query=Cove%20Liverpool%2C%204%20Hope%20Street%2C%20Liverpool%20L1%209AB"
    }

    @Test
    fun `the pencil edits the booking for those who may`() {
        var edited = 0
        screen(TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) }), onEdit = { edited++ })
        composeRule.waitForIdle()
        composeRule.onNodeWithContentDescription("Edit").performClick()
        edited shouldBe 1
    }

    @Test
    fun `a viewer who may not edit gets no pencil`() {
        screen(TripsViewModel(FakeTripStore(), "stranger", "stranger@example.com", clock = { Instant.parse(FROZEN_NOW) }), uid = "stranger")
        composeRule.waitForIdle()
        composeRule.onNodeWithContentDescription("Edit").assertDoesNotExist()
    }

    @Test
    fun `a booking deleted while open goes back to its trip`() {
        val store = FakeTripStore()
        var back = 0
        screen(TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) }), onBack = { back++ })
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Ref CV-55120").assertExists()
        runBlocking { store.deleteSegment("liverpool", "l-stay") }
        composeRule.waitForIdle()
        back shouldBe 1
    }

    @Test
    fun `Sources lists every source and the sender`() {
        composeRule.setContent { TravelmoTheme { BookingDetails(stay) } }
        for (label in listOf("Booking confirmed: Cove Liverpool", "Payment received: Cove Liverpool", "Fastmail email", "Your stay is coming up", "Liverpool weekend", "TripIt", "From cove.example")) {
            composeRule.onNodeWithText(label).assertExists()
        }
    }


    @Test
    fun `an email the viewer imported opens in Gmail, and one someone else imported does not`() {
        composeRule.setContent { TravelmoTheme { BookingDetails(stay, emailLink = { emailLinkFor(it, OWNER, ownsTrip = true) }) } }
        val started = shadowOf(composeRule.activity)

        composeRule.onNodeWithText("Your stay is coming up").performClick()
        started.nextStartedActivity.shouldBeNull()
        // The viewer's own, but Fastmail has no link to a message.
        composeRule.onNodeWithText("Payment received: Cove Liverpool").performClick()
        started.nextStartedActivity.shouldBeNull()

        composeRule.onNodeWithText("Booking confirmed: Cove Liverpool").performClick()
        val intent = started.nextStartedActivity
        intent.action shouldBe Intent.ACTION_VIEW
        intent.dataString shouldBe "https://mail.google.com/mail/u/0/#all/m-cove"
    }


    @Test
    fun `with the Gmail app an email opens there with a search for it on the clipboard`() {
        val gmail = ComponentName("com.google.android.gm", "com.google.android.gm.ConversationListActivityGmail")
        shadowOf(composeRule.activity.packageManager).apply {
            addActivityIfNotPresent(gmail)
            addIntentFilterForActivity(gmail, IntentFilter(Intent.ACTION_MAIN).apply { addCategory(Intent.CATEGORY_LAUNCHER) })
        }
        composeRule.setContent { TravelmoTheme { BookingDetails(stay, emailLink = { emailLinkFor(it, OWNER, ownsTrip = true) }) } }
        composeRule.onNodeWithText("Booking confirmed: Cove Liverpool").performClick()

        shadowOf(composeRule.activity).nextStartedActivity.component shouldBe gmail
        val clip = composeRule.activity.getSystemService(ClipboardManager::class.java).primaryClip!!
        clip.getItemAt(0).text.toString() shouldBe "subject:\"Booking confirmed: Cove Liverpool\""
        ShadowToast.getTextOfLatestToast() shouldBe "Search copied. Paste it in Gmail's search."
    }


    @Test
    fun `a booking's details open the viewer's own import in Gmail`() {
        val viewModel = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent {
            TravelmoTheme {
                BookingDetailScreen(viewModel = viewModel, tripId = "liverpool", segmentId = "l-stay", uid = OWNER, onBack = {}, onEdit = {}, onTripGone = {})
            }
        }
        composeRule.waitForIdle()
        // The stay is the second booking.
        composeRule.onNodeWithText("Booking confirmed: Cove Liverpool").performClick()
        shadowOf(composeRule.activity).nextStartedActivity.dataString shouldBe "https://mail.google.com/mail/u/0/#all/m-cove"
    }


    @Test
    fun `a booking's details open the viewer's own import in the Gmail account it came from`() {
        // The email came from the first mailbox; a second one names its own emails.
        val store = FakeTripStore(
            gmailStatuses = listOf(
                GmailStatus("owner@example.com", connectedAt = "2026-10-01T00:00:00Z"),
                GmailStatus("owner@work.example", connectedAt = "2026-10-02T00:00:00Z", idPrefix = "gmail-k1-"),
            ),
        )
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent {
            TravelmoTheme {
                BookingDetailScreen(viewModel = viewModel, tripId = "liverpool", segmentId = "l-stay", uid = OWNER, onBack = {}, onEdit = {}, onTripGone = {})
            }
        }
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Booking confirmed: Cove Liverpool").performClick()
        shadowOf(composeRule.activity).nextStartedActivity.dataString shouldBe
            "https://mail.google.com/mail/u/?authuser=owner%40example.com#all/m-cove"
    }


    @Test
    fun `never importing a sender from a booking's details offers to delete what it already imported`() {
        // A trip of nothing but another stay from the stay's sender.
        val stay = fixtureSegments.getValue("liverpool").single { it.id == "l-stay" }
        val store = FakeTripStore(
            trips = fixtureTrips + fixtureTrips.single { it.id == "dublin" }.copy(id = "class", title = "Class"),
            segments = fixtureSegments + ("class" to listOf(stay.copy(id = "c-stay", tripId = "class"))),
        )
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent {
            TravelmoTheme {
                BookingDetailScreen(viewModel = viewModel, tripId = "liverpool", segmentId = "l-stay", uid = OWNER, onBack = {}, onEdit = {}, onTripGone = {})
            }
        }
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Never import this sender").performScrollTo().performClick()
        composeRule.onNodeWithText("Mail from cove.example won't be imported again. Delete 1 trip and 1 booking already imported from it?").assertExists()
        store.patterns.value.deny.contains("cove.example") shouldBe true
        composeRule.onNodeWithText("Delete").performClick()
        composeRule.waitForIdle()
        store.deletedTrips shouldBe listOf("class")
        store.deleted shouldBe listOf("liverpool" to "l-stay")
    }


    @Test
    fun `a booking that arrives while the offer is open keeps its trip`() {
        val stay = fixtureSegments.getValue("liverpool").single { it.id == "l-stay" }
        val store = FakeTripStore(
            trips = fixtureTrips + fixtureTrips.single { it.id == "dublin" }.copy(id = "class", title = "Class"),
            segments = fixtureSegments + ("class" to listOf(stay.copy(id = "c-stay", tripId = "class"))),
        )
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent {
            TravelmoTheme {
                BookingDetailScreen(viewModel = viewModel, tripId = "liverpool", segmentId = "l-stay", uid = OWNER, onBack = {}, onEdit = {}, onTripGone = {})
            }
        }
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Never import this sender").performScrollTo().performClick()
        composeRule.waitForIdle()
        // Another sender's booking lands in the class trip before the answer.
        store.arrived["class"] = listOf("c-flight")
        composeRule.onNodeWithText("Delete").performClick()
        composeRule.waitForIdle()
        store.deletedTrips shouldBe emptyList()
        store.deleted shouldBe listOf("liverpool" to "l-stay", "class" to "c-stay")
    }


    @Test
    fun `a failed cleanup is offered again to retry`() {
        val store = FakeTripStore()
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent {
            TravelmoTheme {
                BookingDetailScreen(viewModel = viewModel, tripId = "liverpool", segmentId = "l-stay", uid = OWNER, onBack = {}, onEdit = {}, onTripGone = {})
            }
        }
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Never import this sender").performScrollTo().performClick()
        composeRule.waitForIdle()
        val offered = { composeRule.onAllNodesWithText("Delete what it imported?").fetchSemanticsNodes().isNotEmpty() }
        composeRule.waitUntil(5_000, offered)
        store.failDeleteSegment = true
        composeRule.onNodeWithText("Delete").performClick()
        // The failure brings the offer back.
        composeRule.waitUntil(5_000, offered)
        store.failDeleteSegment = false
        composeRule.onNodeWithText("Delete").performClick()
        composeRule.waitForIdle()
        store.deleted shouldBe listOf("liverpool" to "l-stay")
    }


    @Test
    fun `a failed scan saves nothing and keeps never on offer`() {
        val store = FakeTripStore()
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent {
            TravelmoTheme {
                BookingDetailScreen(viewModel = viewModel, tripId = "liverpool", segmentId = "l-stay", uid = OWNER, onBack = {}, onEdit = {}, onTripGone = {})
            }
        }
        composeRule.waitForIdle()
        store.failSegments = true
        composeRule.onNodeWithText("Never import this sender").performScrollTo().performClick()
        composeRule.waitUntil(5_000) { viewModel.outcomes.value.values.any { it is Outcome.Failed } }
        store.patterns.value.deny shouldBe listOf("news.example")
        composeRule.onNodeWithText("Never import this sender").assertExists()
    }

    @Test
    fun `never importing the sender of a trip's only booking leaves for good once, not to the deleted trip`() {
        // Liverpool holds nothing but the stay from cove.example, so its cleanup deletes the trip whole.
        val stay = fixtureSegments.getValue("liverpool").single { it.id == "l-stay" }
        val store = FakeTripStore(segments = fixtureSegments + ("liverpool" to listOf(stay)))
        var back = 0
        var gone = 0
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        composeRule.setContent {
            TravelmoTheme {
                BookingDetailScreen(
                    viewModel = viewModel,
                    tripId = "liverpool", segmentId = "l-stay", uid = OWNER, onBack = { back++ }, onEdit = {}, onTripGone = { gone++ },
                )
            }
        }
        composeRule.waitForIdle()
        composeRule.onNodeWithText("Never import this sender").performScrollTo().performClick()
        composeRule.waitUntil(5_000) { composeRule.onAllNodesWithText("Delete").fetchSemanticsNodes().isNotEmpty() }
        composeRule.onNodeWithText("Delete").performClick()
        composeRule.waitForIdle()
        store.deletedTrips shouldBe listOf("liverpool")
        gone shouldBe 1
        back shouldBe 0
    }

    @Test
    fun `the details say the day the booking starts`() {
        composeRule.setContent { TravelmoTheme { BookingDetails(tour) } }
        composeRule.onNodeWithText("Sun 13 Dec").assertExists()
    }

    @Test
    fun `a one-way rental shows both desks, though they share a name`() {
        val rental = Segment(
            "r", "liverpool", SegmentType.CAR_RENTAL, "Example Cars", "2026-12-12T09:00:00+00:00", "2026-12-14T09:00:00+00:00",
            origin = Place("Example Cars", address = "1 Station Road, Liverpool"), destination = Place("Example Cars", address = "2 Airport Way, Manchester"),
        )
        composeRule.setContent { TravelmoTheme { BookingDetails(rental) } }
        composeRule.onNodeWithText("1 Station Road, Liverpool").assertExists()
        composeRule.onNodeWithText("2 Airport Way, Manchester").assertExists()
    }
}
