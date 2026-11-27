package app.travelmo.core

import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import kotlin.test.Test

// As packages/core/src/sources.test.ts, plus the rule in apps/web/src/lib/sourceLinks.ts.
class SourcesTest {
    @Test
    fun `lists recorded sources and older Gmail ids once each oldest first`() {
        val sources = segmentSources(
            createdAt = "2030-01-01T00:00:00Z",
            gmailMessageIds = listOf("m1", "m2"),
            sources = listOf(
                SourceRef(SourceKind.TRIPIT, "tripit-abc", label = "Paris", at = "2030-02-01T00:00:00Z"),
                SourceRef(SourceKind.GMAIL, "m2", label = "Your booking", at = "2030-01-15T00:00:00Z"),
                SourceRef(SourceKind.GMAIL, "m2", label = "Your booking", at = "2030-01-15T00:00:00Z"),
            ),
        )
        sources.map { "${it.kind.wire}/${it.id}" } shouldBe listOf("gmail/m1", "gmail/m2", "tripit/tripit-abc")
    }

    @Test
    fun `opens the message in the account it came from`() {
        gmailMessageUrl("18c0ffee", "traveler@example.com") shouldBe "https://mail.google.com/mail/u/?authuser=traveler%40example.com#all/18c0ffee"
        gmailMessageUrl("18c0ffee") shouldBe "https://mail.google.com/mail/u/0/#all/18c0ffee"
        gmailMessageUrl("a b+c~(d)") shouldBe "https://mail.google.com/mail/u/0/#all/a%20b%2Bc~(d)"
    }

    @Test
    fun `an email links only for whoever imported it the owner for unattributed ones`() {
        val mine = SourceRef(SourceKind.GMAIL, "m1", uid = "me", at = "2030-01-01T00:00:00Z")
        val unattributed = mine.copy(uid = null)
        emailLinkFor(mine, "me", ownsTrip = false) shouldBe "https://mail.google.com/mail/u/0/#all/m1"
        emailLinkFor(mine.copy(uid = "partner"), "me", ownsTrip = true).shouldBeNull()
        emailLinkFor(unattributed, "me", ownsTrip = true) shouldBe "https://mail.google.com/mail/u/0/#all/m1"
        emailLinkFor(unattributed, "me", ownsTrip = false).shouldBeNull()
        emailLinkFor(SourceRef(SourceKind.TRIPIT, "t1", uid = "me", at = "2030-01-01T00:00:00Z"), "me", ownsTrip = true).shouldBeNull()
    }

    @Test
    fun `an email opens in the one of the viewer's mailboxes it came from`() {
        val mailboxes = listOf(GmailMailbox("me@example.com", "2030-01-01T00:00:00Z"), GmailMailbox("me@work.example", "2030-01-02T00:00:00Z", "gmail-k1-"))
        val fromWork = SourceRef(SourceKind.GMAIL, "gmail-k1-m2", uid = "me", at = "2030-01-01T00:00:00Z")
        emailLinkFor(fromWork, "me", ownsTrip = false, mailboxes) shouldBe "https://mail.google.com/mail/u/?authuser=me%40work.example#all/m2"
        emailLinkFor(fromWork.copy(id = "m1"), "me", ownsTrip = false, mailboxes) shouldBe "https://mail.google.com/mail/u/?authuser=me%40example.com#all/m1"
    }

    @Test
    fun `a Fastmail email is read as a source of its own and links nowhere even for whoever imported it`() {
        val fastmail = SourceKind.fromWire("fastmail")
        fastmail shouldBe SourceKind.FASTMAIL
        val email = SourceRef(SourceKind.FASTMAIL, "fm-1", uid = "me", at = "2030-01-01T00:00:00Z")
        emailLinkFor(email, "me", ownsTrip = true).shouldBeNull()
        // Not the same source as a Gmail message that happens to share its id.
        segmentSources(listOf(email, email.copy(kind = SourceKind.GMAIL)), gmailMessageIds = listOf("fm-1"), createdAt = "2030-01-01T00:00:00Z")
            .map { it.kind } shouldBe listOf(SourceKind.FASTMAIL, SourceKind.GMAIL)
    }

    @Test
    fun `an email read over IMAP is a source of its own and links nowhere`() {
        SourceKind.fromWire("imap") shouldBe SourceKind.IMAP
        val email = SourceRef(SourceKind.IMAP, "imap-k1-1700000000-5", uid = "me", at = "2030-01-01T00:00:00Z")
        emailLinkFor(email, "me", ownsTrip = true).shouldBeNull()
    }

    @Test
    fun `finds an email by its sender and subject and the days around it across a month's end`() {
        gmailSearch("cove.example", "Your \"Cove\"  stay", "2026-11-30T23:30:00-08:00") shouldBe
            "from:cove.example subject:\"Your Cove stay\" after:2026/11/29 before:2026/12/02"
        gmailSearch(null, null, "2026-03-01T10:00:00Z") shouldBe "after:2026/02/28 before:2026/03/03"
        gmailSearch("cove.example", null, "") shouldBe "from:cove.example"
    }

    @Test
    fun `searches by the booking's sender only when the email is its only one and by the sent date alone`() {
        val confirmation = SourceRef(SourceKind.GMAIL, "m1", label = "Your stay", at = "2026-11-20T00:00:00Z", sentAt = "2026-10-01T09:00:00Z")
        val agency = SourceRef(SourceKind.GMAIL, "m2", label = "Booking confirmed", at = "2026-11-21T00:00:00Z")
        val stay = Segment(id = "s", tripId = "t", type = SegmentType.LODGING, title = "Cove", start = "2026-12-12T15:00:00Z", sender = "cove.example", sources = listOf(confirmation))
        sourceSearch(stay, confirmation) shouldBe "from:cove.example subject:\"Your stay\" after:2026/09/30 before:2026/10/03"
        sourceSearch(stay.copy(sources = listOf(confirmation, agency)), agency) shouldBe "subject:\"Booking confirmed\""
        val forward = confirmation.copy(label = "Fwd: Your stay")
        sourceSearch(stay.copy(sources = listOf(forward)), forward) shouldBe "subject:\"Fwd: Your stay\""
    }

    private fun booking(id: String, start: String, vararg emails: String) = Segment(
        id, "t", SegmentType.FLIGHT, "Booking $id", start,
        sources = emails.mapIndexed { i, e -> SourceRef(SourceKind.GMAIL, e, label = "Subject $e", at = "2026-01-0${i + 1}T00:00:00Z") },
    )

    @Test
    fun `gives every email with the bookings it gave in date order the email of the earliest booking first`() {
        val groups = sourceGroups(
            listOf(
                booking("theirs-back", "2026-12-19T09:00:00Z", "theirs"),
                booking("mine-flight", "2026-12-11T09:00:00Z", "mine"),
                booking("theirs-out", "2026-12-12T09:00:00Z", "theirs"),
                // A stay confirmed in one email and paid in another is under both.
                booking("stay", "2026-12-11T15:00:00Z", "confirmed", "paid"),
            ),
        )
        groups.map { it.source?.id to it.segmentIds } shouldBe listOf(
            "mine" to listOf("mine-flight"),
            "confirmed" to listOf("stay"),
            "paid" to listOf("stay"),
            "theirs" to listOf("theirs-out", "theirs-back"),
        )
    }

    @Test
    fun `keeps an email every booking came from and puts bookings added by hand last`() {
        val groups = sourceGroups(listOf(booking("a", "2026-12-11T09:00:00Z", "all"), booking("b", "2026-12-12T09:00:00Z")))
        groups.map { it.source?.id to it.segmentIds } shouldBe listOf("all" to listOf("a"), null to listOf("b"))
    }

    @Test
    fun `names an email's sender only from a booking it gave alone`() {
        val stay = booking("stay", "2026-12-11T15:00:00Z", "confirmed", "receipt").copy(sender = "cove.example")
        val train = booking("train", "2026-12-11T09:00:00Z", "tickets").copy(sender = "avanti.example")
        // The stay's sender could be either email's.
        sourceGroups(listOf(stay, train)).map { it.source?.id to it.sender } shouldBe
            listOf("tickets" to "avanti.example", "confirmed" to null, "receipt" to null)
    }

    @Test
    fun `names an email's sender and no sender for a TripIt trip`() {
        val stay = booking("a", "2026-12-11T09:00:00Z", "m1").copy(sender = "cove.example")
        val tripit = SourceRef(SourceKind.TRIPIT, "tripit-1", label = "Liverpool weekend", at = "2026-01-01T00:00:00Z")
        sourceGroups(listOf(stay.copy(sources = stay.sources + tripit))).map { it.source?.id to it.sender } shouldBe
            listOf("m1" to "cove.example", "tripit-1" to null)
    }
}
