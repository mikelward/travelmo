package app.travelmo.core

import io.kotest.matchers.shouldBe
import kotlin.test.Test

// The helpers that replaced java.text, java.security and java.util.Formatter,
// checked against what those gave on the JVM.
class TextTest {
    @Test
    fun `writes three decimals as Java's format did`() {
        val cases = listOf(
            51.4775 to "51.478", 0.0005 to "0.001", -0.0004 to "-0.000", 1.0E-4 to "0.000",
            12345678.9995 to "12345679.000", -122.4194155 to "-122.419", 2.0 to "2.000", 0.9995 to "1.000", 1e7 to "10000000.000",
        )
        for ((value, text) in cases) fixed3(value) shouldBe text
    }

    @Test
    fun `groups thousands as en-US does`() {
        groupThousands(0) shouldBe "0"
        groupThousands(999) shouldBe "999"
        groupThousands(1234567) shouldBe "1,234,567"
        groupThousands(-1234) shouldBe "-1,234"
    }

    @Test
    fun `rounds halves up as Java's Math round did`() {
        roundHalfUp(2.5) shouldBe 3L
        roundHalfUp(-2.5) shouldBe -2L
        roundHalfUp(7.49) shouldBe 7L
    }

    @Test
    fun `hashes with SHA-256`() {
        fun hex(bytes: ByteArray) = bytes.joinToString("") { (it.toInt() and 0xFF).toString(16).padStart(2, '0') }
        hex(sha256(ByteArray(0))) shouldBe "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        hex(sha256("abc".encodeToByteArray())) shouldBe "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        // Two blocks, and bytes past ASCII.
        hex(sha256("é".repeat(100).encodeToByteArray())) shouldBe "f42ec48e1e4b487e590e0b3d4e58437c8327efa855d769709f4942a4f73a7eb6"
        deviceId("fcm-token-1") shouldBe "3cfaa3f1d62d114805029366153fbb44"
    }

    @Test
    fun `names months and weekdays as en-GB does`() {
        formatDateWithYear("2026-09-05") shouldBe "Sat 5 Sept 2026"
        monthLabel("2026-11") shouldBe "November 2026"
        addMonths("2026-11", 3) shouldBe "2027-02"
        addMonths("2026-01", -1) shouldBe "2025-12"
    }

    @Test
    fun `knows countries by name on every platform`() {
        countryCodeOf("United Kingdom") shouldBe "GB"
        countryCodeOf("Japan") shouldBe "JP"
    }
}
