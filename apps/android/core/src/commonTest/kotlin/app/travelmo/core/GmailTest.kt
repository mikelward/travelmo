package app.travelmo.core

import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import kotlin.test.Test

// As packages/core/src/gmail.test.ts, less the hashing only the parser does.
class GmailTest {
    private val connectedAt = "2026-11-01T00:00:00.000Z"
    private val first = GmailMailbox("me@example.com", connectedAt, idPrefix = "")
    private val work = GmailMailbox("work@example.com", "2026-11-02T00:00:00.000Z", idPrefix = "gmail-k1-")

    @Test
    fun `a user's mailboxes are oldest connection first with one connected before there could be several`() {
        gmailMailboxes(listOf(work, first)) shouldBe listOf(first, work)
        val legacy = GmailMailbox("Me@example.com", connectedAt)
        gmailMailboxes(listOf(work), legacy) shouldBe listOf(legacy, work)
        // Moved already: counted once.
        gmailMailboxes(listOf(first), legacy) shouldBe listOf(first)
        MAX_GMAIL_MAILBOXES shouldBe 5
    }

    @Test
    fun `a source id is the message id for the first mailbox and carries any other mailbox's key`() {
        parseGmailSourceId("gmail-k1-18c0ffee") shouldBe GmailSourceId("k1", "18c0ffee")
        parseGmailSourceId("18c0ffee") shouldBe GmailSourceId(null, "18c0ffee")
    }

    @Test
    fun `opens an email in the mailbox it came from`() {
        gmailSourceLink("gmail-k1-18c0ffee", listOf(first, work)) shouldBe "https://mail.google.com/mail/u/?authuser=work%40example.com#all/18c0ffee"
        gmailSourceLink("18c0ffee", listOf(first, work)) shouldBe "https://mail.google.com/mail/u/?authuser=me%40example.com#all/18c0ffee"
        sourceMailbox("18c0ffee", listOf(GmailMailbox("me@example.com", connectedAt))) shouldBe GmailMailbox("me@example.com", connectedAt)
    }

    @Test
    fun `opens the phone's own account once the mailbox is disconnected`() {
        gmailSourceLink("gmail-k1-18c0ffee", listOf(first)) shouldBe "https://mail.google.com/mail/u/0/#all/18c0ffee"
        gmailSourceLink("18c0ffee", listOf(work)) shouldBe "https://mail.google.com/mail/u/0/#all/18c0ffee"
        sourceMailbox("18c0ffee", listOf(work)).shouldBeNull()
    }
}
