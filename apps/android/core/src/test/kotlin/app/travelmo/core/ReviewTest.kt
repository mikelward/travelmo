package app.travelmo.core

import io.kotest.matchers.shouldBe
import java.time.LocalDate
import java.time.ZoneId
import org.junit.jupiter.api.Test

// Matching packages/core/src/review.test.ts and senders.test.ts.
class ReviewTest {
    private val london = ZoneId.of("Europe/London")
    private fun record(id: String, outcome: String = "not_booking", subject: String? = null, sentAt: String? = null, processedAt: String = "2026-11-23T12:00:00Z") =
        ParsedRecord(messageId = id, outcome = outcome, processedAt = processedAt, subject = subject, sentAt = sentAt)

    @Test
    fun `keeps what did not become a booking and matches the keyword`() {
        val records = listOf(record("a", subject = "Summer sale"), record("b", "imported", "Summer stay"), record("c", "processing", "Summer stay"), record("d", "failed", "Winter sale"))
        toReview(records, "").map { it.messageId } shouldBe listOf("a", "d")
        toReview(records, "summer").map { it.messageId } shouldBe listOf("a")
    }

    @Test
    fun `narrows to days by when the email was sent, or when it was read if that is unknown`() {
        val records = listOf(record("may", sentAt = "2026-05-23T07:22:58Z"), record("old"), record("sep", sentAt = "2026-09-01T07:00:00Z"))
        toReview(records, "", dayRange(LocalDate.parse("2026-05-01"), LocalDate.parse("2026-08-01"), london)).map { it.messageId } shouldBe listOf("may")
        toReview(records, "", dayRange(LocalDate.parse("2026-11-01"), null, london)).map { it.messageId } shouldBe listOf("old")
    }

    @Test
    fun `shows a record read again since the search as it is now, once, and adds new ones`() {
        val searched = listOf(record("b", processedAt = "2026-11-23T11:00:00Z"), record("a", processedAt = "2026-11-23T10:00:00Z"))
        val latest = listOf(record("a", "imported", processedAt = "2026-11-23T12:00:00Z"), record("c", "filtered", processedAt = "2026-11-23T11:30:00Z"))
        withLatest(searched, latest).map { it.messageId to it.outcome } shouldBe listOf("a" to "imported", "c" to "filtered", "b" to "not_booking")
    }

    @Test
    fun `says when the email was sent, or when it was read if that is unknown`() {
        reviewDate(record("x", sentAt = "2026-05-23T07:22:58Z"), london) shouldBe "Sent 23 May 2026"
        reviewDate(record("y"), london) shouldBe "Read 23 Nov 2026"
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
}
