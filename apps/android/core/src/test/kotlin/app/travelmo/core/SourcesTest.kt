package app.travelmo.core

import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test

// As packages/core/src/sources.test.ts, plus the rule in apps/web/src/lib/sourceLinks.ts.
class SourcesTest {
    @Test
    fun `lists recorded sources and older Gmail ids once each, oldest first`() {
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
    fun `an email links only for whoever imported it, the owner for unattributed ones`() {
        val mine = SourceRef(SourceKind.GMAIL, "m1", uid = "me", at = "2030-01-01T00:00:00Z")
        val unattributed = mine.copy(uid = null)
        emailLinkFor(mine, "me", ownsTrip = false) shouldBe "https://mail.google.com/mail/u/0/#all/m1"
        emailLinkFor(mine.copy(uid = "partner"), "me", ownsTrip = true).shouldBeNull()
        emailLinkFor(unattributed, "me", ownsTrip = true) shouldBe "https://mail.google.com/mail/u/0/#all/m1"
        emailLinkFor(unattributed, "me", ownsTrip = false).shouldBeNull()
        emailLinkFor(SourceRef(SourceKind.TRIPIT, "t1", uid = "me", at = "2030-01-01T00:00:00Z"), "me", ownsTrip = true).shouldBeNull()
    }
}
