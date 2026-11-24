package app.travelmo.ui

import app.travelmo.core.AccessConfig
import app.travelmo.core.AccountAccess
import app.travelmo.core.AddressHolder
import app.travelmo.core.Trip
import app.travelmo.core.accessDecision
import app.travelmo.core.accessInvite
import app.travelmo.core.accessRecordOf
import app.travelmo.data.AccessCheck
import app.travelmo.data.TripStore
import io.kotest.matchers.shouldBe
import io.kotest.matchers.types.shouldBeInstanceOf
import java.time.Instant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.BeforeEach
import org.junit.jupiter.api.Test

/** Who may use the app (SPEC "Access"): the invite-only screen's state and writes, and the admins' Access page. */
@OptIn(ExperimentalCoroutinesApi::class)
class AccessViewModelTest {
    private val now = "2026-11-23T10:00:00Z"
    private val newcomer = "new@example.com"
    private val admins = AccessConfig(listOf(OWNER_EMAIL))

    /** The parser's access check, answering [answer] and counting calls. */
    private class CountingAccessCheck(var answer: AccountAccess? = null) : AccessCheck {
        var calls = 0
        override suspend fun check(): AccountAccess? {
            calls++
            return answer
        }
    }

    private fun newcomerStore(access: Map<String, Map<String, String>> = emptyMap()) = FakeTripStore(access = access, hasUserDocument = false)

    private fun viewModel(store: TripStore, email: String? = newcomer, check: AccessCheck = CountingAccessCheck(), emailLinks: FakeEmailLinks = FakeEmailLinks(), emailVerified: Boolean = true) =
        TripsViewModel(store, "u-new", email, clock = { Instant.parse(now) }, accessCheck = check, emailLinks = emailLinks, emailVerified = emailVerified)

    @BeforeEach
    fun main() = Dispatchers.setMain(UnconfinedTestDispatcher())

    @AfterEach
    fun reset() = Dispatchers.resetMain()

    @Test
    fun `an account nothing lets in has not asked`() = runTest {
        val viewModel = viewModel(newcomerStore())
        val access = viewModel.access.value.shouldBeInstanceOf<AccessState.Known>()
        access.status shouldBe AccountAccess.NONE
        access.admin shouldBe false
    }

    @Test
    fun `an account from before approvals, an invited one and an admin are in`() = runTest {
        val old = viewModel(FakeTripStore(access = emptyMap())).access.value.shouldBeInstanceOf<AccessState.Known>()
        old.status shouldBe AccountAccess.APPROVED
        old.hasProfile shouldBe true
        old.admin shouldBe false
        val invited = viewModel(newcomerStore(mapOf(newcomer to accessInvite(newcomer, "friend", now)))).access.value
        invited.shouldBeInstanceOf<AccessState.Known>().status shouldBe AccountAccess.APPROVED
        val admin = viewModel(FakeTripStore(accessConfig = admins), email = OWNER_EMAIL).access.value.shouldBeInstanceOf<AccessState.Known>()
        admin.status shouldBe AccountAccess.APPROVED
        admin.admin shouldBe true
    }

    @Test
    fun `an admin by a linked address is one`() = runTest {
        val store = FakeTripStore(addressHolder = AddressHolder(emails = listOf("boss@work.example")), accessConfig = AccessConfig(listOf("boss@work.example")))
        viewModel(store).access.value.shouldBeInstanceOf<AccessState.Known>().admin shouldBe true
    }

    @Test
    fun `an unverified address has no record`() = runTest {
        val store = newcomerStore(mapOf(newcomer to accessInvite(newcomer, "friend", now)))
        val viewModel = viewModel(store, emailVerified = false)
        viewModel.access.value.shouldBeInstanceOf<AccessState.Known>().status shouldBe AccountAccess.NONE
        store.accessWrites shouldBe emptyList()
    }

    @Test
    fun `not approved waits for the server's word, while approved is taken from the cache`() = runTest {
        val store = newcomerStore()
        store.confirmed.value = false
        val viewModel = viewModel(store)
        viewModel.access.value shouldBe AccessState.Loading
        store.confirmed.value = true
        viewModel.access.value.shouldBeInstanceOf<AccessState.Known>().status shouldBe AccountAccess.NONE

        val cached = FakeTripStore()
        cached.confirmed.value = false
        viewModel(cached).access.value.shouldBeInstanceOf<AccessState.Known>().status shouldBe AccountAccess.APPROVED
    }

    @Test
    fun `a waiting account has the parser check it once on opening`() = runTest {
        val check = CountingAccessCheck(AccountAccess.NONE)
        viewModel(newcomerStore(), check = check)
        check.calls shouldBe 1
    }

    @Test
    fun `an approval lets the account in at once, and its queries are asked again`() = runTest {
        val base = newcomerStore(mapOf(newcomer to waitingRecord(newcomer, "u-new")))
        var asked = 0
        val store = object : TripStore by base {
            override fun trips(uid: String, addresses: List<String>): Flow<List<Trip>> {
                asked++
                return base.trips(uid, addresses)
            }
        }
        val viewModel = viewModel(store)
        val watching = launch { viewModel.trips.collect {} }
        runCurrent()
        viewModel.access.value.shouldBeInstanceOf<AccessState.Known>().status shouldBe AccountAccess.NONE
        asked shouldBe 1
        // An admin approves elsewhere; the record changes live.
        base.accessFields.update { it + (newcomer to it.getValue(newcomer) + accessDecision(AccountAccess.APPROVED, "admin", now)) }
        runCurrent()
        viewModel.access.value.shouldBeInstanceOf<AccessState.Known>().status shouldBe AccountAccess.APPROVED
        asked shouldBe 2
        watching.cancel()
    }

    @Test
    fun `an admin approves and declines addresses, invites one and revokes one`() = runTest {
        val store = FakeTripStore(
            accessConfig = admins,
            access = mapOf(
                "late@example.com" to waitingRecord("late@example.com", "u2"),
                "early@example.com" to waitingRecord("early@example.com", "u1"),
                "friend@example.com" to mapOf("email" to "friend@example.com") + accessDecision(AccountAccess.APPROVED, "admin", now),
            ),
        )
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(now) })
        val watching = launch { viewModel.accessLists.collect {} }
        runCurrent()
        viewModel.accessLists.value?.approved?.map { it.email } shouldBe listOf("friend@example.com", OWNER_EMAIL)

        viewModel.decideAccess("a", "early@example.com", AccountAccess.APPROVED)
        viewModel.decideAccess("d", "late@example.com", AccountAccess.DECLINED)
        viewModel.inviteAccess("i", " Guest@Example.com ")
        viewModel.decideAccess("r", "friend@example.com", AccountAccess.DECLINED)
        viewModel.outcomes.value shouldBe mapOf("a" to Outcome.Done, "d" to Outcome.Done, "i" to Outcome.Done, "r" to Outcome.Done)

        val records = store.accessFields.value
        records["early@example.com"] shouldBe waitingRecord("early@example.com", "u1") + accessDecision(AccountAccess.APPROVED, OWNER, now)
        records["late@example.com"] shouldBe waitingRecord("late@example.com", "u2") + accessDecision(AccountAccess.DECLINED, OWNER, now)
        records["guest@example.com"] shouldBe mapOf("email" to "guest@example.com") + accessDecision(AccountAccess.APPROVED, OWNER, now)
        accessRecordOf(records.getValue("friend@example.com"))?.status shouldBe AccountAccess.DECLINED
        viewModel.accessLists.value?.approved?.map { it.email } shouldBe listOf("early@example.com", "guest@example.com", OWNER_EMAIL)
        watching.cancel()
    }

    @Test
    fun `inviting something that is not an address writes nothing`() = runTest {
        val store = FakeTripStore(accessConfig = admins)
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL, clock = { Instant.parse(now) })
        viewModel.inviteAccess("i", "guest")
        viewModel.outcomes.value shouldBe mapOf("i" to Outcome.Failed("Enter an email address"))
        store.accessWrites shouldBe emptyList()
    }

    @Test
    fun `a decision that fails names the address`() = runTest {
        val store = object : TripStore by FakeTripStore(accessConfig = admins) {
            override suspend fun decideAccess(email: String, decision: AccountAccess, adminUid: String, now: String) = throw IllegalStateException("offline")
        }
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL)
        viewModel.decideAccess("a", "early@example.com", AccountAccess.APPROVED)
        viewModel.outcomes.value shouldBe mapOf("a" to Outcome.Failed("Couldn't save that for early@example.com. Try again."))
    }

    @Test
    fun `sharing a trip invites the address as the sharer`() = runTest {
        val store = FakeTripStore()
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL)
        viewModel.shareTrip("share", "liverpool", "friend@example.com")
        store.accessFields.value["friend@example.com"] shouldBe accessInvite("friend@example.com", OWNER, FROZEN_NOW)
    }

    @Test
    fun `sharing the profile invites only the addresses newly trusted`() = runTest {
        val store = FakeTripStore()
        val viewModel = TripsViewModel(store, OWNER, OWNER_EMAIL)
        val watching = launch { viewModel.profileLoaded.collect {} }
        runCurrent()
        viewModel.saveTrusted("share", fixtureProfile.trustedEmails + "new@example.com")
        store.trustedBefore shouldBe listOf(fixtureProfile.trustedEmails)
        watching.cancel()
    }

    @Test
    fun `an account from before approvals records itself once, so admins see it`() = runTest {
        val store = FakeTripStore(access = emptyMap())
        viewModel(store, email = OWNER_EMAIL)
        store.accessFields.value[OWNER_EMAIL]?.let(::accessRecordOf)?.status shouldBe AccountAccess.APPROVED
        store.accessWrites shouldBe listOf(OWNER_EMAIL)
    }

    @Test
    fun `a waiting account links the address it was invited at, refused as the parser refuses`() = runTest {
        val links = FakeEmailLinks()
        val viewModel = viewModel(newcomerStore(), emailLinks = links)
        viewModel.addEmail("link", " Work@Example.org ")
        links.added shouldBe listOf("work@example.org")
        viewModel.addEmail("mine", newcomer)
        viewModel.outcomes.value["mine"] shouldBe Outcome.Failed("That address is already yours.")
        val refused = viewModel(newcomerStore(), emailLinks = FakeEmailLinks(failure = "That address hasn't been invited to Travelmo."))
        refused.addEmail("link", "other@example.org")
        refused.outcomes.value["link"] shouldBe Outcome.Failed("That address hasn't been invited to Travelmo.")
    }
}
