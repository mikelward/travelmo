package app.travelmo.core

import kotlinx.datetime.DatePeriod
import kotlinx.datetime.LocalDate
import kotlinx.datetime.plus

// Days in and out of countries, for residence and visa limits, as
// packages/core/src/residence.ts: where the traveler was on each calendar
// day, from their bookings, and the limits countries set on days away
// (settlement, citizenship) or days in (a Schengen short stay, US tax). An
// estimate from the bookings the app knows about, not legal advice; the
// sources are cited beside each rule.

data class DateShift(val years: Int = 0, val months: Int = 0, val days: Int = 0)

/**
 * A calendar date moved by whole years and months (keeping to the last day
 * of a shorter month: 29 Feb 2024 plus a year is 28 Feb 2025), then days.
 */
fun shiftDate(date: String, shift: DateShift): String =
    LocalDate.parse(date).plus(DatePeriod(months = shift.years * 12 + shift.months)).plus(DatePeriod(days = shift.days)).toString()


private fun dates(from: String, to: String): Sequence<String> {
    val end = LocalDate.parse(to)
    return generateSequence(LocalDate.parse(from)) { it.plus(DatePeriod(days = 1)) }.takeWhile { it <= end }.map { it.toString() }
}

/**
 * One calendar day: the countries the traveler was in (any part of the day),
 * the trips that say so, whether nothing was booked and they are taken to be
 * at home, and whether they spent the whole day between countries (a flight
 * across the date line). No country and not in transit is a day nothing
 * places.
 */
/** [tripCountries]: the countries each trip puts the traveler in that day; [night]: the country they end it in, if known. */
data class DayPresence(
    val countries: Set<String>,
    val tripIds: Set<String>,
    val assumedHome: Boolean,
    val inTransit: Boolean,
    val tripCountries: Map<String, Set<String>> = emptyMap(),
    val night: String? = null,
)

fun presenceTimeline(
    all: List<TripWithSegments>,
    homes: List<HomePeriod>,
    from: String,
    to: String,
    lookup: (String) -> AirportPlace? = ::airportPlace,
): Map<String, DayPresence> {
    val countries = HashMap<String, MutableSet<String>>()
    val trips = HashMap<String, MutableSet<String>>()
    val tripCountries = HashMap<String, MutableMap<String, MutableSet<String>>>()
    val nights = HashMap<String, String?>()
    val nightAt = HashMap<String, String>()
    val transit = HashMap<String, Boolean>()
    for ((trip, segments) in all.associateBy { it.trip.id }.values) {
        val bounds = reportBounds(trip, segments) ?: continue
        if (bounds.second < from || bounds.first > to) continue
        for ((day, place) in tripDayPlaces(trip, segments, to, lookup)) {
            // A trip dated before its first booking says nothing about those
            // days, and a day of outings near home that name no place puts
            // the traveler nowhere new: both are at home.
            if (day < from || !place.started || place.local) continue
            val known = countries.getOrPut(day) { mutableSetOf() }
            known += place.countries
            trips.getOrPut(day) { mutableSetOf() } += trip.id
            tripCountries.getOrPut(day) { mutableMapOf() }.getOrPut(trip.id) { mutableSetOf() } += place.countries
            // The night is where the day's last booking, of any trip, left them.
            val at = place.nightAt
            if (at != null && nightAt[day].let { it == null || compareInstants(at, it) > 0 }) {
                nightAt[day] = at
                nights[day] = place.night
            }
            transit[day] = known.isEmpty() && ((transit[day] ?: false) || place.inTransit)
        }
    }
    val timeline = LinkedHashMap<String, DayPresence>()
    for (day in dates(from, to)) {
        val known = countries[day]
        if (known != null) {
            timeline[day] = DayPresence(known, trips[day].orEmpty(), assumedHome = false, inTransit = transit[day] ?: false, tripCountries = tripCountries[day].orEmpty(), night = nights[day])
            continue
        }
        // As a code, however the home was written ("UK" is GB).
        val home = homeAt(homes, day)?.country?.let(::countryCode)
        timeline[day] = DayPresence(setOfNotNull(home), emptySet(), assumedHome = true, inTransit = false, night = home)
    }
    return timeline
}

/**
 * Schengen members as of 1 January 2025, when Bulgaria and Romania joined in
 * full (Croatia joined on 1 January 2023); Ireland and Cyprus are EU members
 * outside it. Monaco, San Marino and Vatican City have open borders with it
 * but are not members, so they are left out.
 * https://home-affairs.ec.europa.eu/news/bulgaria-and-romania-join-schengen-area-2025-01-03_en
 */
val schengenCountries: List<String> = listOf(
    "AT", "BE", "BG", "CH", "CZ", "DE", "DK", "EE", "ES", "FI", "GR", "FR", "HR", "HU", "IS",
    "IT", "LI", "LT", "LU", "LV", "MT", "NL", "NO", "PL", "PT", "RO", "SE", "SI", "SK",
)

// The United States for naturalization includes Puerto Rico, Guam, the US
// Virgin Islands and the Northern Mariana Islands (INA 101(a)(38)); for the
// substantial presence test it is the states and DC alone
// (https://www.irs.gov/individuals/international-taxpayers/substantial-presence-test).
private val usForImmigration = listOf("US", "PR", "GU", "VI", "MP")

/**
 * How a rule counts a day; both come to the same thing for a day the traveler
 * crossed a border, which touches the country. WHOLE_DAYS: a day away is an
 * absence only when no part of it was spent in the country (UK Home Office).
 * ANY_PART: any part of a day in the country counts as a day there
 * (Schengen, US, Canada, Australia).
 */
enum class Counting { WHOLE_DAYS, ANY_PART }

enum class LimitType { MAX_ABSENT, MIN_PRESENT, MAX_PRESENT }

data class AbsenceNotes(val near: String, val over: String)

sealed interface RuleKind {
    /**
     * At most [limit] days away (MAX_ABSENT), at least [limit] days in
     * (MIN_PRESENT), or at most [limit] days in (MAX_PRESENT), in the [window]
     * before the date; with [rolling], in any such window ending within that
     * long before the date. With [qualifying], [rolling] is a qualifying
     * period whose days alone count: every window lies wholly inside it (UK
     * settlement's five years), where otherwise a window may start before it
     * (Schengen's 180 days ending in the last year). A qualifying period
     * starts no earlier than the move to the area: the first day of the run
     * of homes there that reaches the date.
     */
    data class Limit(val type: LimitType, val limit: Int, val window: DateShift, val rolling: DateShift? = null, val qualifying: Boolean = false) : RuleKind

    /** No single absence within [window] longer than [nearMonths] (a warning) or as long as [overMonths]. */
    data class LongestAbsence(val window: DateShift, val nearMonths: Int, val overMonths: Int, val notes: AbsenceNotes) : RuleKind

    /** The US substantial presence test, for the calendar year of the date. */
    data object SubstantialPresence : RuleKind
}

/** [areaName] is the area as a sentence names it ("the UK"), for a qualifying period that starts when the person moved there. */
data class ResidenceRule(val id: String, val label: String, val area: List<String>, val counting: Counting, val kind: RuleKind, val source: String, val areaName: String? = null)

/** A set of rules to check together; [application] says the date is when the person applies. */
data class ResidenceRuleSet(val id: String, val label: String, val application: Boolean, val rules: List<ResidenceRule>)

private val continuousNotes = AbsenceNotes(
    near = "Away over 6 months: USCIS takes this to break continuous residence unless you show otherwise.",
    over = "Away a year or more: this breaks continuous residence.",
)

private const val ILR = "https://www.gov.uk/government/publications/indefinite-leave-to-remain-calculating-continuous-period-in-uk"
private const val FORM_AN = "https://www.gov.uk/government/publications/form-an-guidance"
private const val SCHENGEN = "https://home-affairs.ec.europa.eu/policies/schengen/border-crossing/short-stay-calculator_en"
private const val USCIS_PRESENCE = "https://www.uscis.gov/policy-manual/volume-12-part-d-chapter-4"
private const val USCIS_CONTINUOUS = "https://www.uscis.gov/policy-manual/volume-12-part-d-chapter-3"
private const val USCIS_SPOUSE = "https://www.uscis.gov/policy-manual/volume-12-part-g-chapter-2"
private const val USCIS_TRAVEL = "https://www.uscis.gov/green-card/after-we-grant-your-green-card/international-travel-as-a-permanent-resident"
private const val IRS_SPT = "https://www.irs.gov/individuals/international-taxpayers/substantial-presence-test"
private const val CA_PR =
    "https://www.canada.ca/en/immigration-refugees-citizenship/corporate/publications-manuals/operational-bulletins-manuals/permanent-residence/card/permanent-resident-determination.html"
private const val CA_CITIZENSHIP =
    "https://www.canada.ca/en/immigration-refugees-citizenship/corporate/publications-manuals/operational-bulletins-manuals/canadian-citizenship/grant/residence/calculate-physical-presence.html"
private const val AU_CITIZENSHIP = "https://immi.homeaffairs.gov.au/citizenship/become-a-citizen/permanent-resident"

/** The rules, with what each source says in packages/core/src/residence.ts. */
val residenceRuleSets: List<ResidenceRuleSet> = listOf(
    ResidenceRuleSet(
        "uk-settlement", "UK settlement (indefinite leave to remain)", application = true,
        listOf(
            // No more than 180 days outside the UK in any 12 months of the
            // qualifying period, in whole days.
            ResidenceRule("uk-settlement-absences", "Days outside the UK in any 12 months", listOf("GB"), Counting.WHOLE_DAYS, RuleKind.Limit(LimitType.MAX_ABSENT, 180, DateShift(months = 12), rolling = DateShift(years = 5), qualifying = true), ILR, areaName = "the UK"),
        ),
    ),
    ResidenceRuleSet(
        "uk-citizenship", "UK citizenship (naturalisation)", application = true,
        listOf(
            // No more than 450 days outside the UK in the five years before
            // applying, and no more than 90 in the last 12 months.
            ResidenceRule("uk-citizenship-five-years", "Days outside the UK in the 5 years before applying", listOf("GB"), Counting.WHOLE_DAYS, RuleKind.Limit(LimitType.MAX_ABSENT, 450, DateShift(years = 5)), FORM_AN),
            ResidenceRule("uk-citizenship-last-year", "Days outside the UK in the 12 months before applying", listOf("GB"), Counting.WHOLE_DAYS, RuleKind.Limit(LimitType.MAX_ABSENT, 90, DateShift(months = 12)), FORM_AN),
        ),
    ),
    ResidenceRuleSet(
        "schengen", "Schengen short stays (90 days in 180)", application = false,
        listOf(
            // At most 90 days in any 180, entry and exit days both counted.
            ResidenceRule("schengen-90-180", "Days in the Schengen area in any 180 days", schengenCountries, Counting.ANY_PART, RuleKind.Limit(LimitType.MAX_PRESENT, 90, DateShift(days = 180), rolling = DateShift(years = 1)), SCHENGEN),
        ),
    ),
    ResidenceRuleSet(
        "us-citizenship", "US citizenship", application = true,
        listOf(
            // Present for half of the five years before applying: 913 days.
            ResidenceRule("us-citizenship-presence", "Days in the US in the 5 years before applying", usForImmigration, Counting.ANY_PART, RuleKind.Limit(LimitType.MIN_PRESENT, 913, DateShift(years = 5)), USCIS_PRESENCE),
            // Over six months away is presumed to break continuous residence; a year or more breaks it.
            ResidenceRule("us-citizenship-continuous", "Longest time away from the US in the 5 years before applying", usForImmigration, Counting.ANY_PART, RuleKind.LongestAbsence(DateShift(years = 5), 6, 12, continuousNotes), USCIS_CONTINUOUS),
        ),
    ),
    ResidenceRuleSet(
        "us-citizenship-spouse", "US citizenship, married to a US citizen", application = true,
        listOf(
            // Half of the three years before applying: 548 days.
            ResidenceRule("us-citizenship-spouse-presence", "Days in the US in the 3 years before applying", usForImmigration, Counting.ANY_PART, RuleKind.Limit(LimitType.MIN_PRESENT, 548, DateShift(years = 3)), USCIS_SPOUSE),
            ResidenceRule("us-citizenship-spouse-continuous", "Longest time away from the US in the 3 years before applying", usForImmigration, Counting.ANY_PART, RuleKind.LongestAbsence(DateShift(years = 3), 6, 12, continuousNotes), USCIS_CONTINUOUS),
        ),
    ),
    ResidenceRuleSet(
        "us-green-card", "US green card", application = false,
        listOf(
            // Over six months away may be questioned; a year or more without a reentry permit may mean the card was given up.
            ResidenceRule(
                "us-green-card-absence", "Longest time away from the US", usForImmigration, Counting.ANY_PART,
                RuleKind.LongestAbsence(
                    DateShift(years = 5), 6, 12,
                    AbsenceNotes(
                        near = "Away over 6 months: you may be asked on your return whether you still live in the US.",
                        over = "Away a year or more: without a reentry permit, your green card may be taken as given up.",
                    ),
                ),
                USCIS_TRAVEL,
            ),
        ),
    ),
    ResidenceRuleSet(
        "us-tax", "US tax (substantial presence test)", application = false,
        listOf(
            // 31 days this year, and 183 with a third of last year's and a sixth of the year before's.
            ResidenceRule("us-substantial-presence", "Days in the US for the substantial presence test", listOf("US"), Counting.ANY_PART, RuleKind.SubstantialPresence, IRS_SPT),
        ),
    ),
    ResidenceRuleSet(
        "ca-permanent-residence", "Canada permanent residence", application = false,
        listOf(
            // 730 days in Canada in the last five years; leaving and returning days count.
            ResidenceRule("ca-pr-presence", "Days in Canada in the last 5 years", listOf("CA"), Counting.ANY_PART, RuleKind.Limit(LimitType.MIN_PRESENT, 730, DateShift(years = 5)), CA_PR),
        ),
    ),
    ResidenceRuleSet(
        "ca-citizenship", "Canada citizenship", application = true,
        listOf(
            // 1,095 days in Canada in the five years before applying; a part day counts.
            ResidenceRule("ca-citizenship-presence", "Days in Canada in the 5 years before applying", listOf("CA"), Counting.ANY_PART, RuleKind.Limit(LimitType.MIN_PRESENT, 1095, DateShift(years = 5)), CA_CITIZENSHIP),
        ),
    ),
    ResidenceRuleSet(
        "au-citizenship", "Australia citizenship", application = true,
        listOf(
            // Away no more than 12 months in the four years before applying, and 90 days in the last 12.
            ResidenceRule("au-citizenship-four-years", "Days outside Australia in the 4 years before applying", listOf("AU"), Counting.ANY_PART, RuleKind.Limit(LimitType.MAX_ABSENT, 365, DateShift(years = 4)), AU_CITIZENSHIP),
            ResidenceRule("au-citizenship-last-year", "Days outside Australia in the 12 months before applying", listOf("AU"), Counting.ANY_PART, RuleKind.Limit(LimitType.MAX_ABSENT, 90, DateShift(months = 12)), AU_CITIZENSHIP),
        ),
    ),
)

/** The first day of a span ending on [end], both days included. */
private fun spanStart(end: String, span: DateShift): String =
    shiftDate(shiftDate(end, DateShift(years = -span.years, months = -span.months)), DateShift(days = 1 - span.days))

data class DateRange(val start: String, val end: String)

/** A run of days counted against a rule (away, or in the area), within the window it was counted in. */
data class Stretch(val start: String, val end: String, val days: Int, val countries: List<String>, val tripIds: List<String>)

/**
 * NEAR is within a tenth of the limit; OVER is past it, short of a minimum,
 * a single absence as long as the rule allows, or meeting the substantial
 * presence test.
 */
enum class ResidenceStatus { OK, NEAR, OVER }

data class CurrentWindow(val used: Int, val window: DateRange)

/** A qualifying period's days, and whether it starts with the move to the area rather than the full period before the date. */
data class QualifyingPeriod(val start: String, val end: String, val moved: Boolean)

data class RuleResult(
    val rule: ResidenceRule,
    /** Days counted in the worst window; the weighted total for the substantial presence test; the longest absence in days. */
    val used: Double,
    val limit: Int,
    /** Days to the limit (negative once past it), or days still needed for a minimum. */
    val remaining: Double,
    val status: ResidenceStatus,
    /** The window counted, the worst for a rolling rule, or the longest absence from leaving to coming back. */
    val window: DateRange,
    /** For a rolling rule, the window ending on the date; for the substantial presence test, this year's days. */
    val current: CurrentWindow? = null,
    /** Days in the window nothing places, counted against the traveler. */
    val unknownDays: Int,
    /** The absences, or the stays in the area, in the window (the whole qualifying period, for one). */
    val stretches: List<Stretch>,
    /** The runs of days nothing places, in the window, with the trips that have them. */
    val unplaced: List<Stretch> = emptyList(),
    /** For a qualifying period, the days it covers. */
    val period: QualifyingPeriod? = null,
)

private fun isUnknown(d: DayPresence?) = d == null || (d.countries.isEmpty() && !d.inTransit)

/**
 * Whether a day counts towards what the rule measures. A day nothing places
 * is counted the way that keeps the traveler safe: in, for a limit on days
 * in; away, for a limit on absences or a minimum of days in.
 */
private fun counter(rule: ResidenceRule): (DayPresence?) -> Boolean {
    val area = rule.area.toSet()
    val inside = { d: DayPresence? -> d != null && d.countries.any { it in area } }
    val kind = rule.kind
    return when {
        kind is RuleKind.SubstantialPresence || (kind is RuleKind.Limit && kind.type == LimitType.MAX_PRESENT) -> { d -> inside(d) || isUnknown(d) }
        kind is RuleKind.Limit && kind.type == LimitType.MIN_PRESENT -> inside
        else -> { d -> !inside(d) }
    }
}

private fun stretches(timeline: Map<String, DayPresence>, range: DateRange, counted: (DayPresence?) -> Boolean, area: Set<String>, absence: Boolean): List<Stretch> {
    val runs = mutableListOf<Stretch>()
    var start: String? = null
    var end = ""
    var days = 0
    val countries = mutableSetOf<String>()
    val trips = mutableSetOf<String>()
    fun close() {
        start?.let { runs += Stretch(it, end, days, countries.sorted(), trips.sorted()) }
        start = null
        days = 0
        countries.clear()
        trips.clear()
    }
    for (day in dates(range.start, range.end)) {
        val d = timeline[day]
        if (!counted(d)) {
            close()
            continue
        }
        if (start == null) start = day
        end = day
        days += 1
        d?.countries?.filter { (it in area) != absence }?.let { countries += it }
        d?.tripIds?.let { trips += it }
    }
    close()
    return runs
}

private fun statusOf(type: LimitType, used: Int, limit: Int): ResidenceStatus = when {
    type == LimitType.MIN_PRESENT -> if (used < limit) ResidenceStatus.OVER else if (used < limit * 1.1) ResidenceStatus.NEAR else ResidenceStatus.OK
    used > limit -> ResidenceStatus.OVER
    used >= limit * 0.9 -> ResidenceStatus.NEAR
    else -> ResidenceStatus.OK
}

/** How a rule stands on [date] from a timeline covering everything it looks at (eight years before the date is enough). */
fun evaluateRule(rule: ResidenceRule, timeline: Map<String, DayPresence>, date: String, homes: List<HomePeriod> = emptyList()): RuleResult {
    val counted = counter(rule)
    val area = rule.area.toSet()
    fun countIn(range: DateRange) = dates(range.start, range.end).count { counted(timeline[it]) }
    fun unknownIn(range: DateRange) = dates(range.start, range.end).count { isUnknown(timeline[it]) }
    fun unplacedIn(range: DateRange) = stretches(timeline, range, ::isUnknown, area, absence = false)

    when (val kind = rule.kind) {
        is RuleKind.SubstantialPresence -> {
            val year = date.take(4).toInt()
            val thisYear = countIn(DateRange("$year-01-01", date))
            val lastYear = countIn(DateRange("${year - 1}-01-01", "${year - 1}-12-31"))
            val yearBefore = countIn(DateRange("${year - 2}-01-01", "${year - 2}-12-31"))
            // Compared in sixths of a day, whole numbers, so exactly 183 is
            // not rounded short of it; divided only for display.
            val sixths = 6 * thisYear + 2 * lastYear + yearBefore
            val used = sixths / 6.0
            val window = DateRange("${year - 2}-01-01", date)
            val status = when {
                thisYear >= 31 && sixths >= 6 * 183 -> ResidenceStatus.OVER
                sixths * 10 >= 9 * 6 * 183 -> ResidenceStatus.NEAR
                else -> ResidenceStatus.OK
            }
            return RuleResult(rule, used, 183, 183 - used, status, window, CurrentWindow(thisYear, DateRange("$year-01-01", date)), unknownIn(window), stretches(timeline, window, counted, area, absence = false), unplacedIn(window))
        }
        is RuleKind.LongestAbsence -> {
            val window = DateRange(spanStart(date, kind.window), date)
            // Every absence touching the window, from the day of leaving to the
            // day of coming back (or the date, while still away).
            val absences = stretches(timeline, DateRange(shiftDate(window.start, DateShift(years = -2)), date), counted, area, absence = true).filter { it.end >= window.start }
            var worst: Triple<DateRange, Int, ResidenceStatus>? = null
            for (s in absences) {
                val left = shiftDate(s.start, DateShift(days = -1))
                val back = if (s.end == date) date else shiftDate(s.end, DateShift(days = 1))
                val days = daysBetween(left, back).toInt()
                val status = when {
                    back >= shiftDate(left, DateShift(months = kind.overMonths)) -> ResidenceStatus.OVER
                    back > shiftDate(left, DateShift(months = kind.nearMonths)) -> ResidenceStatus.NEAR
                    else -> ResidenceStatus.OK
                }
                // The most serious absence, and the longest of those: the
                // thresholds are calendar months, so the longest by days may
                // be the milder one.
                val current = worst
                if (current == null || status > current.third || (status == current.third && days > current.second)) {
                    worst = Triple(DateRange(left, back), days, status)
                }
            }
            val limit = roundHalfUp(kind.overMonths * 365 / 12.0).toInt()
            val used = worst?.second ?: 0
            return RuleResult(
                rule, used.toDouble(), limit, (limit - used).toDouble(), worst?.third ?: ResidenceStatus.OK, worst?.first ?: window,
                unknownDays = unknownIn(window),
                unplaced = unplacedIn(window),
                stretches = absences.map { if (it.start < window.start) it.copy(start = window.start, days = it.days - daysBetween(it.start, window.start).toInt()) else it },
            )
        }
        is RuleKind.Limit -> {
            fun windowEnding(end: String) = DateRange(spanStart(end, kind.window), end)
            var latest = windowEnding(date)
            var window = latest
            var used = countIn(latest)
            var period: QualifyingPeriod? = null
            if (kind.rolling != null) {
                // Every window ending within the rolling period, kept as a
                // running count: the latest of the worst is the one shown.
                // For a qualifying period, only windows wholly inside it, as
                // days before it do not count.
                val full = spanStart(date, kind.rolling)
                val moved = if (kind.qualifying) movedTo(homes, area, date, full) else null
                val start = moved ?: full
                if (kind.qualifying) period = QualifyingPeriod(start, date, moved != null)
                var firstEnd = start
                // Moved on a day at a time, as month arithmetic is not
                // reversible (a period starting on 29 February); a window's
                // length bounds it.
                if (kind.qualifying) {
                    while (firstEnd < date && windowEnding(firstEnd).start < start) firstEnd = shiftDate(firstEnd, DateShift(days = 1))
                }
                if (kind.qualifying && windowEnding(firstEnd).start < start) {
                    // A period shorter than one window: its days alone.
                    latest = DateRange(start, date)
                    window = latest
                    used = countIn(latest)
                } else {
                    val ends = dates(if (firstEnd < date) firstEnd else date, date).toList()
                    val first = windowEnding(ends.first())
                    var count = countIn(first)
                    var from = first.start
                    used = count
                    window = first
                    for (end in ends.drop(1)) {
                        val next = windowEnding(end)
                        count -= dates(from, shiftDate(next.start, DateShift(days = -1))).count { counted(timeline[it]) }
                        if (counted(timeline[next.end])) count += 1
                        from = next.start
                        val better = if (kind.type == LimitType.MIN_PRESENT) count <= used else count >= used
                        if (better) {
                            used = count
                            window = next
                        }
                    }
                }
            }
            val current = if (kind.rolling != null) CurrentWindow(countIn(latest), latest) else null
            val listed = period?.let { DateRange(it.start, it.end) } ?: window
            // For a minimum of days in, the absences that took from it.
            val runs = if (kind.type == LimitType.MIN_PRESENT) {
                stretches(timeline, listed, { !counted(it) }, area, absence = true)
            } else {
                stretches(timeline, listed, counted, area, absence = kind.type == LimitType.MAX_ABSENT)
            }
            return RuleResult(rule, used.toDouble(), kind.limit, (kind.limit - used).toDouble(), statusOf(kind.type, used, kind.limit), window, current, unknownIn(window), runs, unplacedIn(window), period)
        }
    }
}

/**
 * The day the person moved to the area: the first day of the unbroken run of
 * homes in it that reaches the date, if that run starts after [since]. None
 * when home on the date is elsewhere, or not known.
 */
private fun movedTo(homes: List<HomePeriod>, area: Set<String>, date: String, since: String): String? {
    fun inArea(day: String) = homeAt(homes, day)?.country?.let(::countryCode)?.let { it in area } ?: false
    if (!inArea(date)) return null
    var day = date
    while (day > since) {
        val before = shiftDate(day, DateShift(days = -1))
        if (!inArea(before)) return day
        day = before
    }
    return null
}

/** A span as the report names it: "12 months", "180 days", "5 years". */
fun spanText(span: DateShift): String {
    fun part(n: Int, unit: String) = if (n != 0) listOf("$n $unit${if (n == 1) "" else "s"}") else emptyList()
    return (part(span.years, "year") + part(span.months, "month") + part(span.days, "day")).joinToString(" ")
}

/** Every rule of a set on [date], and whether home, for the days with no trip, has a country. */
data class ResidenceReport(val results: List<RuleResult>, val homeCountryKnown: Boolean)

/**
 * Every rule of a set on [date]. Trips booked up to the date count, so a date
 * ahead shows how planned trips would leave things; days with no trip are
 * taken as at home.
 */
fun residenceReport(all: List<TripWithSegments>, homes: List<HomePeriod>, set: ResidenceRuleSet, date: String, lookup: (String) -> AirportPlace? = ::airportPlace): ResidenceReport {
    val timeline = presenceTimeline(all, homes, shiftDate(date, DateShift(years = -8)), date, lookup)
    return ResidenceReport(set.rules.map { evaluateRule(it, timeline, date, homes) }, homes.any { it.country != null })
}

/**
 * A run of days in one country, from the day of arriving to the day of leaving (a day crossing a
 * border counts for both countries): at [home], or on the trips that took the traveler there. A
 * trip that stays in the country is part of the run, not a run of its own.
 */
data class CountryStay(val start: String, val end: String, val days: Int, val home: Boolean, val tripIds: List<String>)

/** [stays] latest first. */
data class CountryDays(val country: String, val days: Int, val stays: List<CountryStay>)

/**
 * [countries] most days first; [unplaced]: runs of trip days nothing places, with the trips whose
 * bookings to give a place, latest first, counted in no country until they have one;
 * [homeCountryKnown]: whether every day with no trip has a home country to be in.
 */
data class CountryDaysReport(val countries: List<CountryDays>, val unplaced: List<Stretch>, val homeCountryKnown: Boolean)

/** The days a report on [year] (or every year, when null) covers: that year up to [today], or from the first trip begun; null before any. */
fun countryDaysRange(all: List<TripWithSegments>, today: String, year: String? = null): DateRange? {
    if (year != null) return if (year > today.take(4)) null else DateRange("$year-01-01", minOf("$year-12-31", today))
    val first = all.mapNotNull { reportBounds(it.trip, it.segments)?.first }.filter { it <= today }.minOrNull() ?: return null
    return DateRange(first, today)
}

/**
 * How a day counts for a country: [PART], any part of it spent there (a day crossing a border counts
 * for both); [WHOLE], all of it (the day began and ended there, and went nowhere else); [NIGHTS],
 * where it ended.
 */
enum class CountryCounting { PART, WHOLE, NIGHTS }

/** The countries a day counts for, by [counting]; [before] is the day before. */
private fun countedIn(d: DayPresence?, before: DayPresence?, counting: CountryCounting): Set<String> {
    if (d == null) return emptySet()
    return when (counting) {
        CountryCounting.PART -> d.countries
        CountryCounting.NIGHTS -> setOfNotNull(d.night)
        CountryCounting.WHOLE -> {
            val only = d.countries.singleOrNull()
            if (only != null && d.night == only && before?.night == only) setOf(only) else emptySet()
        }
    }
}

/** Where the traveler was each day of [range], home included, as runs of days (or nights) in each country, counted by [counting]. */
fun countryDays(
    all: List<TripWithSegments>,
    homes: List<HomePeriod>,
    range: DateRange,
    lookup: (String) -> AirportPlace? = ::airportPlace,
    counting: CountryCounting = CountryCounting.PART,
): CountryDaysReport {
    // From the day before, to see where the first day began.
    val timeline = presenceTimeline(all, homes, shiftDate(range.start, DateShift(days = -1)), range.end, lookup)
    class Run(val start: String, var end: String, var days: Int, val home: Boolean, val tripIds: MutableSet<String>)
    val open = LinkedHashMap<String, Run>()
    val stays = LinkedHashMap<String, MutableList<CountryStay>>()
    fun close(country: String) {
        val run = open.remove(country) ?: return
        stays.getOrPut(country) { mutableListOf() } += CountryStay(run.start, run.end, run.days, run.home, if (run.home) emptyList() else run.tripIds.sorted())
    }
    for (day in dates(range.start, range.end)) {
        val d = timeline[day]
        val here = countedIn(d, timeline[shiftDate(day, DateShift(days = -1))], counting)
        val homeCountry = homeAt(homes, day)?.country?.let(::countryCode)
        // A stay ends when the traveler leaves, or when the country stops or starts being home (a
        // move abroad mid-stay starts a stay away).
        for (c in open.keys.toList()) if (c !in here || open.getValue(c).home != (c == homeCountry)) close(c)
        for (c in here) {
            val run = open.getOrPut(c) { Run(day, day, 0, c == homeCountry, mutableSetOf()) }
            run.end = day
            run.days += 1
            // Only the trips that put the traveler in this country: two trips sharing a day in
            // different countries each link to their own.
            run.tripIds += d?.tripCountries.orEmpty().filterValues { c in it }.keys
        }
    }
    for (c in open.keys.toList()) close(c)
    return CountryDaysReport(
        countries = stays.map { (country, runs) -> CountryDays(country, runs.sumOf { it.days }, runs.reversed()) }
            .sortedWith(compareByDescending<CountryDays> { it.days }.thenBy { it.country }),
        // Home's missing country is one fix on the Profile, not a run of days.
        unplaced = stretches(timeline, range, { isUnknown(it) && it?.assumedHome != true }, emptySet(), false).reversed(),
        homeCountryKnown = timeline.none { (day, d) -> day >= range.start && d.assumedHome && d.countries.isEmpty() },
    )
}
