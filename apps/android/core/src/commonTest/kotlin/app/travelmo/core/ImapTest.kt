package app.travelmo.core

import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import kotlin.test.Test

// As packages/core/src/imap.test.ts.
class ImapTest {
    @Test
    fun `known providers' servers are filled in with implicit TLS`() {
        imapServerFor("me@icloud.com") shouldBe ImapServerChoice.Known(ICLOUD_IMAP)
        imapServerFor("Me@ME.com") shouldBe ImapServerChoice.Known(ICLOUD_IMAP)
        imapServerFor("me@mac.com") shouldBe ImapServerChoice.Known(ICLOUD_IMAP)
        imapServerFor("me@yahoo.com") shouldBe ImapServerChoice.Known(YAHOO_IMAP)
        imapServerFor("me@yahoo.co.uk") shouldBe ImapServerChoice.Known(YAHOO_IMAP)
        imapServerFor("me@ik.me") shouldBe ImapServerChoice.Known(INFOMANIAK_IMAP)
        ICLOUD_IMAP.host shouldBe "imap.mail.me.com"
        ICLOUD_IMAP.port shouldBe 993
        YAHOO_IMAP.host shouldBe "imap.mail.yahoo.com"
        INFOMANIAK_IMAP.host shouldBe "mail.infomaniak.com"
    }

    @Test
    fun `Gmail and Fastmail addresses go to their own sections`() {
        imapServerFor("me@gmail.com") shouldBe ImapServerChoice.Gmail
        imapServerFor("me@fastmail.com") shouldBe ImapServerChoice.Fastmail
        imapRedirect("me@googlemail.com") shouldBe "For a Gmail address, use Connect Gmail above."
        imapRedirect("me@fastmail.fm") shouldBe "For a Fastmail address, use the Fastmail section above."
        imapRedirect("me@icloud.com").shouldBeNull()
    }

    @Test
    fun `other servers are the user's to name`() {
        imapServerFor("me@example.org") shouldBe ImapServerChoice.Other
        imapServerFor("not an address") shouldBe ImapServerChoice.Other
        parseImapServer(" Mail.Example.org ") shouldBe ImapServer("mail.example.org", 993)
        parseImapServer("imap.example.org:1993") shouldBe ImapServer("imap.example.org", 1993)
        parseImapServer("imaps://imap.example.org") shouldBe ImapServer("imap.example.org", 993)
        parseImapServer("localhost").shouldBeNull()
        parseImapServer("imap.example.org:99999").shouldBeNull()
        parseImapServer("imap.example.org/path").shouldBeNull()
    }

    @Test
    fun `mailboxes are oldest connection first and at most five`() {
        val a = ImapMailbox("a@example.org", "2026-11-01T00:00:00.000Z")
        val b = ImapMailbox("b@example.org", "2026-11-02T00:00:00.000Z")
        imapMailboxes(listOf(b, a)) shouldBe listOf(a, b)
        MAX_IMAP_MAILBOXES shouldBe 5
    }

    @Test
    fun `record ids name the mailbox and the UIDVALIDITY and the UID`() {
        parseImapRecordId("imap-k3y-1700000000-42") shouldBe ImapRecordId("k3y", "1700000000", 42)
        parseImapRecordId("fm-abc").shouldBeNull()
        parseImapRecordId("imap-k3y-1-0").shouldBeNull()
    }
}
