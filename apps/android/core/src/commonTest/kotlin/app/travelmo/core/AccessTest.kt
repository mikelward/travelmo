package app.travelmo.core

import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import kotlin.test.Test
import kotlin.test.assertFailsWith

// Mirrors packages/core/src/access.test.ts.
class AccessTest {
    private val now = "2026-11-23T10:00:00Z"
    private val config = AccessConfig(listOf("admin@example.com"))

    private fun record(vararg fields: Map<String, String>): AccessRecord = accessRecordOf(fields.fold(emptyMap<String, String>()) { a, b -> a + b })!!

    private fun status(
        email: String? = "new@example.com",
        hasProfile: Boolean = false,
        record: AccessRecord? = null,
        linked: List<String> = emptyList(),
        linkedRecords: List<AccessRecord> = emptyList(),
    ) = accessStatus(email, hasProfile, record, config, linked, linkedRecords)

    @Test
    fun `names the statuses as packages core does`() {
        AccountAccess.entries.map { it.wire } shouldBe listOf("approved", "requested", "declined", "none")
        AccountAccess.fromWire("declined") shouldBe AccountAccess.DECLINED
        AccountAccess.fromWire("maybe").shouldBeNull()
        AccountAccess.fromWire(null).shouldBeNull()
    }

    @Test
    fun `reads the status from the access check's answer`() {
        accessCheckAnswer("""{"status":"approved"}""") shouldBe AccountAccess.APPROVED
        accessCheckAnswer("""{ "status" : "requested" }""") shouldBe AccountAccess.REQUESTED
        accessCheckAnswer("""{"status":"unknown"}""").shouldBeNull()
        accessCheckAnswer("Internal error").shouldBeNull()
    }

    @Test
    fun `has the access check's endpoint`() {
        parserEndpoint("https://parser.example.com/", ACCESS_CHECK_PATH) shouldBe "https://parser.example.com/access/check"
    }

    @Test
    fun `reads a record as stored and none without its address`() {
        accessRecordOf(mapOf("email" to "new@example.com", "status" to "requested", "uid" to "u1", "requestedAt" to now, "notifiedAt" to now)) shouldBe
            AccessRecord("new@example.com", AccountAccess.REQUESTED, uid = "u1", requestedAt = now)
        accessRecordOf(mapOf("email" to "new@example.com", "status" to "none")) shouldBe AccessRecord("new@example.com")
        accessRecordOf(mapOf("email" to "new@example.com", "status" to 3)) shouldBe AccessRecord("new@example.com")
        accessRecordOf(mapOf("status" to "approved")).shouldBeNull()
    }

    @Test
    fun `lets in an account made before approvals which has a user document`() {
        status(hasProfile = true) shouldBe AccountAccess.APPROVED
        status(email = null, hasProfile = true) shouldBe AccountAccess.APPROVED
    }

    @Test
    fun `keeps out a new account until it is approved`() {
        status() shouldBe AccountAccess.NONE
        status(record = record(accessRequest("new@example.com", "u1", now))) shouldBe AccountAccess.REQUESTED
    }

    @Test
    fun `lets in an address an admin approved or someone shared with`() {
        val requested = accessRequest("new@example.com", "u1", now)
        status(record = record(requested, accessDecision(AccountAccess.APPROVED, "admin", now))) shouldBe AccountAccess.APPROVED
        status(record = record(accessInvite("new@example.com", "friend", now))) shouldBe AccountAccess.APPROVED
        status(record = record(requested, accessInvite("new@example.com", "friend", now))) shouldBe AccountAccess.APPROVED
    }

    @Test
    fun `lets a decline or revocation win over a user document and an invite`() {
        val declined = record(accessDecision(AccountAccess.DECLINED, "admin", now), accessInvite("new@example.com", "friend", now))
        status(hasProfile = true, record = declined) shouldBe AccountAccess.DECLINED
    }

    @Test
    fun `always lets in an admin`() {
        status(email = "admin@example.com") shouldBe AccountAccess.APPROVED
        status(email = "admin@example.com", record = AccessRecord("admin@example.com", AccountAccess.DECLINED)) shouldBe AccountAccess.APPROVED
    }

    @Test
    fun `reads a record only for the verified address it belongs to`() {
        status(email = null, record = AccessRecord("new@example.com", AccountAccess.APPROVED)) shouldBe AccountAccess.NONE
        status(record = AccessRecord("other@example.com", AccountAccess.APPROVED)) shouldBe AccountAccess.NONE
    }

    @Test
    fun `counts an admin's listing an approval or an invite of a linked address`() {
        val linked = listOf("work@company.example")
        status(linked = listOf("admin@example.com")) shouldBe AccountAccess.APPROVED
        status(linked = linked, linkedRecords = listOf(AccessRecord("work@company.example", AccountAccess.APPROVED))) shouldBe AccountAccess.APPROVED
        status(linked = linked, linkedRecords = listOf(AccessRecord("work@company.example", invitedBy = "u1"))) shouldBe AccountAccess.APPROVED
        // Not a declined one, a request, or the record of an address not linked.
        status(linked = linked, linkedRecords = listOf(AccessRecord("work@company.example", AccountAccess.DECLINED, invitedBy = "u1"))) shouldBe AccountAccess.NONE
        status(linked = linked, linkedRecords = listOf(AccessRecord("work@company.example", AccountAccess.REQUESTED))) shouldBe AccountAccess.NONE
        status(linked = linked, linkedRecords = listOf(AccessRecord("other@example.com", AccountAccess.APPROVED))) shouldBe AccountAccess.NONE
        // The sign-in's decline still wins over a linked address's approval.
        status(
            record = AccessRecord("new@example.com", AccountAccess.DECLINED),
            linked = linked,
            linkedRecords = listOf(AccessRecord("work@company.example", AccountAccess.APPROVED)),
        ) shouldBe AccountAccess.DECLINED
    }

    @Test
    fun `lets in by an admin's address or one an admin approved or someone invited`() {
        val invited = AccessRecord("work@example.com", invitedBy = "u1", invitedAt = now)
        letsIn("admin@example.com", null, config) shouldBe true
        letsIn("work@example.com", invited, config) shouldBe true
        letsIn("work@example.com", AccessRecord("work@example.com", AccountAccess.APPROVED), null) shouldBe true
        // Not one that only asked, was declined, or has no record.
        letsIn("work@example.com", null, config) shouldBe false
        letsIn("work@example.com", AccessRecord("work@example.com", AccountAccess.REQUESTED), config) shouldBe false
        letsIn("work@example.com", invited.copy(status = AccountAccess.DECLINED), config) shouldBe false
        // A record speaks only for its own address.
        letsIn("other@example.com", invited, config) shouldBe false
    }

    @Test
    fun `writes what the web writes`() {
        accessRequest("new@example.com", "u1", now) shouldBe mapOf("email" to "new@example.com", "status" to "requested", "uid" to "u1", "requestedAt" to now)
        accessInvite("new@example.com", "friend", now) shouldBe mapOf("email" to "new@example.com", "invitedBy" to "friend", "invitedAt" to now)
        accessDecision(AccountAccess.APPROVED, "admin", now) shouldBe mapOf("status" to "approved", "approvedBy" to "admin", "approvedAt" to now)
        accessDecision(AccountAccess.DECLINED, "admin", now) shouldBe mapOf("status" to "declined", "declinedBy" to "admin", "declinedAt" to now)
        assertFailsWith<IllegalArgumentException> { accessDecision(AccountAccess.REQUESTED, "admin", now) }
        accessSelfApproval("old@example.com", "u1", now) shouldBe
            mapOf("email" to "old@example.com", "status" to "approved", "uid" to "u1", "approvedBy" to "u1", "approvedAt" to now)
    }

    @Test
    fun `tells an admin by the sign-in or a linked address`() {
        isAdmin("admin@example.com", emptyList(), config) shouldBe true
        isAdmin("me@example.com", listOf("admin@example.com"), config) shouldBe true
        isAdmin("me@example.com", listOf("work@example.com"), config) shouldBe false
        isAdmin("admin@example.com", emptyList(), null) shouldBe false
        isAdmin(null, emptyList(), config) shouldBe false
    }

    @Test
    fun `never revokes an admin or the admin acting`() {
        canRevoke("new@example.com", "admin@example.com", config) shouldBe true
        canRevoke("admin@example.com", "other-admin@example.com", config) shouldBe false
        canRevoke("me@example.com", "me@example.com", config) shouldBe false
    }

    @Test
    fun `lists requests oldest first and approved addresses by name and no declined ones`() {
        val records = listOf(
            record(accessRequest("late@example.com", "u2", "2026-11-23T12:00:00Z")),
            record(accessRequest("early@example.com", "u1", "2026-11-22T12:00:00Z")),
            record(mapOf("email" to "zed@example.com"), accessDecision(AccountAccess.APPROVED, "admin", now)),
            record(accessInvite("amy@example.com", "friend", now)),
            record(accessRequest("both@example.com", "u3", now), accessInvite("both@example.com", "friend", now)),
            record(mapOf("email" to "gone@example.com"), accessDecision(AccountAccess.DECLINED, "admin", now), mapOf("invitedBy" to "friend")),
        )
        val lists = accessLists(records)
        lists.pending.map { it.email } shouldBe listOf("early@example.com", "late@example.com")
        lists.approved.map { it.email } shouldBe listOf("amy@example.com", "both@example.com", "zed@example.com")
    }
}
