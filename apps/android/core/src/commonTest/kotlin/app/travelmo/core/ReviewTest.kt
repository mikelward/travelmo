package app.travelmo.core

import io.kotest.matchers.shouldBe
import kotlin.test.Test

// Matching packages/core/src/review.test.ts and senders.test.ts.
class ReviewTest {
    private val london = "Europe/London"
    private fun record(id: String, outcome: String = "not_booking", subject: String? = null, sentAt: String? = null, processedAt: String = "2026-11-23T12:00:00Z") =
        ParsedRecord(messageId = id, outcome = outcome, processedAt = processedAt, subject = subject, sentAt = sentAt)

    @Test
    fun `keeps what did not become a booking and matches the keyword`() {
        val records = listOf(record("a", subject = "Summer sale"), record("b", "imported", "Summer stay"), record("c", "processing", "Summer stay"), record("d", "failed", "Winter sale"))
        toReview(records, "").map { it.messageId } shouldBe listOf("a", "d")
        toReview(records, "summer").map { it.messageId } shouldBe listOf("a")
        // One whose Import anyway report is still to copy stays, even once imported.
        toReview(records, "", kept = setOf("b")).map { it.messageId } shouldBe listOf("a", "b", "d")
    }

    @Test
    fun `narrows to days by when the email was sent or when it was read if that is unknown`() {
        val records = listOf(record("may", sentAt = "2026-05-23T07:22:58Z"), record("old"), record("sep", sentAt = "2026-09-01T07:00:00Z"))
        toReview(records, "", dayRange("2026-05-01", "2026-08-01", london)).map { it.messageId } shouldBe listOf("may")
        toReview(records, "", dayRange("2026-11-01", null, london)).map { it.messageId } shouldBe listOf("old")
    }

    @Test
    fun `shows a record read again since the search as it is now once and adds new ones`() {
        val searched = listOf(record("b", processedAt = "2026-11-23T11:00:00Z"), record("a", processedAt = "2026-11-23T10:00:00Z"))
        val latest = listOf(record("a", "imported", processedAt = "2026-11-23T12:00:00Z"), record("c", "filtered", processedAt = "2026-11-23T11:30:00Z"))
        withLatest(searched, latest).map { it.messageId to it.outcome } shouldBe listOf("a" to "imported", "c" to "filtered", "b" to "not_booking")
    }

    @Test
    fun `says when the email was sent or when it was read if that is unknown`() {
        reviewDate(record("x", sentAt = "2026-05-23T07:22:58Z"), london) shouldBe "Sent 23 May 2026 · Read 23 Nov 2026"
        reviewDate(record("y"), london) shouldBe "Read 23 Nov 2026"
    }

    @Test
    fun `only mailbox records can be read again and say where they came from`() {
        val gmail = record("g")
        isFromMailbox(gmail) shouldBe true
        isFromMailbox(gmail.copy(source = "gmail")) shouldBe true
        isFromMailbox(gmail.copy(source = "fastmail")) shouldBe true
        isFromMailbox(gmail.copy(source = "imap")) shouldBe true
        for (other in listOf("tripit", "ics", "forward")) isFromMailbox(gmail.copy(source = other)) shouldBe false
        listOf(null, "gmail", "fastmail", "imap", "tripit", "ics", "forward").map(::recordSourceLabel) shouldBe
            listOf("Gmail", "Gmail", "Fastmail", "Other email", "TripIt", "Calendar", "Forwarded email")
    }

    @Test
    fun `reads sender rules as the parser does`() {
        domainOf("Cove <stay@Cove.Example>") shouldBe "cove.example"
        domainOf("cove.example") shouldBe "cove.example"
        domainOf("Cove Hotels") shouldBe null
        withLearned(SenderPatterns(allow = listOf("air.example"), deny = listOf("example")), "air.example", SenderList.ALLOW) shouldBe SenderPatterns(allow = listOf("air.example"))
        withLearned(SenderPatterns(allow = listOf("air.example")), "mail.air.example", SenderList.DENY) shouldBe SenderPatterns(deny = listOf("mail.air.example"))
        val patterns = SenderPatterns(allow = listOf("air.example"), deny = listOf("mail.air.example"))
        effectiveDecision(patterns, "mail.air.example") shouldBe SenderList.DENY
        effectiveDecision(patterns, "air.example") shouldBe SenderList.ALLOW
        effectiveDecision(patterns, "other.example") shouldBe null
    }

    @Test
    fun `reads a typed list of senders as one domain a line`() {
        cleanSenderList(listOf(" Air.Example ", "", "cove.example", "air.example")) shouldBe listOf("air.example", "cove.example")
    }
}
