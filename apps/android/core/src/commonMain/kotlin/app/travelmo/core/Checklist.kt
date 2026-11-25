package app.travelmo.core

// The traveler's own reminders before a trip, as packages/core/src/checklist.ts
// works them out (SPEC "Before you go"): things to do before every
// international trip, kept in Settings, and one-offs added to a single trip,
// listed on the trip as a checklist with due dates. The parser sends them;
// the wording of its email and notification lives on the web side only.

enum class LeadUnit(val wire: String, val limit: Int) {
    DAYS("days", 365),
    WEEKS("weeks", 52),
    MONTHS("months", 12),
    ;

    companion object {
        fun fromWire(wire: String?): LeadUnit? = entries.firstOrNull { it.wire == wire }
    }
}

/** How long before a trip's first day a reminder is due. */
data class Lead(val amount: Int, val unit: LeadUnit)

val DEFAULT_LEAD = Lead(30, LeadUnit.DAYS)

const val MAX_REMINDER_TEXT = 200
const val MAX_STANDING_REMINDERS = 20
const val MAX_TRIP_REMINDERS = 10
const val MAX_DONE_REMINDERS = 40

/** Standing reminders sit in slots s0 to s19, a trip's one-offs in a0 to a9, so the rules bound how many. */
const val STANDING_SLOT_PREFIX = "s"
const val ONE_OFF_SLOT_PREFIX = "a"

/**
 * A reminder in its slot: a lead time, or for a one-off a date instead.
 * [id] is its own, so one that takes a freed slot is not ticked off where
 * the one before it was.
 */
data class Reminder(val slot: String, val id: String, val text: String, val lead: Lead? = null, val date: String? = null)

private val reminderIdPattern = Regex("^[A-Za-z0-9_-]{1,40}$")
private val datePattern = Regex("^\\d{4}-\\d{2}-\\d{2}$")

/** Whether [id] is one a reminder may have: letters, digits, - and _, at most 40. */
fun isReminderId(id: String): Boolean = reminderIdPattern.matches(id)

/**
 * A reminder from its stored fields, or null when they don't make one: the
 * same checks as the web's schema and the rules. [dated] allows a date in
 * place of a lead time, for a one-off.
 */
fun reminderOrNull(slot: String, id: String?, text: String?, amount: Number?, unit: String?, date: String?, dated: Boolean): Reminder? {
    if (id == null || !isReminderId(id)) return null
    val words = text?.trim()?.takeIf { it.isNotEmpty() && it.length <= MAX_REMINDER_TEXT } ?: return null
    if (date != null) {
        if (!dated || amount != null || unit != null || !datePattern.matches(date)) return null
        return Reminder(slot, id, words, date = date)
    }
    val whole = amount?.toDouble()?.takeIf { it == kotlin.math.floor(it) }?.toInt() ?: return null
    val leadUnit = LeadUnit.fromWire(unit) ?: return null
    if (whole < 0 || whole > leadUnit.limit) return null
    return Reminder(slot, id, words, lead = Lead(whole, leadUnit))
}

/** The day a reminder is due: the trip's first day less the lead time, or its own date. */
fun reminderDue(start: String, reminder: Reminder): String = reminder.date ?: reminderDue(start, reminder.lead ?: DEFAULT_LEAD)

fun reminderDue(start: String, lead: Lead): String = when (lead.unit) {
    LeadUnit.MONTHS -> shiftDate(start, DateShift(months = -lead.amount))
    LeadUnit.WEEKS -> shiftDate(start, DateShift(days = -7 * lead.amount))
    LeadUnit.DAYS -> shiftDate(start, DateShift(days = -lead.amount))
}

/** "30 days before", "1 week before", "2 months before", "The day it starts". */
fun leadText(lead: Lead): String {
    if (lead.amount == 0) return "The day it starts"
    val unit = if (lead.amount == 1) lead.unit.wire.dropLast(1) else lead.unit.wire
    return "${lead.amount} $unit before"
}

/**
 * The country of home on [date], as a code: home from this trip's own round
 * trip unless the person corrected it on Profile, as ride suggestions work
 * it out; where home has no country, that of a place of the trip in that
 * town (an airport's, from the table). Null when nothing says.
 */
fun homeCountry(segments: List<Segment>, corrections: List<HomeCorrection>, date: String, lookup: (String) -> AirportPlace? = ::airportPlace): String? {
    val live = liveSegments(segments)
    val home = homeAt(effectiveHomes(homeTimeline(live), corrections), date) ?: return null
    home.country?.let { return countryCode(it) }
    for (s in live) {
        for (place in listOfNotNull(s.origin, s.destination)) {
            val town = place.city ?: place.name
            if (!sameCity(town, home.city)) continue
            placeCountry(place, s.type, lookup)?.let { return countryCode(it) }
        }
    }
    return null
}

/**
 * Whether a trip goes abroad: some booking is in a country other than home
 * on the day it starts. Without a known home country or any booking with a
 * country, it is not.
 */
fun isInternational(trip: Trip, segments: List<Segment>, corrections: List<HomeCorrection>, lookup: (String) -> AirportPlace? = ::airportPlace): Boolean {
    val home = homeCountry(segments, corrections, trip.shownStart, lookup) ?: return false
    return tripPlaces(segments, lookup).countries.any { countryCode(it) != home }
}

/** One line of a trip's checklist; [oneOff] when added to this trip alone, so it can be removed from it. */
data class ChecklistEntry(val id: String, val text: String, val due: String, val done: Boolean, val oneOff: Boolean, val slot: String)

/** A trip's reminders: the standing ones when it is international, and its one-offs whatever it is; soonest due first. */
fun tripChecklist(trip: Trip, standing: List<Reminder>, done: List<String>, added: List<Reminder>, international: Boolean): List<ChecklistEntry> {
    val start = trip.shownStart
    val ticked = done.toSet()
    val all = (if (international) standing.map { it to false } else emptyList()) + added.map { it to true }
    return all.distinctBy { it.first.id }
        .map { (r, oneOff) -> ChecklistEntry(r.id, r.text, reminderDue(start, r), r.id in ticked, oneOff, r.slot) }
        .sortedWith(compareBy<ChecklistEntry> { it.due }.thenBy { it.text })
}

/** Whether a trip still has "Before you go": until the end of its first day. */
fun checklistShown(trip: Trip, today: String): Boolean = trip.shownStart >= today

/** What is due and not ticked off, for a trip not yet started. */
fun dueEntries(trip: Trip, entries: List<ChecklistEntry>, today: String): List<ChecklistEntry> =
    if (!checklistShown(trip, today)) emptyList() else entries.filter { !it.done && it.due <= today }

/** "By Thu 12 Nov", or "Today" on the day. */
fun dueText(due: String, today: String): String = if (due == today) "Today" else "By ${formatDate(due)}"

/** The first slot not taken, or null when all are. */
fun freeSlot(taken: Collection<String>, prefix: String, max: Int): String? = (0 until max).map { "$prefix$it" }.firstOrNull { it !in taken }

/** Slots in order: s2 before s10. */
fun slotNumber(slot: String): Int = slot.drop(1).toIntOrNull() ?: Int.MAX_VALUE

/** The ticked list with one reminder ticked or not, newest kept when full. */
fun withDone(done: List<String>, id: String, on: Boolean): List<String> {
    val rest = done.filter { it != id }
    return if (on) (rest + id).takeLast(MAX_DONE_REMINDERS) else rest
}
