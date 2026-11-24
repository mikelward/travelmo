package app.travelmo.logging

import io.kotest.matchers.shouldBe
import kotlin.test.Test

class SharedLogTest {
    @Test
    fun `fills each placeholder in turn and keeps the user's own values out`() {
        ConsoleLogSink.render("Read %s of %s for %s", listOf(safe(3), safe("imap"), sensitive("me@example.com"))) shouldBe "Read 3 of imap for <redacted>"
    }

    @Test
    fun `leaves a placeholder with no value as written`() {
        ConsoleLogSink.render("A %s and %s", listOf(safe("one"))) shouldBe "A one and %s"
    }

    @Test
    fun `sends lines to the installed sink with their markings`() {
        val lines = mutableListOf<String>()
        val previous = SharedLog.sink
        SharedLog.sink = object : LogSink {
            override fun info(format: String, values: List<LogValue>) { lines += "I $format $values" }
            override fun warning(format: String, values: List<LogValue>) { lines += "W $format $values" }
            override fun error(error: Throwable?, format: String, values: List<LogValue>) { lines += "E $format $values" }
        }
        try {
            SharedLog.warning("Left out: %s", safe("slot"))
            SharedLog.info("Mailbox %s", sensitive("me@example.com"))
        } finally {
            SharedLog.sink = previous
        }
        lines shouldBe listOf("W Left out: %s [SafeValue(value=slot)]", "I Mailbox %s [SensitiveValue(value=me@example.com)]")
    }
}
