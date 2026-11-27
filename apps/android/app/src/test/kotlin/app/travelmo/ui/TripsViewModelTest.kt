package app.travelmo.ui

import app.travelmo.core.journeyGapText
import app.travelmo.core.RefreshShown
import app.travelmo.core.ImapMailbox
import app.travelmo.core.imapMailboxes
import app.travelmo.core.Lead
import app.travelmo.core.LeadUnit
import app.travelmo.core.Reminder
import app.travelmo.core.isReminderId
import app.travelmo.data.MyChecklist

import app.travelmo.core.FlightStatus
import app.travelmo.core.Place
import app.travelmo.core.Segment
import app.travelmo.core.SegmentDraft
import app.travelmo.core.deviceId
import app.travelmo.core.SegmentType
import app.travelmo.data.FlightRefresh
import app.travelmo.core.AccountAccess
import app.travelmo.core.AddressHolder
import app.travelmo.core.Trip
import app.travelmo.core.TravelProfile
import app.travelmo.data.AccessCheck
import app.travelmo.data.OwnProfile
import app.travelmo.data.RideSettings
import app.travelmo.data.TripStore
import app.travelmo.core.HomeCorrection
import app.travelmo.core.BackfillShown
import app.travelmo.data.FastmailStatus
import app.travelmo.data.GmailStatus
import app.travelmo.core.SenderList
import app.travelmo.core.SenderPatterns
import app.travelmo.core.rideNeedKey
import kotlin.time.Instant
import kotlinx.coroutines.flow.first
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import io.kotest.matchers.collections.shouldContain
import io.kotest.matchers.collections.shouldNotContain
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

@OptIn(ExperimentalCoroutinesApi::class)
class TripsViewModelTest {
    /** A store whose save waits to be let through, or fails, as the test says. */
    private class GatedStore(private val fail: Boolean = false) : TripStore by FakeTripStore() {
        val gate = CompletableDeferred<Unit>()
        var saves = 0
        override suspend fun createTrip(id: String, uid: String, title: String, start: String, end: String) {
            saves++
            gate.await()
        }
        override suspend fun saveSegment(tripId: String, draft: SegmentDraft, existingId: String?) {
            saves++
            gate.await()
            if (fail) throw IllegalStateException("Trip no longer exists")
        }
    }

    /**
     * A store whose queries the rules refuse until [approved], as Firestore
     * answers them: trips and shared profiles load empty, and the profile
     * listener waits without answering.
     */
    private class RefusingStore : TripStore by FakeTripStore() {
        var asked = 0
        var profileAsked = 0
        var sharedAsked = 0
        var approved = false
        override fun trips(uid: String, addresses: List<String>): Flow<List<Trip>> {
            asked++
            return flowOf(if (approved) fixtureTrips else emptyList())
        }
        override fun ownProfile(uid: String): Flow<OwnProfile> {
            profileAsked++
            return if (approved) flowOf(OwnProfile(fixtureProfile)) else flow { awaitCancellation() }
        }
        override fun sharedProfiles(addresses: List<String>): Flow<List<TravelProfile>> {
            sharedAsked++
            return flowOf(if (approved) listOf(fixtureSharedProfile) else emptyList())
        }
    }

    /** An access check that answers once [answer] completes, letting [store] in when it says approved. */
    private class FakeAccessCheck(private val store: RefusingStore) : AccessCheck {
        val answer = CompletableDeferred<AccountAccess?>()
        var calls = 0
        override suspend fun check(): AccountAccess? {
            calls++
            return answer.await().also { if (it == AccountAccess.APPROVED) store.approved = true }
        }
    }

    /** A store that answers by address, as Firestore's `array-contains-any` does, with the user document's addresses. */
    private class AddressedStore(holder: AddressHolder) : TripStore by FakeTripStore(addressHolder = holder) {
        val asked = mutableListOf<List<String>>()
        private val work = Trip("work", "Offsite", "2026-12-01", "2026-12-03", "colleague", sharedWith = listOf("owner@work.example"))
        override fun trips(uid: String, addresses: List<String>): Flow<List<Trip>> {
            asked += addresses
            return flowOf(listOf(work).filter { trip -> trip.sharedWith.any { it in addresses } })
        }
    }

    private val draft = SegmentDraft(SegmentType.ACTIVITY, "Walk", null, null, "2026-12-12T10:00:00Z", null, null, null, null)

    @BeforeEach
    fun main() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @AfterEach
    fun reset() = Dispatchers.resetMain()

    @Test
    fun `a save is busy for its form, then done once, and a second tap meanwhile saves nothing`() = runTest {
        val store = GatedStore()
        val viewModel = TripsViewModel(store, OWNER, null)
        viewModel.saveSegment("form-1", "liverpool", draft, null)
        viewModel.outcomes.value shouldBe mapOf("form-1" to Outcome.Busy)
        viewModel.saveSegment("form-1", "liverpool", draft, null)
        store.saves shouldBe 1
        store.gate.complete(Unit)
        viewModel.outcomes.value shouldBe mapOf("form-1" to Outcome.Done)
        viewModel.outcomeSeen("form-1")
        viewModel.outcomes.value shouldBe emptyMap()
    }

    @Test
    fun `Add a trip can't be left while its trip is being saved, and forgets its tries once it can`() = runTest {
        val store = GatedStore()
        val viewModel = TripsViewModel(store, OWNER, null)
        viewModel.addTrip("t1", "Away", "2026-12-01", "2026-12-02")
        viewModel.leaveAddTrip() shouldBe false
        viewModel.outcomes.value shouldBe mapOf("${NEW_TRIP_TOKEN}t1" to Outcome.Busy)
        store.gate.complete(Unit)
        viewModel.leaveAddTrip() shouldBe true
        viewModel.outcomes.value shouldBe emptyMap()
        // A try that failed doesn't hold it.
        viewModel.addTrip("t2", " ", "2026-12-01", "2026-12-02")
        viewModel.leaveAddTrip() shouldBe true
    }

    @Test
    fun `a booking added with no trip in view goes into the trip it falls in, else a new one`() = runTest {
        val store = FakeTripStore()
        val viewModel = TripsViewModel(store, OWNER, null)
        // Liverpool runs 12 to 14 December.
        viewModel.addBooking("in-liverpool", draft)
        viewModel.outcomes.value["in-liverpool"] shouldBe Outcome.Done
        viewModel.addedTo("in-liverpool") shouldBe "liverpool"
        store.saved shouldBe listOf(Triple("liverpool", draft, null))

        val later = draft.copy(start = "2027-03-01T10:00:00Z")
        viewModel.addBooking("new", later)
        viewModel.addedTo("new") shouldBe "new-trip"
        store.addedToNew shouldBe listOf(later)
    }

    @Test
    fun `one form's pending save does not swallow another form's`() = runTest {
        val store = GatedStore()
        val viewModel = TripsViewModel(store, OWNER, null)
        viewModel.saveSegment("form-1", "liverpool", draft, null)
        viewModel.saveSegment("form-2", "liverpool", draft, "l-stay")
        store.saves shouldBe 2
        viewModel.outcomes.value shouldBe mapOf("form-1" to Outcome.Busy, "form-2" to Outcome.Busy)
        store.gate.complete(Unit)
        viewModel.outcomes.value shouldBe mapOf("form-1" to Outcome.Done, "form-2" to Outcome.Done)
    }

    @Test
    fun `a trip edit runs the same way, and a blank name is refused before the store sees it`() = runTest {
        val store = FakeTripStore()
        val viewModel = TripsViewModel(store, OWNER, null)
        viewModel.renameTrip("rename", "liverpool", "  ")
        viewModel.outcomes.value shouldBe mapOf("rename" to Outcome.Failed("Give the trip a name"))
        viewModel.renameTrip("rename", "liverpool", "Merseyside")
        viewModel.outcomes.value shouldBe mapOf("rename" to Outcome.Done)
        store.renamed shouldBe listOf("liverpool" to "Merseyside")
        viewModel.mergeTrips("merge", "dublin", "liverpool")
        viewModel.deleteTrip("delete", "amsterdam")
        store.merged shouldBe listOf("dublin" to "liverpool")
        store.deletedTrips shouldBe listOf("amsterdam")
    }

    @Test
    fun `a flight with nothing booked on the ground asks for a ride or a car, and hiding one goes to the store`() = runTest {
        val store = FakeTripStore()
        val viewModel = TripsViewModel(store, OWNER, null, clock = { Instant.parse(FROZEN_NOW) })
        val settings = RideSettings(companies = fixtureRideCompanies)
        val needs = viewModel.rideNeedsFor(fixtureBostonSegments, settings)
        needs.map(::rideNeedKey) shouldBe listOf("b-out/toAirport", "b-out/car", "b-back/fromAirport")
        // Home corrected to Boston: the same flights read the other way round.
        viewModel.rideNeedsFor(fixtureBostonSegments, settings.copy(homes = listOf(HomeCorrection("Boston", "US", "2020-01-01")))).map(::rideNeedKey) shouldBe
            listOf("b-out/fromAirport", "b-back/toAirport", "b-back/car")
        viewModel.rideNeedsFor(fixtureBostonSegments, settings.copy(hidden = listOf("b-out/car"))).map(::rideNeedKey) shouldBe
            listOf("b-out/toAirport", "b-back/fromAirport")
        viewModel.rideNeedsFor(fixtureBostonSegments, null) shouldBe emptyList()
        viewModel.hideRideNeed("hide", needs[1])
        viewModel.outcomes.value shouldBe mapOf("hide" to Outcome.Done)
        store.hiddenRides shouldBe listOf("b-out/car")
    }

    @Test
    fun `the reports leave out a trip the user is only watching`() = runTest {
        val store = FakeTripStore(
            trips = fixtureTrips + fixtureFlightTrip,
            segments = fixtureSegments + ("sydney" to listOf(fixtureNextFlight.copy(travelers = listOf("Pat Example")))),
            people = listOf(
                app.travelmo.core.Person("me", "Sam Example", bookings = 4, direct = 4),
                app.travelmo.core.Person("mum", "Pat Example", bookings = 1),
            ),
        )
        val viewModel = TripsViewModel(store, OWNER, null, clock = { Instant.parse(FROZEN_NOW) })
        val ids = viewModel.reportTrips.first { it != null }!!.map { it.trip.id }
        ids shouldNotContain fixtureFlightTrip.id
        ids shouldContain "liverpool"
    }

    @Test
    fun `a trip with no flight back says so until the viewer says it goes one way`() = runTest {
        val store = FakeTripStore()
        val viewModel = TripsViewModel(store, OWNER, null, clock = { Instant.parse(FROZEN_NOW) })
        val out = fixtureBostonSegments.filter { it.id == "b-out" }
        viewModel.journeyGapsFor(fixtureBostonTrip, out, RideSettings()).map(::journeyGapText) shouldBe listOf("No flight from Boston back to London found")
        viewModel.journeyGapsFor(fixtureBostonTrip, fixtureBostonSegments, RideSettings()).shouldBeEmpty()
        viewModel.journeyGapsFor(fixtureBostonTrip, out, null).shouldBeEmpty()
        viewModel.markOneWay("one-way", "boston")
        viewModel.outcomes.value shouldBe mapOf("one-way" to Outcome.Done)
        store.rides.value.oneWayTrips shouldBe listOf("boston")
        viewModel.journeyGapsFor(fixtureBostonTrip, out, store.rides.value).shouldBeEmpty()
    }

    @Test
    fun `a trip abroad lists the standing reminders and its one-offs, a trip at home its one-offs alone`() = runTest {
        val viewModel = TripsViewModel(FakeTripStore(), OWNER, null, clock = { Instant.parse(FROZEN_NOW) })
        val settings = RideSettings()
        val boston = viewModel.checklistFor(fixtureBostonTrip, fixtureBostonSegments, fixtureStandingReminders, fixtureBostonChecklist, settings)
        boston?.map { Triple(it.text, it.due, it.done) } shouldBe listOf(
            Triple("Apply for an ESTA", "2026-11-03", false),
            Triple("Pack the plug adapter", "2026-11-23", false),
            Triple("Request prescriptions", "2026-10-25", true),
        ).sortedBy { it.second }
        // Liverpool by train from London: at home, so only its one-offs.
        val liverpool = fixtureTrips.first { it.id == "liverpool" }
        val oneOff = MyChecklist(added = listOf(Reminder("a0", "tour", "Book the tour", date = "2026-12-01")))
        viewModel.checklistFor(liverpool, fixtureSegments.getValue("liverpool"), fixtureStandingReminders, oneOff, settings)?.map { it.id } shouldBe listOf("tour")
        // Nothing while anything loads, nor for a trip that is over.
        viewModel.checklistFor(fixtureBostonTrip, fixtureBostonSegments, null, fixtureBostonChecklist, settings) shouldBe null
        viewModel.checklistFor(fixtureTrips.first { it.id == "lisbon" }, fixtureSegments.getValue("lisbon"), fixtureStandingReminders, MyChecklist(), settings) shouldBe null
    }

    @Test
    fun `reminders are added with an id of their own, ticked off and removed through the store`() = runTest {
        val store = FakeTripStore()
        val viewModel = TripsViewModel(store, OWNER, null)
        viewModel.saveReminder("add", null, Reminder("", "", "Apply for a visa", Lead(30, LeadUnit.DAYS)))
        viewModel.outcomes.value shouldBe mapOf("add" to Outcome.Done)
        val saved = store.standing.value.single()
        saved.slot shouldBe "s0"
        isReminderId(saved.id) shouldBe true
        viewModel.saveReminder("edit", null, saved.copy(lead = Lead(6, LeadUnit.WEEKS)))
        store.standing.value shouldBe listOf(saved.copy(lead = Lead(6, LeadUnit.WEEKS)))
        viewModel.saveReminder("one-off", "boston", Reminder("", "", "Pack", date = "2026-11-23"))
        store.checklists.value.getValue("boston").added.single().slot shouldBe "a0"
        viewModel.setReminderDone("tick", "boston", saved.id, true)
        store.checklists.value.getValue("boston").done shouldBe listOf(saved.id)
        viewModel.removeReminder("remove", null, "s0")
        store.standing.value shouldBe emptyList()
    }

    @Test
    fun `removing a loyalty number found in emails goes to the store`() = runTest {
        val store = FakeTripStore()
        val viewModel = TripsViewModel(store, OWNER, null)
        val found = fixtureProfile.foundLoyalty.first()
        viewModel.removeFoundLoyalty("remove", found)
        viewModel.outcomes.value shouldBe mapOf("remove" to Outcome.Done)
        store.removedFound shouldBe listOf(found)
    }

    @Test
    fun `saying whose a loyalty number is goes to the store`() = runTest {
        val store = FakeTripStore()
        val viewModel = TripsViewModel(store, OWNER, null)
        viewModel.setLoyaltyPerson("whose", "Cove Club", "CC 4455", "Ann Sample")
        viewModel.outcomes.value shouldBe mapOf("whose" to Outcome.Done)
        store.people shouldBe listOf(Triple("Cove Club", "CC 4455", "Ann Sample"))
    }

    @Test
    fun `restoring a cancelled booking goes to the store`() = runTest {
        val store = FakeTripStore()
        val viewModel = TripsViewModel(store, OWNER, null)
        viewModel.restoreSegment("restore", "liverpool", "l-stay")
        viewModel.outcomes.value shouldBe mapOf("restore" to Outcome.Done)
        store.restored shouldBe listOf("liverpool" to "l-stay")
    }

    @Test
    fun `adding a trip needs a name and dates in order and is the viewer's own`() = runTest {
        val store = FakeTripStore()
        val viewModel = TripsViewModel(store, OWNER, null)
        viewModel.createTrip("blank", "t1", " ", "2026-12-01", "2026-12-02")
        viewModel.createTrip("undated", "t2", "Away", null, null)
        viewModel.createTrip("backwards", "t3", "Away", "2026-12-02", "2026-12-01")
        viewModel.createTrip("good", "t4", " Away ", "2026-12-01", "2026-12-01")
        viewModel.outcomes.value shouldBe mapOf(
            "blank" to Outcome.Failed("Give the trip a name"),
            "undated" to Outcome.Failed("Pick its dates"),
            "backwards" to Outcome.Failed("It ends before it starts"),
            "good" to Outcome.Done,
        )
        store.createdTrips shouldBe listOf(Trip("t4", "Away", "2026-12-01", "2026-12-01", OWNER))
    }

    @Test
    fun `marking a booking or a trip cancelled, and restoring the trip, go to the store`() = runTest {
        val store = FakeTripStore()
        val viewModel = TripsViewModel(store, OWNER, null)
        viewModel.cancelSegment("cancel-booking", "liverpool", "l-stay")
        viewModel.cancelTrip("cancel-trip", "liverpool")
        viewModel.restoreTrip("restore-trip", "liverpool")
        viewModel.outcomes.value shouldBe mapOf("cancel-booking" to Outcome.Done, "cancel-trip" to Outcome.Done, "restore-trip" to Outcome.Done)
        store.cancelledSegments shouldBe listOf("liverpool" to "l-stay")
        store.cancelledTrips shouldBe listOf("liverpool")
        store.restoredTrips shouldBe listOf("liverpool")
    }

    @Test
    fun `sharing the profile says whether it exists yet, and waits until that is known`() = runTest {
        val store = FakeTripStore(profile = null)
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL)
        // Before the profile document has answered, nothing is written.
        viewModel.saveTrusted("share", listOf("partner@example.com"))
        store.trusted shouldBe emptyList()
        viewModel.outcomes.value shouldBe mapOf("share" to Outcome.Failed("The profile is still loading; try again"))
        val watching = backgroundScope.launch { viewModel.profileLoaded.collect {} }
        runCurrent()
        viewModel.profileLoaded.value shouldBe true
        viewModel.saveTrusted("share", listOf("partner@example.com"))
        store.trusted shouldBe listOf(Triple(OWNER, false, listOf("partner@example.com")))
        viewModel.outcomes.value shouldBe mapOf("share" to Outcome.Done)
        watching.cancel()
    }

    @Test
    fun `a search finds trips by their bookings once those are read, and by title before`() = runTest {
        val viewModel = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        val watching = backgroundScope.launch { viewModel.searchResult.collect {} }
        runCurrent()
        viewModel.searchResult.value shouldBe null
        viewModel.searchTrips("avanti")
        runCurrent()
        viewModel.searchResult.value shouldBe TripSearchResult(setOf("liverpool"), bookingsSearched = true)
        viewModel.searchTrips("  ")
        runCurrent()
        viewModel.searchResult.value shouldBe null
        watching.cancel()
    }

    @Test
    fun `the reminders switch writes the choice and reads the stored one`() = runTest {
        val store = FakeTripStore()
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL)
        viewModel.setReminderEmail("reminders", false)
        store.reminders shouldBe listOf(false)
        viewModel.outcomes.value shouldBe mapOf("reminders" to Outcome.Done)
    }

    @Test
    fun `the notifications switch registers this phone under the user and forgets it again`() = runTest {
        val store = FakeTripStore()
        val device = FakePushDevice()
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, pushDevice = device)
        val watching = backgroundScope.launch { viewModel.pushState.collect {} }
        runCurrent()
        viewModel.pushState.value shouldBe PushState.Ready(on = false)
        viewModel.setPushDevice("push", true)
        runCurrent()
        val id = deviceId("fcm-token-1")
        store.devices shouldBe listOf(id to "fcm-token-1")
        device.remembered(OWNER) shouldBe id
        viewModel.outcomes.value shouldBe mapOf("push" to Outcome.Done)
        viewModel.setPushDevice("push", false)
        runCurrent()
        store.devices shouldBe listOf(id to "fcm-token-1", id to null)
        device.remembered(OWNER) shouldBe null
        watching.cancel()
    }

    @Test
    fun `without a messaging token the notifications switch is unavailable`() = runTest {
        val viewModel = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, pushDevice = FakePushDevice(token = null))
        val watching = backgroundScope.launch { viewModel.pushState.collect {} }
        runCurrent()
        viewModel.pushState.value shouldBe PushState.Unavailable
        viewModel.setPushDevice("push", true)
        runCurrent()
        viewModel.outcomes.value shouldBe mapOf("push" to Outcome.Failed("This phone has no messaging token"))
        watching.cancel()
    }

    @Test
    fun `a refreshed token replaces the registration it had, and none it did not`() = runTest {
        val store = FakeTripStore()
        val device = FakePushDevice()
        device.tokenChanged(store, OWNER, "fcm-token-2")
        store.devices shouldBe emptyList()
        device.remember(OWNER, deviceId("fcm-token-1"))
        device.tokenChanged(store, OWNER, "fcm-token-2")
        store.devices shouldBe listOf(deviceId("fcm-token-2") to "fcm-token-2", deviceId("fcm-token-1") to null)
        device.remembered(OWNER) shouldBe deviceId("fcm-token-2")
    }

    @Test
    fun `the switch follows a token rotated while it is on screen, and a registration left under an old token moves on load`() = runTest {
        val store = FakeTripStore()
        val device = FakePushDevice(token = "fcm-token-2")
        // Registered under an older token, as a refresh in a dead process leaves it.
        store.registerDevice(OWNER, deviceId("fcm-token-1"), "fcm-token-1")
        device.remember(OWNER, deviceId("fcm-token-1"))
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, pushDevice = device)
        val watching = backgroundScope.launch { viewModel.pushState.collect {} }
        runCurrent()
        device.remembered(OWNER) shouldBe deviceId("fcm-token-2")
        store.devices.last() shouldBe (deviceId("fcm-token-1") to null)
        viewModel.pushState.value shouldBe PushState.Ready(on = true)
        // Rotated again while Settings is open: the state and the switch use the new token.
        device.tokenChanged(store, OWNER, "fcm-token-3")
        runCurrent()
        viewModel.pushState.value shouldBe PushState.Ready(on = true)
        viewModel.setPushDevice("push", false)
        runCurrent()
        store.devices.last() shouldBe (deviceId("fcm-token-3") to null)
        watching.cancel()
    }

    @Test
    fun `deleting the account signs out once the parser has deleted it`() = runTest {
        val deletion = FakeAccountDeletion()
        val viewModel = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, accountDeletion = deletion)
        viewModel.canDeleteAccount shouldBe true
        var signedOut = 0
        viewModel.deleteAccount("delete") { signedOut++ }
        deletion.calls shouldBe 1
        signedOut shouldBe 1
        viewModel.outcomes.value shouldBe mapOf("delete" to Outcome.Done)
    }

    @Test
    fun `a failed deletion says why and leaves the user signed in`() = runTest {
        val deletion = FakeAccountDeletion(failure = "Couldn't delete your account (error 500). Try again.")
        val viewModel = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, accountDeletion = deletion)
        var signedOut = 0
        viewModel.deleteAccount("delete") { signedOut++ }
        signedOut shouldBe 0
        viewModel.outcomes.value shouldBe mapOf("delete" to Outcome.Failed("Couldn't delete your account (error 500). Try again."))
    }

    @Test
    fun `without a parser address the account cannot be deleted here`() = runTest {
        val viewModel = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL)
        viewModel.canDeleteAccount shouldBe false
        var signedOut = 0
        viewModel.deleteAccount("delete") { signedOut++ }
        signedOut shouldBe 0
        viewModel.outcomes.value shouldBe mapOf("delete" to Outcome.Failed("Delete your account from Settings on the web."))
    }

    @Test
    fun `regrouping and starting over go to the parser and say what they did`() = runTest {
        val actions = FakeTripActions()
        val viewModel = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, tripActions = actions)
        viewModel.canRunTripActions shouldBe true
        viewModel.regroupTrips("regroup")
        viewModel.tripNotice.value shouldBe "Done: 2 trips rebuilt, 1 trip merged away."
        viewModel.startOver("delete")
        viewModel.tripNotice.value shouldBe "Deleted 3 trips. Reading your email again from the start."
        actions.calls shouldBe listOf("regroup", "startOver")
        viewModel.outcomes.value shouldBe mapOf("regroup" to Outcome.Done, "delete" to Outcome.Done)
    }

    @Test
    fun `refresh from email shows how far it got, and its buttons go to the parser`() = runTest {
        val running = RefreshShown(scanned = 120, done = false, updatedAt = "2026-11-22T11:59:00Z", total = 340, running = true)
        val actions = FakeTripActions()
        val viewModel = TripsViewModel(FakeTripStore(refreshProgress = running), OWNER, OWNER_EMAIL, clock = { Instant.parse("2026-11-22T12:00:00Z") }, tripActions = actions)
        val watching = launch { viewModel.refresh.collect {} }
        runCurrent()
        viewModel.refresh.value shouldBe TripsViewModel.RefreshState(running, reading = true)
        viewModel.stopRefresh("stop")
        viewModel.startRefresh("start", restart = false)
        viewModel.startRefresh("again", restart = true)
        viewModel.startRefresh("everything", restart = true, everything = true)
        actions.calls shouldBe listOf("stopRefresh", "refresh", "refresh from the start", "refresh everything")
        watching.cancel()

        // Stalled: nothing saved for half an hour reads as stopped, for Continue.
        val stalled = TripsViewModel(FakeTripStore(refreshProgress = running), OWNER, OWNER_EMAIL, clock = { Instant.parse("2026-11-22T13:00:00Z") })
        val watchingStalled = launch { stalled.refresh.collect {} }
        runCurrent()
        stalled.refresh.value.reading shouldBe false
        watchingStalled.cancel()
    }

    @Test
    fun `a trip action that fails says why, and without a parser address points to the web`() = runTest {
        val failing = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, tripActions = FakeTripActions(failure = "Couldn't reach Travelmo. Check your connection and try again."))
        failing.regroupTrips("regroup")
        failing.tripNotice.value shouldBe null
        failing.outcomes.value shouldBe mapOf("regroup" to Outcome.Failed("Couldn't reach Travelmo. Check your connection and try again."))
        val none = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL)
        none.canRunTripActions shouldBe false
        none.startOver("delete")
        none.outcomes.value shouldBe mapOf("delete" to Outcome.Failed("Use Settings on the web for this."))
    }

    @Test
    fun `import review reads a message again and teaches senders, saying what each did`() = runTest {
        val store = FakeTripStore()
        val review = FakeImportReview()
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, importReview = review)
        viewModel.reimport("again", "ticket")
        review.asked shouldBe listOf("ticket")
        viewModel.learnSender("learn", "news", "news.example", SenderList.ALLOW)
        store.patterns.value shouldBe SenderPatterns(allow = listOf("news.example"))
        viewModel.reviewNotices.value shouldBe mapOf("ticket" to "Read, not a booking", "news" to "Always importing news.example")
        viewModel.reviewReports.value shouldBe mapOf("ticket" to "Travelmo import report\nEmail: ticket")
        viewModel.reviewNoticeSeen("ticket")
        viewModel.reviewReports.value shouldBe emptyMap()
    }

    @Test
    fun `gmail shows how far each mailbox's reading got, and its buttons go to the parser for that mailbox`() = runTest {
        val reading = BackfillShown(scanned = 600, imported = 2, done = false, updatedAt = "2026-11-22T11:59:00Z", running = true)
        val read = BackfillShown(scanned = 900, imported = 3, done = true, updatedAt = "2026-11-01T00:00:00Z")
        val actions = FakeGmailActions()
        val viewModel = TripsViewModel(
            FakeTripStore(gmailStatuses = listOf(GmailStatus("owner@example.com", reading), GmailStatus("owner@work.example", read))), OWNER, OWNER_EMAIL,
            clock = { Instant.parse("2026-11-22T12:00:00Z") }, gmailActions = actions,
        )
        val watching = launch { viewModel.gmail.collect {} }
        runCurrent()
        val state = viewModel.gmail.value as TripsViewModel.GmailState.Connected
        state.mailboxes shouldBe listOf(
            TripsViewModel.MailboxShown("owner@example.com", reading, reading = true),
            TripsViewModel.MailboxShown("owner@work.example", read, reading = false),
        )
        state.canConnectMore shouldBe true
        viewModel.connectGmail("g")
        viewModel.gmailConsentUrl.value shouldBe "https://accounts.example/consent"
        viewModel.gmailConsentOpened()
        viewModel.gmailConsentUrl.value shouldBe null
        viewModel.outcomeSeen("g")
        viewModel.startReading("g", "owner@work.example", restart = true)
        viewModel.outcomeSeen("g")
        viewModel.stopReading("g", "owner@example.com")
        viewModel.outcomeSeen("g")
        viewModel.disconnectGmail("g", "owner@work.example")
        actions.calls shouldBe listOf("connect", "restart owner@work.example", "stop owner@example.com", "disconnect owner@work.example")
        watching.cancel()
    }

    @Test
    fun `gmail offers no more mailboxes past the limit, and none connected is not connected`() = runTest {
        val five = (1..5).map { GmailStatus("box$it@example.com") }
        val full = TripsViewModel(FakeTripStore(gmailStatuses = five), OWNER, OWNER_EMAIL, clock = { Instant.parse("2026-11-22T12:00:00Z") })
        val none = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, clock = { Instant.parse("2026-11-22T12:00:00Z") })
        val watching = launch {
            launch { full.gmail.collect {} }
            none.gmail.collect {}
        }
        runCurrent()
        (full.gmail.value as TripsViewModel.GmailState.Connected).canConnectMore shouldBe false
        none.gmail.value shouldBe TripsViewModel.GmailState.NotConnected
        watching.cancel()
    }

    @Test
    fun `fastmail connects with a token and its buttons go to its own parser routes, not Gmail's`() = runTest {
        val done = BackfillShown(scanned = 80, imported = 3, done = true, updatedAt = "2026-11-22T11:00:00Z")
        val gmail = FakeGmailActions()
        val fastmail = FakeFastmailActions()
        val viewModel = TripsViewModel(
            FakeTripStore(fastmailStatus = FastmailStatus("me@fastmail.example", done)), OWNER, OWNER_EMAIL,
            clock = { Instant.parse("2026-11-22T12:00:00Z") }, gmailActions = gmail, fastmailActions = fastmail,
        )
        val watching = launch {
            launch { viewModel.gmail.collect {} }
            viewModel.fastmail.collect {}
        }
        runCurrent()
        viewModel.gmail.value shouldBe TripsViewModel.GmailState.NotConnected
        viewModel.fastmail.value shouldBe TripsViewModel.FastmailState.Connected(TripsViewModel.MailboxShown("me@fastmail.example", done, reading = false))
        viewModel.canUseFastmail shouldBe true
        // Pasted with the space a copy often brings.
        viewModel.connectFastmail("f", " fmu1-token ")
        runCurrent()
        viewModel.outcomeSeen("f")
        viewModel.startFastmailReading("f", restart = true)
        runCurrent()
        viewModel.outcomeSeen("f")
        viewModel.stopFastmailReading("f")
        runCurrent()
        viewModel.outcomeSeen("f")
        viewModel.disconnectFastmail("f")
        runCurrent()
        fastmail.calls shouldBe listOf("connect fmu1-token", "restart", "stop", "disconnect")
        gmail.calls shouldBe emptyList()
        watching.cancel()
    }

    @Test
    fun `fastmail says why it refused a token, and asks for one when none was pasted`() = runTest {
        val refusal = "That API token can change your mail. Make a read-only one instead."
        val fastmail = FakeFastmailActions(refusal = refusal)
        val viewModel = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, fastmailActions = fastmail)
        viewModel.connectFastmail("f", "fmu1-writable")
        runCurrent()
        viewModel.outcomes.value["f"] shouldBe Outcome.Failed(refusal)
        viewModel.outcomeSeen("f")
        viewModel.connectFastmail("f", "  ")
        runCurrent()
        viewModel.outcomes.value["f"] shouldBe Outcome.Failed("Paste your Fastmail API token.")
        fastmail.calls shouldBe listOf("connect fmu1-writable")
    }

    @Test
    fun `IMAP mailboxes connect with an app password and each reads and disconnects through its own routes`() = runTest {
        val done = BackfillShown(scanned = 40, imported = 2, done = true, updatedAt = "2026-11-22T11:00:00Z")
        val gmail = FakeGmailActions()
        val imap = FakeImapActions()
        val mailboxes = listOf(
            ImapMailbox("trips@yahoo.com", "2026-11-02T00:00:00Z", loginFailedAt = "2026-11-22T10:00:00Z"),
            ImapMailbox("me@icloud.com", "2026-11-01T00:00:00Z", done),
        )
        val viewModel = TripsViewModel(
            FakeTripStore(imapStatuses = imapMailboxes(mailboxes)), OWNER, OWNER_EMAIL,
            clock = { Instant.parse("2026-11-22T12:00:00Z") }, gmailActions = gmail, imapActions = imap,
        )
        val watching = launch { viewModel.imap.collect {} }
        runCurrent()
        val loaded = viewModel.imap.value as TripsViewModel.ImapState.Loaded
        loaded.mailboxes shouldBe listOf(
            TripsViewModel.ImapShown(TripsViewModel.MailboxShown("me@icloud.com", done, reading = false), loginFailed = false),
            TripsViewModel.ImapShown(TripsViewModel.MailboxShown("trips@yahoo.com", null, reading = false), loginFailed = true),
        )
        loaded.canConnectMore shouldBe true
        viewModel.canUseImap shouldBe true
        // A known provider's server is filled in by the parser, so none is sent.
        viewModel.connectImap("i", " new@icloud.com ", "abcd-efgh", server = "ignored.example.com")
        runCurrent()
        viewModel.outcomeSeen("i")
        viewModel.connectImap("i", "me@example.org", "secret", server = "imap.example.org")
        runCurrent()
        viewModel.outcomeSeen("i")
        viewModel.startImapReading("i", "trips@yahoo.com", restart = false)
        runCurrent()
        viewModel.outcomeSeen("i")
        viewModel.stopImapReading("i", "trips@yahoo.com")
        runCurrent()
        viewModel.outcomeSeen("i")
        viewModel.disconnectImap("i", "me@icloud.com")
        runCurrent()
        imap.calls shouldBe listOf(
            "connect new@icloud.com -",
            "connect me@example.org imap.example.org",
            "start trips@yahoo.com",
            "stop trips@yahoo.com",
            "disconnect me@icloud.com",
        )
        gmail.calls shouldBe emptyList()
        watching.cancel()
    }

    @Test
    fun `IMAP sends Gmail and Fastmail addresses to their sections and says what is missing`() = runTest {
        val imap = FakeImapActions(refusal = "The server didn't accept that address and app password. Check them, or make a new app password.")
        val viewModel = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, imapActions = imap)
        suspend fun failure(address: String, password: String, server: String = ""): Outcome {
            viewModel.connectImap("i", address, password, server)
            runCurrent()
            return viewModel.outcomes.value["i"]!!.also { viewModel.outcomeSeen("i") }
        }
        failure("me@gmail.com", "x") shouldBe Outcome.Failed("For a Gmail address, use Connect Gmail above.")
        failure("me@fastmail.com", "x") shouldBe Outcome.Failed("For a Fastmail address, use the Fastmail section above.")
        failure("me@icloud.com", " ") shouldBe Outcome.Failed("Enter an app password.")
        failure("me@example.org", "x", "not a server") shouldBe Outcome.Failed("Enter your mail server, such as imap.example.com.")
        imap.calls shouldBe emptyList()
        failure("me@icloud.com", "wrong") shouldBe Outcome.Failed("The server didn't accept that address and app password. Check them, or make a new app password.")
        imap.calls shouldBe listOf("connect me@icloud.com -")
    }

    @Test
    fun `five IMAP mailboxes are the most`() = runTest {
        val five = (1..5).map { ImapMailbox("me$it@example.org", "2026-11-0${it}T00:00:00Z") }
        val viewModel = TripsViewModel(FakeTripStore(imapStatuses = five), OWNER, OWNER_EMAIL, imapActions = FakeImapActions())
        val watching = launch { viewModel.imap.collect {} }
        runCurrent()
        (viewModel.imap.value as TripsViewModel.ImapState.Loaded).canConnectMore shouldBe false
        watching.cancel()
    }

    @Test
    fun `a build with no parser sends Fastmail to the web`() {
        TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL).canUseFastmail shouldBe false
    }

    @Test
    fun `an account the access check lets in sees its trips`() = runTest {
        val store = RefusingStore()
        val check = FakeAccessCheck(store)
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, accessCheck = check)
        val watching = launch { viewModel.trips.collect {} }
        runCurrent()
        viewModel.trips.value shouldBe emptyList()
        check.answer.complete(AccountAccess.APPROVED)
        runCurrent()
        check.calls shouldBe 1
        store.asked shouldBe 2
        viewModel.trips.value shouldBe fixtureTrips
        watching.cancel()
    }

    @Test
    fun `an account the access check lets in sees its profiles`() = runTest {
        val store = RefusingStore()
        val check = FakeAccessCheck(store)
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, accessCheck = check)
        val watching = launch { viewModel.trips.collect {} }
        val profile = launch { viewModel.profileLoaded.collect {} }
        val people = launch { viewModel.people.collect {} }
        runCurrent()
        viewModel.profileLoaded.value shouldBe false
        viewModel.sharedProfiles.value shouldBe emptyList()
        check.answer.complete(AccountAccess.APPROVED)
        runCurrent()
        viewModel.profileLoaded.value shouldBe true
        viewModel.ownProfile.value shouldBe fixtureProfile
        viewModel.sharedProfiles.value shouldBe listOf(fixtureSharedProfile)
        listOf(watching, profile, people).forEach { it.cancel() }
    }

    @Test
    fun `an account still waiting is not asked for its trips again`() = runTest {
        val store = RefusingStore()
        val check = FakeAccessCheck(store)
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, accessCheck = check)
        val watching = launch { viewModel.trips.collect {} }
        val people = launch { viewModel.people.collect {} }
        check.answer.complete(AccountAccess.NONE)
        runCurrent()
        check.calls shouldBe 1
        store.asked shouldBe 1
        store.profileAsked shouldBe 1
        store.sharedAsked shouldBe 1
        viewModel.trips.value shouldBe emptyList()
        watching.cancel()
        people.cancel()
    }

    @Test
    fun `lists the trips shared with an address the user confirmed, and lets them edit its bookings`() = runTest {
        val store = AddressedStore(AddressHolder(emails = listOf("owner@work.example")))
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL)
        val watching = launch { viewModel.trips.collect {} }
        runCurrent()
        viewModel.addresses.value shouldBe listOf(OWNER_EMAIL, "owner@work.example")
        store.asked.last() shouldBe listOf(OWNER_EMAIL, "owner@work.example")
        viewModel.trips.value?.map { it.id } shouldBe listOf("work")
        watching.cancel()
    }

    @Test
    fun `adding an address mails its link, and one already the user's is refused at once`() = runTest {
        val links = FakeEmailLinks()
        val viewModel = TripsViewModel(FakeTripStore(addressHolder = AddressHolder(emails = listOf("owner@work.example"))), OWNER, OWNER_EMAIL, emailLinks = links)
        val watching = launch { viewModel.addressHolder.collect {} }
        runCurrent()
        viewModel.addEmail("add", " New@Example.org ")
        viewModel.outcomes.value["add"] shouldBe Outcome.Done
        links.added shouldBe listOf("new@example.org")
        viewModel.addEmail("again", "OWNER@work.example")
        viewModel.outcomes.value["again"] shouldBe Outcome.Failed("That address is already yours.")
        viewModel.removeEmail("remove", "owner@work.example")
        links.removed shouldBe listOf("owner@work.example")
        watching.cancel()
    }

    @Test
    fun `says the parser's refusal, and that a build without one cannot add`() = runTest {
        val refused = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, emailLinks = FakeEmailLinks("That address belongs to another Travelmo account."))
        refused.addEmail("add", "taken@example.org")
        refused.outcomes.value["add"] shouldBe Outcome.Failed("That address belongs to another Travelmo account.")
        val none = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL)
        none.canLinkEmails shouldBe false
        none.addEmail("add", "new@example.org")
        none.outcomes.value["add"] shouldBe Outcome.Failed("Change your email addresses from Settings on the web.")
    }

    @Test
    fun `a failed save says why, to the form that asked`() = runTest {
        val store = GatedStore(fail = true)
        val viewModel = TripsViewModel(store, OWNER, null)
        viewModel.saveSegment("form-2", "liverpool", draft, "l-stay")
        store.gate.complete(Unit)
        viewModel.outcomes.value shouldBe mapOf("form-2" to Outcome.Failed("Trip no longer exists"))
    }

    // An invented flight leaving Sydney at 09:00 local (22:00Z the day before).
    private val flight = Segment(
        "f1", "sydney", SegmentType.FLIGHT, "XX 100 SYD to SIN", "2026-12-13T09:00:00+11:00", "2026-12-13T15:30:00+08:00",
        origin = Place("Sydney", code = "SYD"),
    )
    private val gate = FlightStatus(
        ident = "XX100", date = "2026-12-13", origin = "SYD", found = true, departureGate = "8", baggageClaim = "16",
        scheduledOut = "2026-12-12T22:00:00Z", scheduledIn = "2026-12-13T07:30:00Z", checkedAt = "2026-12-12T20:00:00Z",
    )
    private fun flightModel(at: String, statuses: Map<String, FlightStatus>, asked: MutableList<String>) = TripsViewModel(
        FakeTripStore(segments = mapOf("sydney" to listOf(flight)), flightStatuses = statuses), OWNER, OWNER_EMAIL,
        clock = { Instant.parse(at) },
        flightRefresh = FlightRefresh { asked += it },
    )

    @Test
    fun `an open trip has its flight looked at once one is due, and not before`() = runTest {
        val asked = mutableListOf<String>()
        flightModel("2026-12-12T15:00:00Z", emptyMap(), asked).refreshFlights("sydney")
        asked shouldBe emptyList()
        flightModel("2026-12-12T20:00:30Z", mapOf("XX100_2026-12-13_SYD" to gate), asked).refreshFlights("sydney")
        asked shouldBe emptyList()
        flightModel("2026-12-12T20:01:00Z", mapOf("XX100_2026-12-13_SYD" to gate), asked).refreshFlights("sydney")
        asked shouldBe listOf("sydney")
    }

    @Test
    fun `a flight row says its gate before takeoff and its carousel after`() = runTest {
        val viewModel = flightModel("2026-12-12T21:00:00Z", mapOf("XX100_2026-12-13_SYD" to gate), mutableListOf())
        val statuses = viewModel.flightStatuses("sydney").first()
        statuses shouldBe mapOf("XX100_2026-12-13_SYD" to gate)
        viewModel.flightLines(flight, statuses) shouldBe listOf("Departs from gate 8")
        flightModel("2026-12-12T23:00:00Z", statuses, mutableListOf()).flightLines(flight, statuses) shouldBe listOf("Bags on carousel 16")
        flightModel("2026-12-10T21:00:00Z", emptyMap(), mutableListOf()).flightLines(flight, statuses) shouldBe emptyList()
    }

    @Test
    fun `the list reads the status of each trip under way's next flight`() = runTest {
        val viewModel = TripsViewModel(flightTripStore(), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        val state = viewModel.state.first { it.groups != null && "sydney" in it.segmentsByTrip && it.flightStatuses.isNotEmpty() }
        state.flightStatuses shouldBe mapOf("XX100_2026-11-02_SYD" to fixtureNextFlightStatus)
    }

    @Test
    fun `I've checked in marks the viewer alone and undo takes it back`() = runTest {
        val store = flightTripStore()
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        viewModel.setCheckedIn("t", "sydney", "s-flight", true)
        viewModel.checkedIn("sydney").first { it == setOf("s-flight") }
        viewModel.state.first { it.checkedIn["sydney"] == setOf("s-flight") }
        viewModel.outcomes.first { it["t"] == Outcome.Done }
        viewModel.outcomeSeen("t")
        viewModel.setCheckedIn("t", "sydney", "s-flight", false)
        viewModel.checkedIn("sydney").first { it == emptySet<String>() }
    }

    @Test
    fun `the list's titles and missing journeys are worked out where the app asks, off the main thread`() = runTest {
        val viewModel = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) }, compute = Dispatchers.Default)
        val state = withContext(Dispatchers.Default) {
            withTimeout(10_000) { viewModel.state.first { it.groups != null && it.missing.isNotEmpty() } }
        }
        state.titles.values shouldContain "Paris"
        state.missing.values.any { it.startsWith("No flight from") } shouldBe true
    }

    @Test
    fun `reportTrips reads each trip once per version and reuses local cache until evicted`() = runTest {
        val tripA = Trip("a", "Paris", "2026-05-01", "2026-05-03", OWNER, updatedAt = "2026-05-01T00:00:00Z")
        val tripB = Trip("b", "Rome", "2026-06-01", "2026-06-03", OWNER, updatedAt = "2026-06-01T00:00:00Z")
        val segA = listOf(Segment("sa1", "a", SegmentType.LODGING, "Hotel A", "2026-05-01T15:00:00+02:00", "2026-05-03T11:00:00+02:00"))
        val segB = listOf(
            Segment("sb1", "b", SegmentType.LODGING, "Hotel B1", "2026-06-01T15:00:00+02:00", "2026-06-02T11:00:00+02:00"),
            Segment("sb2", "b", SegmentType.LODGING, "Hotel B2", "2026-06-02T15:00:00+02:00", "2026-06-03T11:00:00+02:00"),
        )
        val base = FakeTripStore(trips = listOf(tripA, tripB), segments = mapOf("a" to segA, "b" to segB))
        val onceCalls = mutableListOf<String>()
        val cacheCalls = mutableListOf<String>()
        var cacheResponses: Map<String, List<Segment>?> = mapOf("a" to segA, "b" to segB)
        val store = object : TripStore by base {
            override suspend fun segmentsOnce(tripId: String): app.travelmo.data.Seen<List<Segment>> {
                onceCalls += tripId
                return app.travelmo.data.Seen(base.segments(tripId).first(), confirmed = true)
            }

            override suspend fun cachedSegments(tripId: String): List<Segment>? {
                cacheCalls += tripId
                return cacheResponses[tripId]
            }
        }
        val versions = app.travelmo.data.InMemorySegmentVersionsStore()

        // First run: no manifest yet, reads both trips once and records (updatedAt, count).
        val first = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) }, segmentVersionsStore = versions)
        first.reportTrips.first { it != null }!!.map { it.trip.id } shouldBe listOf("a", "b")
        onceCalls.sorted() shouldBe listOf("a", "b")
        cacheCalls.shouldBeEmpty()

        // Simulated restart with the same manifest: trip a hits cache (count matches), trip b is
        // partially evicted (1 != 2) and falls back to segmentsOnce.
        onceCalls.clear()
        cacheResponses = mapOf("a" to segA, "b" to segB.take(1))
        val second = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) }, segmentVersionsStore = versions)
        val loaded = second.reportTrips.first { it != null }!!
        loaded.first { it.trip.id == "b" }.segments.size shouldBe 2
        cacheCalls.sorted() shouldBe listOf("a", "b")
        onceCalls shouldBe listOf("b")
    }

    @Test
    fun `reportTrips does not cache or persist unconfirmed offline reads and refreshes on reconnect`() = runTest {
        val tripA = Trip("a", "Paris", "2026-05-01", "2026-05-03", OWNER, updatedAt = "2026-05-01T00:00:00Z")
        val segA = listOf(Segment("sa1", "a", SegmentType.LODGING, "Hotel A", "2026-05-01T15:00:00+02:00", "2026-05-03T11:00:00+02:00"))
        val base = FakeTripStore(trips = listOf(tripA), segments = mapOf("a" to segA))
        var online = false
        val onceCalls = mutableListOf<String>()
        val cacheCalls = mutableListOf<String>()
        val reconnected = kotlinx.coroutines.flow.MutableSharedFlow<Unit>()
        val store = object : TripStore by base {
            override suspend fun segmentsOnce(tripId: String): app.travelmo.data.Seen<List<Segment>> {
                onceCalls += tripId
                return if (online) app.travelmo.data.Seen(segA, confirmed = true)
                else app.travelmo.data.Seen(emptyList(), confirmed = false)
            }

            override suspend fun cachedSegments(tripId: String): List<Segment>? {
                cacheCalls += tripId
                return emptyList()
            }
        }
        val versions = app.travelmo.data.InMemorySegmentVersionsStore()

        // First open offline while staying subscribed to reportTrips: returns local cache, does not persist.
        val vm = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) }, segmentVersionsStore = versions, reconnected = reconnected)
        val collected = mutableListOf<List<app.travelmo.core.TripWithSegments>?>()
        val job = launch { vm.reportTrips.collect { collected += it } }
        runCurrent()
        collected.last()!!.first().segments.shouldBeEmpty()
        versions.read() shouldBe null

        // Connectivity returns without leaving the screen: refreshes in place and persists the confirmed version.
        online = true
        reconnected.emit(Unit)
        runCurrent()
        collected.last()!!.first().segments shouldBe segA
        onceCalls shouldBe listOf("a", "a")
        cacheCalls.shouldBeEmpty()

        // Subsequent reconnect events once confirmed trigger no extra reads.
        reconnected.emit(Unit)
        runCurrent()
        onceCalls shouldBe listOf("a", "a")
        job.cancel()

        // Simulated restart now sees the confirmed manifest and uses cachedSegments.
        val restartedStore = object : TripStore by base {
            override suspend fun segmentsOnce(tripId: String): app.travelmo.data.Seen<List<Segment>> {
                onceCalls += tripId
                return app.travelmo.data.Seen(segA, confirmed = true)
            }

            override suspend fun cachedSegments(tripId: String): List<Segment>? {
                cacheCalls += tripId
                return segA
            }
        }
        val restarted = TripsViewModel(restartedStore, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) }, segmentVersionsStore = versions)
        restarted.reportTrips.first { it != null }!!.first().segments shouldBe segA
        cacheCalls shouldBe listOf("a")
        onceCalls shouldBe listOf("a", "a")
    }

    @Test
    fun `shares one segments, flightStatus, people, and gmailStatuses listener across consumers and peeks cached data`() = runTest {
        val base = flightTripStore()
        var segmentListeners = 0
        var statusListeners = 0
        var peopleListeners = 0
        var gmailListeners = 0
        val store = object : TripStore by base {
            override fun segments(tripId: String): Flow<List<Segment>> {
                segmentListeners++
                return base.segments(tripId)
            }
            override fun flightStatus(key: String): Flow<FlightStatus?> {
                statusListeners++
                return base.flightStatus(key)
            }
            override fun people(uid: String): Flow<List<app.travelmo.core.Person>> {
                peopleListeners++
                return base.people(uid)
            }
            override fun gmailStatuses(uid: String): Flow<List<GmailStatus>> {
                gmailListeners++
                return base.gmailStatuses(uid)
            }
        }
        val vm = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        val jobs = listOf(
            backgroundScope.launch { vm.trips.collect {} },
            backgroundScope.launch { vm.segments("sydney").collect {} },
            backgroundScope.launch { vm.flightStatuses("sydney").collect {} },
            backgroundScope.launch { vm.travelers.collect {} },
            backgroundScope.launch { vm.reportTrips.collect {} },
            backgroundScope.launch { vm.gmail.collect {} },
            backgroundScope.launch { vm.gmailMailboxes.collect {} },
        )
        runCurrent()
        // Repeated refreshFlights reuses the live segment and flight-status streams without attaching new listeners.
        vm.refreshFlights("sydney")
        vm.refreshFlights("sydney")
        runCurrent()

        segmentListeners shouldBe 1
        statusListeners shouldBe 1
        peopleListeners shouldBe 1
        gmailListeners shouldBe 1
        vm.peekTrip("sydney")?.id shouldBe "sydney"
        vm.peekSegments("sydney")?.map { it.id } shouldBe listOf("s-flight")
        jobs.forEach { it.cancel() }
    }

    @Test
    fun `unknownSegments reads once with bounded cache and attempts each failing flag repair once per version`() = runTest {
        val unknownTrip = Trip("u1", "Oslo", "2026-08-01", "2026-08-03", OWNER, updatedAt = "2026-08-01T00:00:00Z")
        val segs = listOf(Segment("s1", "u1", SegmentType.LODGING, "Hotel Oslo", "2026-08-01T15:00:00+02:00", "2026-08-03T11:00:00+02:00", travelers = listOf("Pat")))
        val base = FakeTripStore(
            trips = listOf(unknownTrip),
            segments = mapOf("u1" to segs),
            people = listOf(app.travelmo.core.Person("me", "Sam", bookings = 4, direct = 4)),
        )
        var liveListeners = 0
        var onceReads = 0
        var repairCalls = 0
        val store = object : TripStore by base {
            override fun segments(tripId: String): Flow<List<Segment>> {
                liveListeners++
                return base.segments(tripId)
            }
            override suspend fun segmentsOnce(tripId: String): app.travelmo.data.Seen<List<Segment>> {
                onceReads++
                return app.travelmo.data.Seen(segs, confirmed = true)
            }
            override suspend fun repairTripFlags(tripId: String) {
                repairCalls++
                throw IllegalStateException("offline")
            }
        }
        val vm = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        val job = backgroundScope.launch { vm.watchingTrips.collect {} }
        runCurrent()
        vm.watchingTrips.value shouldBe setOf("u1")
        liveListeners shouldBe 0
        onceReads shouldBe 1
        repairCalls shouldBe 1

        // Collecting segments directly for the same unchanged trip does not retry the failed repair at the same updatedAt.
        val segJob = backgroundScope.launch { vm.segments("u1").collect {} }
        runCurrent()
        repairCalls shouldBe 1
        segJob.cancel()
        job.cancel()
    }

    @Test
    fun `reviewAll caches completed search records across clear and re-search`() = runTest {
        val base = FakeTripStore()
        var allParsedCalls = 0
        val store = object : TripStore by base {
            override fun allParsed(uid: String): Flow<app.travelmo.data.SearchedRecords> {
                allParsedCalls++
                return base.allParsed(uid)
            }
        }
        val vm = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        val job = backgroundScope.launch { vm.reviewAll.collect {} }
        runCurrent()
        allParsedCalls shouldBe 0
        vm.setReviewSearching(true)
        runCurrent()
        allParsedCalls shouldBe 1
        vm.reviewAll.value?.done shouldBe true
        // Clearing and searching again reuses the cached records without re-reading Firestore.
        vm.setReviewSearching(false)
        runCurrent()
        vm.setReviewSearching(true)
        runCurrent()
        allParsedCalls shouldBe 1
        job.cancel()
    }

    @Test
    fun `reviewAll does not cache failed or unconfirmed search results and retries on next search`() = runTest {
        val base = FakeTripStore()
        var allParsedCalls = 0
        var fail = true
        val store = object : TripStore by base {
            override fun allParsed(uid: String): Flow<app.travelmo.data.SearchedRecords> {
                allParsedCalls++
                return if (fail) flowOf(app.travelmo.data.SearchedRecords(emptyList(), done = true, confirmed = false))
                else base.allParsed(uid)
            }
        }
        val vm = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        val job = backgroundScope.launch { vm.reviewAll.collect {} }
        vm.setReviewSearching(true)
        runCurrent()
        allParsedCalls shouldBe 1
        vm.reviewAll.value?.done shouldBe true
        vm.reviewAll.value?.confirmed shouldBe false

        // Clearing and re-entering search retries because the failed read was not cached.
        fail = false
        vm.setReviewSearching(false)
        runCurrent()
        vm.setReviewSearching(true)
        runCurrent()
        allParsedCalls shouldBe 2
        vm.reviewAll.value?.confirmed shouldBe true

        // Once confirmed, clearing and re-entering reuses the cache.
        vm.setReviewSearching(false)
        runCurrent()
        vm.setReviewSearching(true)
        runCurrent()
        allParsedCalls shouldBe 2
        job.cancel()
    }

    @Test
    fun `reviewAll refreshes cached search when new imports advance past the live latest window`() = runTest {
        fun rec(id: String, idx: Int) = app.travelmo.core.ParsedRecord(
            messageId = id,
            outcome = "not_booking",
            processedAt = "2026-10-30T${(idx / 60).toString().padStart(2, '0')}:${(idx % 60).toString().padStart(2, '0')}:00Z",
        )
        val initial = listOf(rec("old2", 2), rec("old1", 1))
        val latestFlow = kotlinx.coroutines.flow.MutableStateFlow<List<app.travelmo.core.ParsedRecord>?>(initial)
        var allRecords = initial
        var allParsedCalls = 0
        val base = FakeTripStore(parsed = initial)
        val store = object : TripStore by base {
            override fun latestParsed(uid: String): Flow<List<app.travelmo.core.ParsedRecord>?> = latestFlow
            override fun allParsed(uid: String): Flow<app.travelmo.data.SearchedRecords> {
                allParsedCalls++
                return flowOf(app.travelmo.data.SearchedRecords(allRecords, done = true, confirmed = true))
            }
        }
        val vm = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        val job = backgroundScope.launch { vm.reviewAll.collect {} }
        vm.setReviewSearching(true)
        runCurrent()
        allParsedCalls shouldBe 1

        // Fewer than REVIEW_RECENT new records keep using the cache.
        val fewNew = listOf(rec("new1", 10)) + initial
        latestFlow.value = fewNew
        vm.setReviewSearching(false)
        runCurrent()
        vm.setReviewSearching(true)
        runCurrent()
        allParsedCalls shouldBe 1

        // Once a full REVIEW_RECENT window of newer imports arrives, clearing and searching re-reads history.
        val manyNew = (1..app.travelmo.core.REVIEW_RECENT).map { i -> rec("batch$i", 100 + i) }.reversed()
        allRecords = manyNew + initial
        vm.setReviewSearching(false)
        runCurrent()
        latestFlow.value = manyNew
        runCurrent()
        // Not searching yet: invalidating does not trigger an eager read.
        allParsedCalls shouldBe 1
        vm.setReviewSearching(true)
        runCurrent()
        allParsedCalls shouldBe 2
        vm.reviewAll.value?.records?.first()?.messageId shouldBe "batch${app.travelmo.core.REVIEW_RECENT}"
        job.cancel()
    }

    @Test
    fun `reportHomesNow recomputes when home settings change after reportHomes stops collecting`() = runTest {
        val trip = Trip("t1", "Paris", "2026-06-01", "2026-06-05", OWNER, updatedAt = "2026-06-01T00:00:00Z")
        val segs = listOf(Segment("s1", "t1", SegmentType.LODGING, "Hotel Paris", "2026-06-01T15:00:00+02:00", "2026-06-05T11:00:00+02:00"))
        val store = FakeTripStore(
            trips = listOf(trip),
            segments = mapOf("t1" to segs),
        )
        store.setHomeCorrections(OWNER, listOf(HomeCorrection(city = "London", from = "2025-01-01", country = "GB")))
        val vm = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) })
        val tripsJob = backgroundScope.launch { vm.reportTrips.collect {} }
        val settingsJob = backgroundScope.launch { vm.rideSettings.collect {} }
        val homesJob = backgroundScope.launch { vm.reportHomes.collect {} }
        runCurrent()
        vm.reportHomesNow().map { it.city } shouldBe listOf("London")

        // Leave Profile so reportHomes stops upstream collection after its 5s WhileSubscribed timeout.
        homesJob.cancel()
        advanceTimeBy(6_000)
        runCurrent()

        // Home corrections change while Reports is open (reportTrips and rideSettings remain active).
        store.setHomeCorrections(OWNER, listOf(HomeCorrection(city = "Boston", from = "2025-01-01", country = "US")))
        runCurrent()
        vm.reportHomesNow().map { it.city } shouldBe listOf("Boston")

        tripsJob.cancel()
        settingsJob.cancel()
    }

    @Test
    fun `clockNow and clockToday emit as time advances`() = runTest {
        var now = Instant.parse("2026-05-01T23:59:30Z")
        val vm = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, clock = { now })
        val seenNow = mutableListOf<String>()
        val seenToday = mutableListOf<String>()
        val nowJob = backgroundScope.launch { vm.clockNow.collect { seenNow += it } }
        val todayJob = backgroundScope.launch { vm.clockToday.collect { seenToday += it } }
        runCurrent()
        seenNow shouldBe listOf("2026-05-01T23:59:30Z")
        val initialDay = seenToday.single()

        now = Instant.parse("2026-05-03T12:00:00Z")
        advanceTimeBy(60_000)
        runCurrent()
        seenNow shouldBe listOf("2026-05-01T23:59:30Z", "2026-05-03T12:00:00Z")
        seenToday.size shouldBe 2
        seenToday.last() shouldNotBe initialDay

        nowJob.cancel()
        todayJob.cancel()
    }

    @Test
    fun `unknownSegments retries unconfirmed reads and repairs flags when connectivity returns`() = runTest {
        val unknownTrip = Trip("u1", "Oslo", "2026-08-01", "2026-08-03", OWNER, updatedAt = "2026-08-01T00:00:00Z")
        val segs = listOf(Segment("s1", "u1", SegmentType.LODGING, "Hotel Oslo", "2026-08-01T15:00:00+02:00", "2026-08-03T11:00:00+02:00", travelers = listOf("Pat")))
        val base = FakeTripStore(
            trips = listOf(unknownTrip),
            segments = mapOf("u1" to segs),
            people = listOf(app.travelmo.core.Person("me", "Sam", bookings = 4, direct = 4)),
        )
        var online = false
        var repairFails = true
        var onceReads = 0
        var repairCalls = 0
        val reconnected = kotlinx.coroutines.flow.MutableSharedFlow<Unit>()
        val store = object : TripStore by base {
            override suspend fun segmentsOnce(tripId: String): app.travelmo.data.Seen<List<Segment>> {
                onceReads++
                return if (online) app.travelmo.data.Seen(segs, confirmed = true)
                else app.travelmo.data.Seen(emptyList(), confirmed = false)
            }
            override suspend fun repairTripFlags(tripId: String) {
                repairCalls++
                if (repairFails) throw IllegalStateException("offline")
            }
        }
        val vm = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(FROZEN_NOW) }, reconnected = reconnected)
        val job = backgroundScope.launch { vm.watchingTrips.collect {} }
        runCurrent()
        // Offline unconfirmed read does not mark the trip or burn a repair attempt.
        onceReads shouldBe 1
        repairCalls shouldBe 0
        vm.watchingTrips.value shouldBe emptySet()

        // When connectivity returns, unknownSegments retries the unconfirmed trip and attempts repair.
        online = true
        reconnected.emit(Unit)
        runCurrent()
        onceReads shouldBe 2
        repairCalls shouldBe 1
        vm.watchingTrips.value shouldBe setOf("u1")

        // A failed flag repair retries on the next reconnect without re-reading confirmed bookings.
        repairFails = false
        reconnected.emit(Unit)
        runCurrent()
        onceReads shouldBe 2
        repairCalls shouldBe 2
        job.cancel()
    }
}
