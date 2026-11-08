package app.travelmo.core

import io.kotest.matchers.shouldBe
import io.kotest.matchers.shouldNotBe
import io.kotest.matchers.string.shouldMatch
import org.junit.jupiter.api.Test

class RemindersTest {
    @Test
    fun `a device id is a fixed-length hash of the token, the same every time`() {
        val id = deviceId("fcm-token-1")
        id shouldMatch Regex("[0-9a-f]{32}")
        id shouldBe deviceId("fcm-token-1")
        id shouldNotBe deviceId("fcm-token-2")
        // SHA-256 of the text, so the parser or a person can recompute it.
        deviceId("abc") shouldBe "ba7816bf8f01cfea414140de5dae2223"
    }

    @Test
    fun `the trip id is read from a reminder's web URL`() {
        tripIdFromReminderUrl("https://travelmo.example/trips/dublin") shouldBe "dublin"
        tripIdFromReminderUrl("https://travelmo.example/trips/a1-B2_c3?from=reminder") shouldBe "a1-B2_c3"
        tripIdFromReminderUrl("https://travelmo.example/trips/x/segments/y") shouldBe "x"
        tripIdFromReminderUrl("https://travelmo.example/settings") shouldBe null
        tripIdFromReminderUrl("https://travelmo.example/trips/") shouldBe null
        tripIdFromReminderUrl(null) shouldBe null
    }
}
