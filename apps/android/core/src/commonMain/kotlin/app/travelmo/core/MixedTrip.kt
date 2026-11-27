package app.travelmo.core

/**
 * Why a trip looks like two in one, as its page says it: two flights in the air at once; a flight leaving from
 * another country hours after the one before it landed; or bookings for two groups of people who share no flight
 * (mixedTrip.ts).
 */
sealed interface MixedTrip {
    data class Overlap(val first: Segment, val second: Segment) : MixedTrip
    data class Elsewhere(val first: Segment, val second: Segment) : MixedTrip
    data class Travelers(val groups: List<List<String>>) : MixedTrip
}

/** How soon after landing a flight from another country gives a traveler away (elsewhereHours in mixedTrip.ts). */
const val ELSEWHERE_HOURS = 12

private fun arrives(s: Segment) = s.end ?: s.start
/** What a place goes by: its name, its city and, for an airport code, the city the airport serves (BOS is Boston). */
private fun placeNames(p: Place): Set<String> =
    listOfNotNull(p.name, p.city, p.code?.let { airportPlace(it)?.city }, p.code).map { it.trim().lowercase() }.filter { it.isNotEmpty() }.toSet()

/**
 * One place however a booking writes it: the same airport code, or a name or city the other goes by ("Boston" beside
 * BOS). Two codes are the same only alike, so LHR is never LGW. Two places neither booking gives match.
 */
private fun samePlace(a: Place?, b: Place?): Boolean {
    if (a == null || b == null) return a == null && b == null
    if (a.code != null && b.code != null) return a.code.trim().equals(b.code.trim(), ignoreCase = true)
    val other = placeNames(b)
    return placeNames(a).any { it in other }
}

private fun sameRoute(a: Segment, b: Segment) = samePlace(a.origin, b.origin) && samePlace(a.destination, b.destination)

/** One flight however many bookings give it: its route and its day. */
private fun sameFlight(a: Segment, b: Segment) = sameRoute(a, b) && localDate(a.start) == localDate(b.start)

/** The same place, known on both: an airport a booking leaves out matches nothing. */
private fun sharedPlace(a: Place?, b: Place?) = a != null && b != null && samePlace(a, b)

/** How far apart two bookings may put one journey's ends: a schedule change one booking heard of and the other didn't. */
private const val JOURNEY_SLACK_MS = 60 * 60_000L

private fun near(a: String, b: String) = kotlin.math.abs(instantMillis(a) - instantMillis(b)) <= JOURNEY_SLACK_MS

/**
 * Whether [leg] is part of [journey]: within its times, and leaving from where and when it leaves or landing where and
 * when it lands, as one booking writes ADL to LHR and another its legs, ADL to DOH and DOH to LHR.
 */
private fun legOf(leg: Segment, journey: Segment) =
    instantMillis(leg.start) >= instantMillis(journey.start) - JOURNEY_SLACK_MS &&
        instantMillis(arrives(leg)) <= instantMillis(arrives(journey)) + JOURNEY_SLACK_MS &&
        (
            (sharedPlace(leg.origin, journey.origin) && near(leg.start, journey.start)) ||
                (sharedPlace(leg.destination, journey.destination) && near(arrives(leg), arrives(journey)))
            )

/** One journey, however the bookings write it: the same route, or one a leg of the other. */
private fun oneJourney(a: Segment, b: Segment) = sameRoute(a, b) || legOf(a, b) || legOf(b, a)

private fun names(s: Segment, gone: Set<String>) = s.travelers.mapNotNull(::canonicalName).filter { it !in gone }

/**
 * Whether a trip's bookings look like two trips filed as one, and why; null when they could all be one traveler's
 * (or one party's). Goes by what is still booked, leaving out the names its owner took off it ([removed]). Flights
 * alike (the same route at once) are one flight booked twice, not two, and a flight with its legs is one journey. As
 * mixedTrip.ts.
 */
fun mixedTrip(segments: List<Segment>, removed: List<String> = emptyList()): MixedTrip? {
    val live = liveSegments(segments)
    val flights = live.filter { it.type == SegmentType.FLIGHT }.sortedBy { instantMillis(it.start) }
    for (i in flights.indices) {
        for (j in i + 1 until flights.size) {
            val a = flights[i]
            val b = flights[j]
            if (instantMillis(b.start) >= instantMillis(arrives(a)) && instantMillis(b.start) != instantMillis(a.start)) break
            if (!oneJourney(a, b)) return MixedTrip.Overlap(a, b)
        }
    }
    for (i in 1 until flights.size) {
        val a = flights[i - 1]
        val b = flights[i]
        // Only a known landing: a flight without its arrival time says nothing of when it lands, and one flight booked
        // twice isn't two.
        val landing = a.end ?: continue
        if (sameRoute(a, b) && instantMillis(a.start) == instantMillis(b.start)) continue
        val gap = instantMillis(b.start) - instantMillis(landing)
        if (gap < 0 || gap > ELSEWHERE_HOURS * 3_600_000L) continue
        val landed = placeCountry(a.destination, SegmentType.FLIGHT)
        val leaves = placeCountry(b.origin, SegmentType.FLIGHT)
        if (landed != null && leaves != null && landed != leaves) return MixedTrip.Elsewhere(a, b)
    }
    val gone = removed.mapNotNull(::canonicalName).toSet()
    val groups = travelerGroups(live, gone)
    // Groups that fly, and share no flight with each other: a party flying apart from the rest would share at least
    // one ([travelerGroups] joins those that do).
    val flying = groups.filter { g -> flights.any { f -> names(f, gone).any { it in g } } }
    if (flying.size > 1) return MixedTrip.Travelers(listOf(flying[0], flying[1]))
    return null
}

/**
 * The trip's travelers in groups that travel together: names on one booking are one group, and a name on two bookings
 * joins theirs, as do another spelling of it and anyone on the same flight.
 */
private fun travelerGroups(live: List<Segment>, gone: Set<String>): List<List<String>> {
    val parent = LinkedHashMap<String, String>()
    fun find(n: String): String {
        val p = parent[n] ?: n
        if (p == n) return n
        val root = find(p)
        parent[n] = root
        return root
    }
    for (s in live) {
        val ns = names(s, gone)
        for (n in ns) if (n !in parent) parent[n] = n
        for (n in ns.drop(1)) parent[find(n)] = find(ns[0])
    }
    // Those on one flight however many bookings give it, or on a flight and its legs: a party booked apart.
    val flown = live.filter { it.type == SegmentType.FLIGHT }.mapNotNull { s -> names(s, gone).firstOrNull()?.let { s to it } }
    for (i in flown.indices) {
        for (j in i + 1 until flown.size) {
            val (a, an) = flown[i]
            val (b, bn) = flown[j]
            if (sameFlight(a, b) || legOf(a, b) || legOf(b, a)) parent[find(bn)] = find(an)
        }
    }
    // One person however the bookings spell them ("John Smith", "John Andrew Smith", "J Smith"): [sameTraveler].
    val all = parent.keys.toList()
    for (i in all.indices) for (j in i + 1 until all.size) if (sameTraveler(all[i], all[j])) parent[find(all[j])] = find(all[i])
    val byRoot = LinkedHashMap<String, MutableList<String>>()
    for (n in parent.keys.toList()) byRoot.getOrPut(find(n)) { mutableListOf() } += n
    return byRoot.values.map { it.toList() }
}
