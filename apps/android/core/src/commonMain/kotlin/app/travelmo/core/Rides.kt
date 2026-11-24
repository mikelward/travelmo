package app.travelmo.core

// Mirrors packages/core/src/rides.ts.

/** Which suggestions a traveler's own company joins: rides at home, or a car wherever a flight lands. */
enum class RideNear(val wire: String) {
    HOME("home"),
    ANYWHERE("anywhere");

    companion object {
        fun fromWire(wire: String?): RideNear? = entries.firstOrNull { it.wire == wire }
    }
}

/**
 * A company the traveler books cars or rides with, added in Settings;
 * [countries], when any, are the only ones it is offered in (ISO codes).
 */
data class RideCompany(val name: String, val url: String, val near: RideNear, val countries: List<String> = emptyList())

const val MAX_RIDE_COMPANIES = 20

// An https:// link with a host, as the web's schema (`.url()`) needs:
// "https://?" has none.
private val isoCode = Regex("[A-Z]{2}")

private val httpsLink = Regex("""https://[^/?#\s]+([/?#]\S*)?""")

/**
 * A company from the profile's `rideCompanies`, or null when it does not parse
 * (as the web's schema leaves it out): a name, an https:// link, and where.
 */
fun rideCompanyOrNull(name: String?, url: String?, near: String?, countries: List<*>? = null): RideCompany? {
    val n = name?.trim()?.takeIf { it.isNotEmpty() && it.length <= 60 } ?: return null
    val u = url?.trim()?.takeIf { it.length <= 500 && httpsLink.matches(it) } ?: return null
    val where = RideNear.fromWire(near) ?: return null
    // As the web's schema: two capital letters each, at most fifty, or the company is not one.
    val codes = countries.orEmpty().map { it as? String ?: return null }
    if (codes.size > 50 || codes.any { !isoCode.matches(it) }) return null
    return RideCompany(n, u, where, codes)
}

/** The traveler's own companies with [company] added, as rides.ts: unchanged when it is there, refused past the limit. */
/** Whether two companies are one, as rides.ts: their countries in any order. */
fun sameRideCompany(a: RideCompany, b: RideCompany): Boolean =
    a.name == b.name && a.url == b.url && a.near == b.near && a.countries.sorted() == b.countries.sorted()

fun withRideCompany(companies: List<RideCompany>, company: RideCompany): List<RideCompany> {
    if (companies.any { sameRideCompany(it, company) }) return companies
    check(companies.size < MAX_RIDE_COMPANIES) { "At most $MAX_RIDE_COMPANIES." }
    return companies + company
}

/** The traveler's own companies without [company]. */
fun withoutRideCompany(companies: List<RideCompany>, company: RideCompany): List<RideCompany> = companies.filterNot { sameRideCompany(it, company) }

/** A rental company's name and site. */
data class CompanyLink(val name: String, val url: String)

/** The rental companies every car suggestion offers, at their own sites. */
val rentalCompanies = listOf(
    CompanyLink("Avis", "https://www.avis.com/"),
    CompanyLink("Enterprise", "https://www.enterprise.com/"),
    CompanyLink("Hertz", "https://www.hertz.com/"),
    CompanyLink("Budget", "https://www.budget.com/"),
    CompanyLink("Sixt", "https://www.sixt.com/"),
    CompanyLink("National", "https://www.nationalcar.com/"),
    CompanyLink("Alamo", "https://www.alamo.com/"),
)

enum class RideNeedKind(val wire: String) { TO_AIRPORT("toAirport"), FROM_AIRPORT("fromAirport"), CAR("car") }

data class RideNeed(val segmentId: String, val kind: RideNeedKind)

/** How a dismissed suggestion is kept in the profile's `hiddenRideNeeds`. */
fun rideNeedKey(need: RideNeed) = "${need.segmentId}/${need.kind.wire}"

const val MAX_HIDDEN_RIDE_NEEDS = 200

private const val CONNECTION_HOURS = 12.0
private const val CAR_DAYS = 2.0
private val travelTypes = setOf(SegmentType.FLIGHT, SegmentType.TRAIN, SegmentType.BUS, SegmentType.FERRY)

private fun sameCode(a: Place?, b: Place?) = a?.code != null && b?.code != null && a.code.equals(b.code, ignoreCase = true)
private fun hours(from: String, to: String) = (instantMillis(to) - instantMillis(from)) / 3_600_000.0

/**
 * The flights on a trip with no way to or from their airport booked, still
 * ahead of [now]: leaving home with no transfer to the airport, landing at
 * home with no transfer from it, or landing away as the last leg there with no
 * transfer from it and no car collected there within two days. Without a home,
 * only a landing that is not the trip's last journey is known to be away.
 */
fun rideNeeds(
    segments: List<Segment>,
    periods: List<HomePeriod>,
    now: String,
    overrides: List<HomePeriod> = emptyList(),
    hidden: List<String> = emptyList(),
): List<RideNeed> {
    val live = liveSegments(segments)
    val journeys = live.filter { it.type in travelTypes }.sortedBy { instantMillis(it.start) }
    val last = journeys.lastOrNull()
    val rides = live.filter { it.type == SegmentType.CAR_RENTAL || it.type == SegmentType.OTHER }
    val nowMs = instantMillis(now)
    val needs = mutableListOf<RideNeed>()
    for (flight in journeys) {
        if (flight.type != SegmentType.FLIGHT) continue
        val landed = flight.end ?: flight.start
        val arrivesFrom = journeys.any { j ->
            j !== flight && sameCode(j.destination, flight.origin) && hours(j.end ?: j.start, flight.start).let { it in 0.0..CONNECTION_HOURS }
        }
        val leavesOnward = journeys.any { j ->
            j !== flight && sameCode(j.origin, flight.destination) && hours(landed, j.start).let { it in 0.0..CONNECTION_HOURS }
        }
        // A taxi to the airport says nothing about getting on from the other end.
        val toCovered = rides.any { rideToDeparture(it, flight) != null }
        val fromCovered = rides.any { rideFromArrival(it, flight) != null }
        if (instantMillis(landed) <= nowMs) continue
        if (!arrivesFrom && !toCovered && instantMillis(flight.start) > nowMs &&
            journeyHome(flight.origin, localDate(flight.start), periods, overrides)
        ) {
            needs += RideNeed(flight.id, RideNeedKind.TO_AIRPORT)
        }
        if (leavesOnward || fromCovered) continue
        if (journeyHome(flight.destination, localDate(landed), periods, overrides)) {
            needs += RideNeed(flight.id, RideNeedKind.FROM_AIRPORT)
            continue
        }
        // Home on the landing date: a timeline that starts later says nothing.
        val homeKnown = homeAt(periods, localDate(landed), overrides) != null
        if (!homeKnown && flight === last) continue
        // A car collected where the flight lands, around when it lands.
        val hasCar = live.any {
            it.type == SegmentType.CAR_RENTAL && nearHub(it.origin ?: it.destination, flight.destination) &&
                hours(landed, it.start) in -CONNECTION_HOURS..(CAR_DAYS * 24)
        }
        if (!hasCar) needs += RideNeed(flight.id, RideNeedKind.CAR)
    }
    return needs.filter { rideNeedKey(it) !in hidden }
}

/**
 * For a car, the rental companies then the traveler's own; for a ride at
 * home, only their own near home. One limited to some countries is offered
 * only in them; with [country] unknown, every one is.
 */
fun rideCompaniesFor(kind: RideNeedKind, own: List<RideCompany>, country: String? = null): List<CompanyLink> {
    val where = country?.uppercase()
    val mine = own.filter { if (kind == RideNeedKind.CAR) it.near == RideNear.ANYWHERE else it.near == RideNear.HOME }
        .filter { where == null || it.countries.isEmpty() || where in it.countries }
        .map { CompanyLink(it.name, it.url) }
    return if (kind == RideNeedKind.CAR) rentalCompanies + mine else mine
}

/** Where a suggestion's ride or car is, as rides.ts: the airport a ride to it leaves for, else where the flight lands. */
fun rideCountry(kind: RideNeedKind, flight: Segment): String? =
    (if (kind == RideNeedKind.TO_AIRPORT) flight.origin else flight.destination)?.country?.uppercase()

/** Countries as typed for a company: their codes, or the first part that is no country. */
sealed interface ParsedCountries {
    data class Countries(val codes: List<String>) : ParsedCountries
    data class Unknown(val text: String) : ParsedCountries
}

/** Names or codes separated by commas ("UK, France"), as rides.ts: each as its ISO code, once. */
fun parseCountries(text: String): ParsedCountries {
    val codes = mutableListOf<String>()
    for (part in text.split(",").map { it.trim() }.filter { it.isNotEmpty() }) {
        val code = countryCodeOf(part) ?: part.uppercase().takeIf { it.length == 2 && isCountryCode(it) } ?: return ParsedCountries.Unknown(part)
        if (code !in codes) codes += code
    }
    return ParsedCountries.Countries(codes)
}
