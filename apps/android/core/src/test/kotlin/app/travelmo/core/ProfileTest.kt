package app.travelmo.core

import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test

class ProfileTest {
    @Test
    fun `a trusted list is lowercased, deduplicated, and never holds the owner`() {
        normalizeTrusted(listOf(" Partner@Example.com ", "partner@example.com", "Owner@Example.com", "nobody"), "owner@example.com") shouldBe listOf("partner@example.com")
    }
}
