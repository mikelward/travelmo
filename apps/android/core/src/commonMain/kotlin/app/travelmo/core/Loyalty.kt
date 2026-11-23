package app.travelmo.core


// A loyalty program at a glance, as packages/core/src/loyalty.ts: the
// account number, the balance and the status, read by their usual labels,
// and the program a booking's provider belongs to.

/** [person]: whose it is, when not the owner's. */
data class LoyaltySummary(
    val title: String,
    val account: String? = null,
    val balance: String? = null,
    val status: String? = null,
    val nextStatus: String? = null,
    val person: String? = null,
)

/** The field [allLoyalty] marks someone else's membership with. */
const val PERSON_LABEL = "Belongs to"

private val accountLabels = listOf("account number", "membership number", "member number", "account no", "membership no", "account", "number")
private val balanceLabels = listOf("balance", "points balance", "miles balance", "point balance", "points", "miles")
private val statusLabels = listOf("elite status", "status", "tier", "level", "elite level")
private val nextStatusLabels = listOf("elite next status", "next status", "next tier", "next level")

private fun lastPart(label: String) = label.split("›").last().trim().lowercase()
private fun isNested(label: String) = label.contains("›")

// The program's own value before a nested one (a sub-account's balance is
// not the program's), whatever order the import listed them in.
private fun field(entry: ProfileEntry, wanted: List<String>): String? {
    for (nested in listOf(false, true)) {
        for (want in wanted) {
            val found = entry.fields.firstOrNull { isNested(it.label) == nested && lastPart(it.label) == want && it.value.isNotBlank() }
            if (found != null) return found.value.trim()
        }
    }
    return null
}

/** "12000" → "12,000"; anything that is not a plain number stays as written. */
fun formatBalance(value: String): String =
    if (Regex("""^\d{1,15}$""").matches(value)) groupThousands(value.toLong()) else value

fun loyaltySummary(entry: ProfileEntry): LoyaltySummary = LoyaltySummary(
    title = entry.title,
    account = field(entry, accountLabels),
    balance = field(entry, balanceLabels)?.let(::formatBalance),
    status = field(entry, statusLabels),
    nextStatus = field(entry, nextStatusLabels),
    person = entry.fields.firstOrNull { it.label == PERSON_LABEL }?.value,
)

// Words that name what a program is, not whose it is, and the parts of a
// web address that are not the brand.
private val generic = setOf(
    "air", "airline", "airlines", "airways", "and", "award", "awards", "biz", "bonus", "card", "club", "com", "flyer", "frequent", "group",
    "honors", "hotel", "hotels", "http", "https", "info", "inn", "international", "loyalty", "member", "members", "membership", "miles",
    "net", "org", "plus", "points", "privilege", "privileges", "program", "programme", "reward", "rewards", "resorts", "the", "travel", "www",
)

/** The distinctive words of a name: three or more letters or digits, not generic. */
fun nameWords(name: String): Set<String> =
    Regex("""[\p{L}\p{N}]{3,}""").findAll(name.lowercase()).map { it.value }.filter { it !in generic }.toSet()

/** The programs a booking's provider belongs to: those sharing a distinctive word with it. */
fun programsFor(provider: String?, programs: List<ProfileEntry>): List<ProfileEntry> {
    if (provider == null) return emptyList()
    val words = nameWords(provider)
    if (words.isEmpty()) return emptyList()
    return programs.filter { p -> nameWords(p.title).any { it in words } }
}

/** One line for a booking: the program, the number, the status and, when not the owner's, whose it is. */
fun loyaltyLine(entry: ProfileEntry): String {
    val s = loyaltySummary(entry)
    return listOfNotNull(s.title, s.account, s.status, s.person).joinToString(" · ")
}

// A number as written: spaces, dashes and case do not count.
private fun plainNumber(n: String) = n.replace(Regex("[\\s-]"), "").uppercase()

/** A found membership as the profile shows a program: labeled fields the table reads, and the email it came from. */
fun foundLoyaltyEntry(found: FoundLoyalty): ProfileEntry = ProfileEntry(
    found.program,
    buildList {
        add(ProfileField("Account number", found.number))
        found.balance?.let { add(ProfileField("Balance", it)) }
        found.status?.let { add(ProfileField("Status", it)) }
        found.holder?.let { add(ProfileField("Name", it)) }
        add(ProfileField("From email", found.label ?: "A booking email"))
    },
)

/**
 * Every program on a profile, the owner's before anyone else's: what TripIt
 * imported, then what emails showed that it did not have (by number). A statement newer than the TripIt upload
 * brings its balance and status to the imported program it matches, ahead of
 * the imported ones, which the table reads first.
 */
fun allLoyalty(profile: TravelProfile): List<ProfileEntry> {
    // One membership: the same number in the same program, as the parser keeps them.
    fun matches(entry: ProfileEntry, found: FoundLoyalty): Boolean {
        val account = loyaltySummary(entry).account ?: return false
        return sameMembership(entry.title, account, found.program, found.number)
    }
    // Whose it is: as the owner said, else as the email named, else theirs.
    fun withPerson(entry: ProfileEntry, number: String?, fromEmail: FoundLoyalty?): ProfileEntry {
        val said = number?.let { n -> profile.loyaltyPeople.lastOrNull { sameMembership(it.program, it.number, entry.title, n) } }
        val person = if (said != null) said.person else fromEmail?.person
        return if (person != null) ProfileEntry(entry.title, entry.fields + ProfileField(PERSON_LABEL, person)) else entry
    }
    // Newer than the TripIt upload, so it has the last word (no upload: it has).
    fun afterUpload(at: String?) = at != null && (profile.importedAt == null || at > profile.importedAt)
    val imported = profile.loyalty.map { entry ->
        val statement = profile.foundLoyalty.firstOrNull { matches(entry, it) }
        val balance = statement?.balance?.takeIf { afterUpload(statement.balanceAt) }
        val status = statement?.status?.takeIf { afterUpload(statement.statusAt) }
        val account = loyaltySummary(entry).account
        val shown = if (statement == null || (balance == null && status == null)) {
            entry
        } else {
            // Under the labels the table reads first, so the email's win.
            ProfileEntry(
                entry.title,
                buildList {
                    balance?.let { add(ProfileField("Balance", it)) }
                    status?.let { add(ProfileField("Elite status", it)) }
                    addAll(entry.fields)
                    if (balance != null) add(ProfileField("Balance from email", statement.balanceLabel ?: statement.label ?: "A statement"))
                },
            )
        }
        withPerson(shown, account, statement)
    }
    val all = imported + profile.foundLoyalty.filter { found -> profile.loyalty.none { matches(it, found) } }.map { withPerson(foundLoyaltyEntry(it), it.number, it) }
    // The owner's first, as a booking lists them.
    val (theirs, mine) = all.partition { loyaltySummary(it).person != null }
    return mine + theirs
}

/**
 * The owner's word on whose a membership is, replacing any earlier word on
 * it; [person] null says it is theirs. The oldest word goes when the list is full.
 */
fun withLoyaltyPerson(people: List<LoyaltyPerson>, program: String, number: String, person: String?): List<LoyaltyPerson> {
    val name = person?.trim()?.takeIf { it.isNotEmpty() }
    return (people.filterNot { sameMembership(it.program, it.number, program, number) } + LoyaltyPerson(program, number, name)).takeLast(MAX_LOYALTY_PEOPLE)
}

/** The programs grouped by whose they are: the owner's first (person null), then each other person's, by name. */
data class LoyaltyGroup(val person: String?, val entries: List<ProfileEntry>)

fun loyaltyByPerson(entries: List<ProfileEntry>): List<LoyaltyGroup> =
    entries.groupBy { loyaltySummary(it).person }
        .entries
        .sortedWith(compareBy<Map.Entry<String?, List<ProfileEntry>>> { it.key != null }.thenBy { it.key.orEmpty() })
        .map { LoyaltyGroup(it.key, it.value) }

// One membership: the same number in the same program.
private fun sameMembership(programA: String, numberA: String, programB: String, numberB: String): Boolean =
    plainNumber(numberA) == plainNumber(numberB) && sameProgram(programA, programB)

// One program by its name as written, else by a distinctive word in common.
// A name with no distinctive word ("Privilege Club") could be any program's.
private fun sameProgram(a: String, b: String): Boolean {
    val x = nameWords(a)
    val y = nameWords(b)
    return a.trim().equals(b.trim(), ignoreCase = true) || x.isEmpty() || y.isEmpty() || x.any { it in y }
}
