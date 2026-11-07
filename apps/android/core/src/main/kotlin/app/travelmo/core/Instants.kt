package app.travelmo.core

import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

// Segment instants carry the offset of the place they happen in, so the
// display reads the local wall clock straight from the string rather than
// converting to the device's zone; only ordering and distances need the
// moment itself.

/** The calendar date written in the instant, in its own offset. */
fun localDate(instant: String): String = instant.substring(0, 10)

/** The wall-clock time written in the instant, "09:05". */
fun localTime(instant: String): String = instant.substring(11, 16)

/** The moment, for ordering and distances. */
fun instantMillis(instant: String): Long = OffsetDateTime.parse(instant).toInstant().toEpochMilli()

/** Orders by the moment in time, not the wall clock. */
fun compareInstants(a: String, b: String): Int = instantMillis(a).compareTo(instantMillis(b))

/** The offset written in the instant, as "+05:00"; "Z" and none read as UTC. */
fun offsetOf(instant: String): ZoneOffset = OffsetDateTime.parse(instant).offset

/** The calendar date it is at `now` (any instant) in the given offset. */
fun localDateAt(now: String, offset: ZoneOffset): String =
    Instant.ofEpochMilli(instantMillis(now)).atOffset(offset).toLocalDate().toString()

/** The same moment some milliseconds on, written in the instant's own offset. */
fun shiftInstant(instant: String, millis: Long): String {
    val at = OffsetDateTime.parse(instant)
    return at.plusNanos(millis * 1_000_000).format(DateTimeFormatter.ISO_OFFSET_DATE_TIME).let(::withSeconds)
}

// ISO_OFFSET_DATE_TIME drops :00 seconds; the web app always writes them.
private fun withSeconds(formatted: String): String {
    val t = formatted.indexOf('T')
    val zone = formatted.indexOfAny(charArrayOf('+', '-', 'Z'), t)
    val time = formatted.substring(t + 1, zone)
    val offset = formatted.substring(zone).let { if (it == "Z") "+00:00" else it }
    val full = if (time.length == 5) "$time:00" else time.take(8)
    return "${formatted.substring(0, t)}T$full$offset"
}
