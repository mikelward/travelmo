package app.travelmo.core

import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import org.junit.jupiter.api.Test

class AccessTest {
    @Test
    fun `names the statuses as packages core does`() {
        AccountAccess.entries.map { it.wire } shouldBe listOf("approved", "requested", "declined", "none")
        AccountAccess.fromWire("declined") shouldBe AccountAccess.DECLINED
        AccountAccess.fromWire("maybe").shouldBeNull()
        AccountAccess.fromWire(null).shouldBeNull()
    }

    @Test
    fun `reads the status from the access check's answer`() {
        accessCheckAnswer("""{"status":"approved"}""") shouldBe AccountAccess.APPROVED
        accessCheckAnswer("""{ "status" : "requested" }""") shouldBe AccountAccess.REQUESTED
        accessCheckAnswer("""{"status":"unknown"}""").shouldBeNull()
        accessCheckAnswer("Internal error").shouldBeNull()
    }

    @Test
    fun `has the access check's endpoint`() {
        parserEndpoint("https://parser.example.com/", ACCESS_CHECK_PATH) shouldBe "https://parser.example.com/access/check"
    }
}
