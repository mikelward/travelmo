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
private fun placeKey(p: Place?) = p?.code?.uppercase() ?: p?.name?.trim()?.lowercase() ?: ""
private fun flightKey(s: Segment) = "${placeKey(s.origin)}>${placeKey(s.destination)}@${localDate(s.start)}"
private fun sameRoute(a: Segment, b: Segment) = placeKey(a.origin) == placeKey(b.origin) && placeKey(a.destination) == placeKey(b.destination)

private fun names(s: Segment, gone: Set<String>) = s.travelers.mapNotNull(::canonicalName).filter { it !in gone }

/**
 * Whether a trip's bookings look like two trips filed as one, and why; null when they could all be one traveler's
 * (or one party's). Goes by what is still booked, leaving out the names its owner took off it ([removed]). Flights
 * alike (the same route at once) are one flight booked twice, not two. As mixedTrip.ts.
 */
fun mixedTrip(segments: List<Segment>, removed: List<String> = emptyList()): MixedTrip? {
    val live = liveSegments(segments)
    val flights = live.filter { it.type == SegmentType.FLIGHT }.sortedBy { instantMillis(it.start) }
    for (i in flights.indices) {
        for (j in i + 1 until flights.size) {
            val a = flights[i]
            val b = flights[j]
            if (instantMillis(b.start) >= instantMillis(arrives(a)) && instantMillis(b.start) != instantMillis(a.start)) break
            if (!sameRoute(a, b)) return MixedTrip.Overlap(a, b)
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
    // Those on one flight however many bookings give it: a party booked apart.
    val onFlight = HashMap<String, String>()
    for (s in live) {
        if (s.type != SegmentType.FLIGHT) continue
        val first = names(s, gone).firstOrNull() ?: continue
        val other = onFlight[flightKey(s)]
        if (other != null) parent[find(first)] = find(other) else onFlight[flightKey(s)] = first
    }
    // One person however the bookings spell them ("John Smith", "John Andrew Smith", "J Smith"): [sameTraveler].
    val all = parent.keys.toList()
    for (i in all.indices) for (j in i + 1 until all.size) if (sameTraveler(all[i], all[j])) parent[find(all[j])] = find(all[i])
    val byRoot = LinkedHashMap<String, MutableList<String>>()
    for (n in parent.keys.toList()) byRoot.getOrPut(find(n)) { mutableListOf() } += n
    return byRoot.values.map { it.toList() }
}
