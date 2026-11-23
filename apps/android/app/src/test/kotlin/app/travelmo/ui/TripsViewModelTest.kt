package app.travelmo.ui

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
import app.travelmo.core.rideNeedKey
import java.time.Instant
import kotlinx.coroutines.flow.first
import io.kotest.matchers.shouldBe
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
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
        viewModel.deleteTrip("delete", "paris")
        store.merged shouldBe listOf("dublin" to "liverpool")
        store.deletedTrips shouldBe listOf("paris")
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
    fun `regrouping and deleting all trips go to the parser and say what they did`() = runTest {
        val actions = FakeTripActions()
        val viewModel = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, tripActions = actions)
        viewModel.canRunTripActions shouldBe true
        viewModel.regroupTrips("regroup")
        viewModel.tripNotice.value shouldBe "Done: 2 trips rebuilt, 1 trip merged away."
        viewModel.deleteAllTrips("delete")
        viewModel.tripNotice.value shouldBe "Deleted 3 trips. Import past bookings to start again."
        actions.calls shouldBe listOf("regroup", "deleteAll")
        viewModel.outcomes.value shouldBe mapOf("regroup" to Outcome.Done, "delete" to Outcome.Done)
    }

    @Test
    fun `a trip action that fails says why, and without a parser address points to the web`() = runTest {
        val failing = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL, tripActions = FakeTripActions(failure = "Couldn't reach Travelmo. Check your connection and try again."))
        failing.regroupTrips("regroup")
        failing.tripNotice.value shouldBe null
        failing.outcomes.value shouldBe mapOf("regroup" to Outcome.Failed("Couldn't reach Travelmo. Check your connection and try again."))
        val none = TripsViewModel(FakeTripStore(), OWNER, OWNER_EMAIL)
        none.canRunTripActions shouldBe false
        none.deleteAllTrips("delete")
        none.outcomes.value shouldBe mapOf("delete" to Outcome.Failed("Use Settings on the web for this."))
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
        check.answer.complete(AccountAccess.REQUESTED)
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
    fun `a flight's row says its gate and carousel near departure`() = runTest {
        val viewModel = flightModel("2026-12-12T21:00:00Z", mapOf("XX100_2026-12-13_SYD" to gate), mutableListOf())
        val statuses = viewModel.flightStatuses("sydney").first()
        statuses shouldBe mapOf("XX100_2026-12-13_SYD" to gate)
        viewModel.flightLines(flight, statuses) shouldBe listOf("Departs from gate 8", "Bags on carousel 16")
        flightModel("2026-12-10T21:00:00Z", emptyMap(), mutableListOf()).flightLines(flight, statuses) shouldBe emptyList()
    }
}
