package app.travelmo.core

import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test

// The same cases as packages/core/src/emails.test.ts.
class EmailsTest {
    private val now = "2026-11-23T10:00:00.000Z"
    private val later = "2026-11-24T10:00:00.000Z"
    private val user = AddressHolder(
        emails = listOf("work@company.example"),
        gmail = "Mail@Example.net",
        pendingEmails = listOf(
            PendingEmail("new@company.example", now, later),
            PendingEmail("old@company.example", "2026-11-01T00:00:00.000Z", "2026-11-02T00:00:00.000Z"),
        ),
    )

    @Test
    fun `my addresses are the sign-in first, then those confirmed and the connected Gmail, once each`() {
        myAddresses("Me@Example.com", user) shouldBe listOf("me@example.com", "work@company.example", "mail@example.net")
        linkedEmails(user) shouldBe listOf("work@company.example", "mail@example.net")
        myAddresses("mail@example.net", user) shouldBe listOf("mail@example.net", "work@company.example")
    }

    @Test
    fun `never count one waiting for confirmation, and are the sign-in alone without a user document`() {
        myAddresses("me@example.com", user).contains("new@company.example") shouldBe false
        myAddresses("me@example.com", null) shouldBe listOf("me@example.com")
        myAddresses(null, AddressHolder(emails = listOf("work@company.example"))) shouldBe listOf("work@company.example")
    }

    @Test
    fun `tell whether a list names the account by any of them`() {
        val mine = myAddresses("me@example.com", user)
        isMine("WORK@company.example", mine) shouldBe true
        isMine("new@company.example", mine) shouldBe false
        sharedWithAny(listOf("partner@example.com", "mail@example.net"), mine) shouldBe true
        sharedWithAny(listOf("partner@example.com"), mine) shouldBe false
    }

    @Test
    fun `fit one query`() {
        val many = (0 until 40).map { "p$it@example.com" }
        queryAddresses(many).size shouldBe 30
        queryAddresses(many).first() shouldBe "p0@example.com"
    }

    @Test
    fun `Settings lists the sign-in, those confirmed, Gmail and live pending ones, removable where linked`() {
        val rows = emailRows("me@example.com", user, now)
        rows shouldBe listOf(
            EmailRow("me@example.com", EmailRowKind.SIGN_IN),
            EmailRow("work@company.example", EmailRowKind.CONFIRMED),
            EmailRow("mail@example.net", EmailRowKind.GMAIL),
            EmailRow("new@company.example", EmailRowKind.PENDING),
        )
        rows.map { it.removable } shouldBe listOf(false, true, false, true)
        emailRows("me@example.com", AddressHolder(emails = listOf("mail@example.net"), gmail = "mail@example.net"), now) shouldBe listOf(
            EmailRow("me@example.com", EmailRowKind.SIGN_IN),
            EmailRow("mail@example.net", EmailRowKind.CONFIRMED),
        )
    }

    @Test
    fun `checks a new address`() {
        checkNewLink("  Other@Example.org ", "me@example.com", user, now) shouldBe LinkCheck.Ok("other@example.org")
        checkNewLink("new@company.example", "me@example.com", user, now) shouldBe LinkCheck.Ok("new@company.example")
        checkNewLink("not an address", "me@example.com", user, now) shouldBe LinkCheck.Refused(LinkRefusal.INVALID)
        for (mine in listOf("ME@example.com", "work@company.example", "mail@example.net")) {
            checkNewLink(mine, "me@example.com", user, now) shouldBe LinkCheck.Refused(LinkRefusal.YOURS)
        }
    }

    @Test
    fun `refuses more than the limit, counting live pending links`() {
        val emails = (0 until MAX_LINKED_EMAILS - 1).map { "a$it@example.com" }
        checkNewLink("x@example.com", "me@example.com", AddressHolder(emails = emails), now) shouldBe LinkCheck.Ok("x@example.com")
        checkNewLink("x@example.com", "me@example.com", user.copy(emails = emails), now) shouldBe LinkCheck.Refused(LinkRefusal.FULL)
        checkNewLink("x@example.com", "me@example.com", AddressHolder(emails = emails, pendingEmails = listOf(user.pendingEmails[1])), now) shouldBe
            LinkCheck.Ok("x@example.com")
    }

    @Test
    fun `reads the parser's refusal, and nothing else`() {
        refusalOf("""{"refusal":"taken"}""") shouldBe LinkRefusal.TAKEN
        refusalOf("""{"refusal":"other"}""").shouldBeNull()
        refusalOf("Internal error").shouldBeNull()
        LinkRefusal.entries.map { it.wire } shouldBe listOf("invalid", "yours", "full", "limit", "taken", "expired")
    }

    @Test
    fun `has the parser's endpoints`() {
        parserEndpoint("https://parser.example.com/", ADD_EMAIL_PATH) shouldBe "https://parser.example.com/emails/add"
        parserEndpoint("https://parser.example.com/", REMOVE_EMAIL_PATH) shouldBe "https://parser.example.com/emails/remove"
    }
}
