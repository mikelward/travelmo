package app.travelmo.logging

// The log that code shared with the iOS app writes to. Each app installs
// its own recorder when it starts: Android's is the fleet's androidlog, with
// its privacy floor. A value a line names is marked as the app's own fixed
// vocabulary ([safe]) or as the user's ([sensitive]), as androidlog asks,
// so the recorder decides what may be kept.

/** A value named in a log line, marked for the recorder's privacy floor. */
sealed interface LogValue {
    val value: Any?
}

data class SafeValue(override val value: Any?) : LogValue

data class SensitiveValue(override val value: Any?) : LogValue

/** A value from the app's fixed vocabulary: a kind, a count, an error's class. */
fun safe(value: Any?): LogValue = SafeValue(value)

/** The user's own: an address, a trip's name. */
fun sensitive(value: Any?): LogValue = SensitiveValue(value)

/** Where shared code's log lines go; `%s` in [format] takes each value in turn. */
interface LogSink {
    fun info(format: String, values: List<LogValue>)

    fun warning(format: String, values: List<LogValue>)

    fun error(error: Throwable?, format: String, values: List<LogValue>)
}

/**
 * Until an app installs its recorder (a unit test, say), lines go to
 * standard output with the user's own values left out.
 */
object ConsoleLogSink : LogSink {
    override fun info(format: String, values: List<LogValue>) = println("I ${render(format, values)}")

    override fun warning(format: String, values: List<LogValue>) = println("W ${render(format, values)}")

    override fun error(error: Throwable?, format: String, values: List<LogValue>) =
        println("E ${render(format, values)}${error?.let { ": ${it::class.simpleName}" }.orEmpty()}")

    /** [format] with each `%s` filled in turn, a sensitive value as "<redacted>". */
    fun render(format: String, values: List<LogValue>): String {
        val queue = ArrayDeque(values)
        return Regex("%s").replace(format) {
            when (val v = queue.removeFirstOrNull()) {
                null -> "%s"
                is SensitiveValue -> "<redacted>"
                else -> v.value.toString()
            }
        }
    }
}

object SharedLog {
    var sink: LogSink = ConsoleLogSink

    fun info(format: String, vararg values: LogValue) = sink.info(format, values.toList())

    fun warning(format: String, vararg values: LogValue) = sink.warning(format, values.toList())

    fun error(error: Throwable?, format: String, vararg values: LogValue) = sink.error(error, format, values.toList())
}
