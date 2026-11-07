package app.travelmo.core

// What a trip card says about the moment, as packages/core/src/status.ts
// does it: how soon the next thing is, the stay under way, and whether a
// flight's online check-in is open. All of it is read from the segments' own
// instants, in each place's offset.

private const val MINUTE = 60_000L
private const val HOUR = 60 * MINUTE
private const val DAY = 24 * HOUR

/**
 * How far ahead an instant is, as a person would say it: minutes within the
 * hour, hours within the day, then the day itself up to a week out, in the
 * place's own calendar. Null for a moment past or more than a week away.
 */
fun relativeTime(now: String, at: String): String? {
    val ms = instantMillis(at) - instantMillis(now)
    if (ms < 0 || ms > 7 * DAY) return null
    // Whole minutes first, so 7 h 59 min 40 s reads as 8 h, never 7 h 60 min.
    val totalMinutes = Math.round(ms / MINUTE.toDouble())
    if (totalMinutes < 60) return "in ${maxOf(1, totalMinutes)} min"
    if (totalMinutes < 24 * 60) {
        val hours = totalMinutes / 60
        val minutes = totalMinutes % 60
        return if (minutes > 0) "in $hours h $minutes min" else "in $hours h"
    }
    val today = localDateAt(now, offsetOf(at))
    val date = localDate(at)
    val days = java.time.temporal.ChronoUnit.DAYS.between(java.time.LocalDate.parse(today), java.time.LocalDate.parse(date))
    return when {
        days <= 0 -> "later today"
        days == 1L -> "tomorrow"
        else -> "on ${formatWeekday(date)}"
    }
}

/** Most airlines open online check-in a day before departure; the card says "usually". */
const val CHECK_IN_OPENS_HOURS_BEFORE = 24

data class CheckIn(val segment: Segment, val opensAt: String, val open: Boolean)

/**
 * The next flight's online check-in, from a day before its window opens
 * until it departs; nothing once it has gone or while it is further off.
 */
fun flightCheckIn(segments: List<Segment>, now: String): CheckIn? {
    val next = segments
        .filter { it.type == SegmentType.FLIGHT && compareInstants(it.start, now) >= 0 }
        .minByOrNull { instantMillis(it.start) } ?: return null
    val opensAt = shiftInstant(next.start, -CHECK_IN_OPENS_HOURS_BEFORE * HOUR)
    if (instantMillis(now) < instantMillis(opensAt) - DAY) return null
    return CheckIn(next, opensAt, compareInstants(now, opensAt) >= 0)
}

/** The stay the traveler is in the middle of, if any: checked in, not yet out. */
fun currentStay(segments: List<Segment>, now: String): Segment? = segments.firstOrNull {
    it.type == SegmentType.LODGING && it.end != null && compareInstants(it.start, now) <= 0 && compareInstants(now, it.end) < 0
}

data class TripStatus(val next: UpcomingEvent? = null, val stay: Segment? = null, val checkIn: CheckIn? = null)

fun tripStatus(segments: List<Segment>, now: String): TripStatus =
    TripStatus(nextEvent(segments, now), currentStay(segments, now), flightCheckIn(segments, now))

/** The check-in line a card shows, or nothing. */
fun checkInLine(checkIn: CheckIn): String {
    val head = if (checkIn.open) {
        "Online check-in open, usually until departure"
    } else {
        "Online check-in usually opens ${formatDate(localDate(checkIn.opensAt))} ${localTime(checkIn.opensAt)}"
    }
    return head + (checkIn.segment.confirmation?.let { " · Ref $it" } ?: "")
}
