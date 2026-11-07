package app.travelmo.core

import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter

// Time zones for the booking form, as packages/core/src/zone.ts: a field
// holds either an IANA zone or, for an instant whose zone is unknown
// (everything the parser imports), the literal offset it came with.

/** The prefix a field value carries when it is a fixed offset rather than a zone. */
const val FIXED_OFFSET_PREFIX = "offset:"

data class InstantParts(val date: String, val time: String, val offset: String)

/** Splits "2026-12-01T09:05:00+01:00" into the pieces a form edits; "Z" and none read as "+00:00". */
fun splitInstant(instant: String): InstantParts {
    val m = Regex("""^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$""").find(instant)
        ?: throw IllegalArgumentException("Not an ISO 8601 instant: $instant")
    val (date, time, zone) = m.destructured
    val offset = when {
        zone.isEmpty() || zone == "Z" -> "+00:00"
        zone.length == 5 -> "${zone.substring(0, 3)}:${zone.substring(3)}"
        else -> zone
    }
    return InstantParts(date, time, offset)
}

fun composeInstant(date: String, time: String, offset: String): String {
    require(Regex("""^[+-]\d{2}:\d{2}$""").matches(offset)) { "Offset must look like +01:00, got $offset" }
    return "${date}T$time:00$offset"
}

fun formatOffset(offset: ZoneOffset): String = if (offset.totalSeconds == 0) "+00:00" else offset.id

/**
 * The UTC offset in force in [zone] at the local wall time, DST included. A
 * wall time in a DST gap takes the offset after the jump, as a clock there
 * showed next; one in a fold takes the earlier offset, the first occurrence.
 */
fun zoneOffset(zone: String, date: String, time: String): String {
    val wall = LocalDateTime.of(LocalDate.parse(date), LocalTime.parse(time))
    // atZone moves a wall time in a gap past it and takes the offset after,
    // and takes the earlier offset in a fold; getOffset would take the
    // offset before a gap, which no clock there showed.
    return formatOffset(wall.atZone(ZoneId.of(zone)).offset)
}

fun localTimeZone(): String = ZoneId.systemDefault().id

/** Every zone a form may offer, UTC first then the rest by name. */
fun timeZones(): List<String> = listOf("UTC") + ZoneId.getAvailableZoneIds().filter { it != "UTC" && it.contains('/') && !it.startsWith("Etc/") && !it.startsWith("SystemV/") }.sorted()

/** The zone a stored offset reads as: [preferred] when it gives that offset at that wall time, else the offset pinned. */
fun zoneForOffset(offset: String, date: String, time: String, preferred: String): String =
    if (zoneOffset(preferred, date, time) == offset) preferred else "$FIXED_OFFSET_PREFIX$offset"

fun resolveOffset(zoneOrOffset: String, date: String, time: String): String =
    if (zoneOrOffset.startsWith(FIXED_OFFSET_PREFIX)) zoneOrOffset.removePrefix(FIXED_OFFSET_PREFIX) else zoneOffset(zoneOrOffset, date, time)

/** How a zone field reads: "Europe/London" as "Europe/London", a pinned offset as "UTC+01:00 (as imported)". */
fun zoneLabel(zoneOrOffset: String): String =
    if (zoneOrOffset.startsWith(FIXED_OFFSET_PREFIX)) "UTC${zoneOrOffset.removePrefix(FIXED_OFFSET_PREFIX)} (as imported)" else zoneOrOffset.replace('_', ' ')

/** Today's date in the device's zone. */
fun today(): String = LocalDate.now().format(DateTimeFormatter.ISO_LOCAL_DATE)
