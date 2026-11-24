package app.travelmo.log

import app.travelmo.logging.LogSink
import app.travelmo.logging.LogValue
import app.travelmo.logging.SafeValue
import app.travelmo.logging.SensitiveValue
import com.mikelward.androidlog.safe
import com.mikelward.androidlog.sensitive

/**
 * Shared code's log lines (app.travelmo.logging), recorded in the app's own
 * debug log with each value keeping its privacy marking.
 */
object SharedLogSink : LogSink {
    override fun info(format: String, values: List<LogValue>) {
        TravelmoLog.info(format, *marked(values))
    }

    override fun warning(format: String, values: List<LogValue>) {
        TravelmoLog.warning(format, *marked(values))
    }

    override fun error(error: Throwable?, format: String, values: List<LogValue>) {
        if (error != null) TravelmoLog.error(error, format, *marked(values)) else TravelmoLog.error(format, *marked(values))
    }

    private fun marked(values: List<LogValue>): Array<Any?> = values.map {
        when (it) {
            is SafeValue -> safe(it.value)
            is SensitiveValue -> sensitive(it.value)
        }
    }.toTypedArray()
}
