package app.travelmo.core

import kotlin.time.Duration.Companion.milliseconds
import kotlin.time.Instant
import kotlinx.datetime.FixedOffsetTimeZone
import kotlinx.datetime.UtcOffset
import kotlinx.datetime.format.DateTimeComponents
import kotlinx.datetime.toLocalDateTime

// Segment instants carry the offset of the place they happen in, so the
// display reads the local wall clock straight from the string rather than
// converting to the device's zone; only ordering and distances need the
// moment itself.

/** The calendar date written in the instant, in its own offset. */
fun localDate(instant: String): String = instant.substring(0, 10)

/** The wall-clock time written in the instant, "09:05". */
fun localTime(instant: String): String = instant.substring(11, 16)

// "2026-12-01T09:05:00+01:00", seconds and fraction optional, "Z" for UTC; an offset is required.
private fun parts(instant: String): DateTimeComponents = DateTimeComponents.Formats.ISO_DATE_TIME_OFFSET.parse(instant)

/** The moment, for ordering and distances. */
fun instantMillis(instant: String): Long = parts(instant).toInstantUsingOffset().toEpochMilliseconds()

/** Orders by the moment in time, not the wall clock. */
fun compareInstants(a: String, b: String): Int = instantMillis(a).compareTo(instantMillis(b))

/** The offset written in the instant, as "+05:00"; "Z" reads as UTC. */
fun offsetOf(instant: String): UtcOffset = parts(instant).toUtcOffset()

/** The calendar date it is at `now` (any instant) in the given offset. */
fun localDateAt(now: String, offset: UtcOffset): String =
    Instant.fromEpochMilliseconds(instantMillis(now)).toLocalDateTime(FixedOffsetTimeZone(offset)).date.toString()

/**
 * The same moment some milliseconds on, written in the instant's own offset,
 * always with seconds and never a fraction, as the web app writes them:
 * "2026-12-01T09:05:00+01:00", UTC as "+00:00".
 */
fun shiftInstant(instant: String, millis: Long): String {
    val p = parts(instant)
    val offset = p.toUtcOffset()
    val at = (p.toInstantUsingOffset() + millis.milliseconds).toLocalDateTime(FixedOffsetTimeZone(offset))
    fun two(n: Int) = n.toString().padStart(2, '0')
    return "${at.date}T${two(at.hour)}:${two(at.minute)}:${two(at.second)}${formatOffset(offset)}"
}
