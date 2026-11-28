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

private val plainDigits = Regex("""^\d{1,15}$""")

/** "12000" → "12,000"; anything that is not a plain number stays as written. */
fun formatBalance(value: String): String =
    if (plainDigits.matches(value)) groupThousands(value.toLong()) else value

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
    "air", "airline", "airlines", "airways", "and", "award", "awards", "biz", "bonus", "card", "club", "com", "flier", "flyer", "frequent", "group",
    "honors", "hotel", "hotels", "http", "https", "info", "inn", "international", "loyalty", "member", "members", "membership", "miles",
    "net", "number", "org", "plus", "points", "privilege", "privileges", "program", "programme", "reward", "rewards", "resorts", "the", "travel", "www",
)

private val nameWordPattern = Regex("""[\p{L}\p{N}]{3,}""")

/** The distinctive words of a name: three or more letters or digits, not generic. */
fun nameWords(name: String): Set<String> =
    nameWordPattern.findAll(name.lowercase()).map { it.value }.filter { it !in generic }.toSet()

/** The programs a booking's provider belongs to: those sharing a canonical airline alias or distinctive word with it. */
fun programsFor(provider: String?, programs: List<ProfileEntry>): List<ProfileEntry> {
    if (provider == null) return emptyList()
    val providerCanonical = canonicalProgram(provider)
    val words = nameWords(provider)
    if (providerCanonical == null && words.isEmpty()) return emptyList()
    return programs.filter { p ->
        (providerCanonical != null && canonicalProgram(p.title) == providerCanonical) ||
            nameWords(p.title).any { it in words }
    }
}

/** One line for a booking: the program, the number, the status and, when not the owner's, whose it is. */
fun loyaltyLine(entry: ProfileEntry): String {
    val s = loyaltySummary(entry)
    return listOfNotNull(s.title, s.account, s.status, s.person).joinToString(" · ")
}

private val numberSeparators = Regex("[\\s-]")
private val leadingZeroPrefix = Regex("^([A-Z]*)0+(?=\\d)")
private val trailingTierRe = Regex("/[A-Za-z][A-Za-z0-9\\s-]*$")
private val separatedMaskedRe = Regex("^([A-Z0-9]{2})[-\\s]+([*•●·]+|X{2,})([A-Z0-9]{3,})$")
private val unprefixedMaskRe = Regex("^([*•●·]+|X{2,})([A-Z0-9]{3,})$")
private val prefixedMaskRe = Regex("^([A-Z0-9]{2})([*•●·]+|X{2,})([A-Z0-9]{3,})$")
private val separatedPrefixRe = Regex("^([A-Z0-9]{2})[-\\s]+([A-Z0-9]{5,})$")
private val gluedPrefixRe = Regex("^([A-Z0-9]{2})(\\d{5,})$")
private val nonAlnumRe = Regex("[^a-z0-9]+")

private data class ParsedLoyaltyNumber(
    val masked: Boolean,
    val plain: String,
    val tail: String = "",
    val unprefixed: String? = null,
)

private val programAliases: List<List<String>> = listOf(
    listOf("aa", "american", "aadvantage"),
    listOf("ac", "canada", "aeroplan"),
    listOf("af", "kl", "air france", "klm", "flying blue"),
    listOf("as", "alaska", "mileage plan", "atmos"),
    listOf("b6", "jetblue", "trueblue"),
    listOf("ba", "british", "executive"),
    listOf("cx", "cathay", "asia miles"),
    listOf("dl", "delta", "skymiles"),
    listOf("ei", "aer lingus", "aerclub"),
    listOf("ek", "emirates", "skywards"),
    listOf("ib", "iberia"),
    listOf("lh", "lufthansa", "miles more"),
    listOf("nz", "new zealand", "airpoints"),
    listOf("qf", "qantas"),
    listOf("qr", "qatar"),
    listOf("sq", "singapore", "krisflyer"),
    listOf("ua", "united", "mileageplus"),
    listOf("vs", "virgin atlantic"),
    listOf("wn", "southwest", "rapid rewards"),
)

private fun canonicalProgram(name: String): Int? {
    val norm = name.trim().lowercase().replace(nonAlnumRe, " ").trim()
    if (norm.isEmpty()) return null
    var found: Int? = null
    for (i in programAliases.indices) {
        val hit = programAliases[i].any { tok ->
            if (tok.length <= 2) norm == tok else " $norm ".contains(" $tok ")
        }
        if (hit) {
            if (found != null) return null
            found = i
        }
    }
    return found
}

private fun verifiedPrefixes(program: String?): Set<String> {
    if (program == null) return emptySet()
    val idx = canonicalProgram(program) ?: return emptySet()
    return programAliases[idx].filter { it.length == 2 }.map { it.uppercase() }.toSet()
}

private fun parseLoyaltyNumber(n: String, allowedPrefixes: Set<String> = emptySet()): ParsedLoyaltyNumber {
    val stripped = n.trim().replace(trailingTierRe, "").trim()
    val upperStripped = stripped.uppercase()
    val sepMask = separatedMaskedRe.matchEntire(upperStripped)
    if (sepMask != null) {
        return ParsedLoyaltyNumber(masked = true, plain = upperStripped.replace(numberSeparators, ""), tail = sepMask.groupValues[3])
    }
    val raw = upperStripped.replace(numberSeparators, "")
    val unprefixedMask = unprefixedMaskRe.matchEntire(raw)
    if (unprefixedMask != null) {
        return ParsedLoyaltyNumber(masked = true, plain = raw, tail = unprefixedMask.groupValues[2])
    }
    val prefixedMask = prefixedMaskRe.matchEntire(raw)
    if (prefixedMask != null && prefixedMask.groupValues[1] in allowedPrefixes) {
        return ParsedLoyaltyNumber(masked = true, plain = raw, tail = prefixedMask.groupValues[3])
    }
    val plain = raw.replace(leadingZeroPrefix, "$1")
    val sepMatch = separatedPrefixRe.matchEntire(upperStripped)
    val unprefixed = if (sepMatch != null && sepMatch.groupValues[1] in allowedPrefixes) {
        sepMatch.groupValues[2].replace(numberSeparators, "").replace(leadingZeroPrefix, "$1")
    } else {
        val gluedMatch = gluedPrefixRe.matchEntire(raw)
        if (gluedMatch != null && gluedMatch.groupValues[1] in allowedPrefixes) {
            gluedMatch.groupValues[2].replace(leadingZeroPrefix, "$1")
        } else {
            null
        }
    }
    return ParsedLoyaltyNumber(masked = false, plain = plain, unprefixed = unprefixed)
}

fun sameNumber(a: String, b: String, programA: String? = null, programB: String? = null): Boolean {
    val prefixes = verifiedPrefixes(programA) + verifiedPrefixes(programB)
    val pa = parseLoyaltyNumber(a, prefixes)
    val pb = parseLoyaltyNumber(b, prefixes)
    if (pa.masked && pb.masked) return pa.tail.endsWith(pb.tail) || pb.tail.endsWith(pa.tail)
    if (pa.masked && !pb.masked) return pb.plain.endsWith(pa.tail) || (pb.unprefixed?.endsWith(pa.tail) == true)
    if (!pa.masked && pb.masked) return pa.plain.endsWith(pb.tail) || (pa.unprefixed?.endsWith(pb.tail) == true)
    if (pa.plain == pb.plain) return true
    val da = pa.unprefixed ?: pa.plain
    val db = pb.unprefixed ?: pb.plain
    return (pa.unprefixed != null || pb.unprefixed != null) && da == db
}

private fun preferNumber(before: String, seen: String, prefixes: Set<String>): String {
    val pb = parseLoyaltyNumber(before, prefixes)
    val ps = parseLoyaltyNumber(seen, prefixes)
    if (!pb.masked && ps.masked) return before
    if (pb.masked && !ps.masked) return seen
    if (pb.masked && ps.masked) {
        if (ps.tail.length != pb.tail.length) return if (ps.tail.length > pb.tail.length) seen else before
        val bSlash = '/' in before
        val sSlash = '/' in seen
        if (bSlash != sSlash) return if (bSlash) seen else before
        return before
    }
    val bSlash = '/' in before
    val sSlash = '/' in seen
    if (bSlash != sSlash) return if (bSlash) seen else before
    return seen
}

private fun preferProgram(before: String, seen: String): String {
    val bw = nameWords(before).size
    val sw = nameWords(seen).size
    if (sw != bw) return if (sw > bw) seen else before
    if (seen.trim().length != before.trim().length) return if (seen.trim().length > before.trim().length) seen else before
    return seen
}

private fun withBalanceLabel(f: FoundLoyalty): FoundLoyalty =
    if (f.balance != null && f.label != null && f.balanceLabel == null) f.copy(balanceLabel = f.label) else f

private fun mergeFoundPair(before: FoundLoyalty, seen: FoundLoyalty): FoundLoyalty {
    val newerBalance = seen.balance != null && (before.balanceAt == null || (seen.balanceAt != null && seen.balanceAt >= before.balanceAt))
    val source = withBalanceLabel(if (newerBalance) seen else before)
    val newerStatus = seen.status != null && (before.statusAt == null || (seen.statusAt != null && seen.statusAt >= before.statusAt))
    val statusFrom = if (newerStatus || before.status == null) seen else before
    val prefixes = verifiedPrefixes(before.program) + verifiedPrefixes(seen.program)
    return FoundLoyalty(
        program = preferProgram(before.program, seen.program),
        number = preferNumber(before.number, seen.number, prefixes),
        status = statusFrom.status,
        statusAt = if (statusFrom.status != null) statusFrom.statusAt else null,
        balance = source.balance,
        balanceAt = if (source.balance != null) source.balanceAt else null,
        balanceLabel = if (source.balance != null) source.balanceLabel else null,
        holder = seen.holder ?: before.holder,
        person = before.person,
        messageId = seen.messageId,
        label = seen.label ?: before.label,
        at = seen.at,
    )
}

private data class DedupedFound(val merged: FoundLoyalty, val sources: List<FoundLoyalty>)

private fun dedupeFoundLoyalty(found: List<FoundLoyalty>): List<DedupedFound> {
    val out = mutableListOf<DedupedFound>()
    for (seen in found) {
        val idx = out.indexOfFirst { d ->
            sameMembership(d.merged.program, d.merged.number, seen.program, seen.number) &&
                (d.merged.person == null || seen.person == null || d.merged.person == seen.person)
        }
        if (idx < 0) out += DedupedFound(seen, listOf(seen))
        else out[idx] = DedupedFound(mergeFoundPair(out[idx].merged, seen), out[idx].sources + seen)
    }
    return out
}

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

data class ResolvedLoyalty(
    val entry: ProfileEntry,
    /** Index in `profile.loyalty`, or `-1` when the row comes only from `foundLoyalty`. */
    val savedIndex: Int,
)

private fun sameOverrideTarget(programA: String, numberA: String, programB: String, numberB: String): Boolean {
    if (!sameProgram(programA, programB)) return false
    val prefixes = verifiedPrefixes(programA) + verifiedPrefixes(programB)
    val pa = parseLoyaltyNumber(numberA, prefixes)
    val pb = parseLoyaltyNumber(numberB, prefixes)
    if (pa.masked && pb.masked) return pa.plain == pb.plain
    return sameNumber(numberA, numberB, programA, programB)
}

/**
 * Every program on a profile with its exact index in `profile.loyalty` (or `-1`
 * when it came only from `foundLoyalty`), the owner's before anyone else's.
 */
fun allLoyaltyWithSource(profile: TravelProfile, travelers: List<Person> = emptyList()): List<ResolvedLoyalty> {
    val foundList = dedupeFoundLoyalty(profile.foundLoyalty)
    // A name that is one of the owner's people is shown as theirs, and one of
    // the owner's own spellings is the owner's (allLoyalty in loyalty.ts).
    val me = guessMe(travelers)
    fun known(name: String?): String? {
        val person = name?.let { findPerson(travelers, it) }
        return if (person != null && person.id == me?.id) null else person?.name ?: name
    }
    // Precompute each imported entry's account number once so matching against found entries doesn't re-parse summaries.
    val importedAccounts = profile.loyalty.mapIndexed { savedIndex, entry -> Triple(entry, savedIndex, loyaltySummary(entry).account) }
    val matchedFound = HashSet<DedupedFound>()
    fun isUniqueMembership(program: String, number: String): Boolean {
        var count = 0
        for ((impEntry, _, impAcc) in importedAccounts) {
            if (impAcc != null && sameMembership(impEntry.title, impAcc, program, number)) count += 1
        }
        for (f in foundList) {
            if (f !in matchedFound && sameMembership(f.merged.program, f.merged.number, program, number)) count += 1
        }
        return count <= 1
    }
    // Whose it is: as the owner said, else as the email named, else theirs.
    fun withPerson(entry: ProfileEntry, number: String?, fromEmail: DedupedFound?): ProfileEntry {
        val storedPerson = entry.fields.firstOrNull { it.label == PERSON_LABEL }?.value
        val baseFields = entry.fields.filter { it.label != PERSON_LABEL }
        val targets = buildList {
            if (number != null) add(entry.title to number)
            fromEmail?.sources?.forEach { add(it.program to it.number) }
        }
        val said = (if (targets.isNotEmpty()) {
            profile.loyaltyPeople.lastOrNull { p -> targets.any { (prog, num) -> sameOverrideTarget(p.program, p.number, prog, num) } }
        } else {
            null
        }) ?: if (number != null && isUniqueMembership(entry.title, number)) {
            profile.loyaltyPeople.lastOrNull { p -> sameMembership(p.program, p.number, entry.title, number) }
        } else {
            null
        }
        val person = known(if (said != null) said.person else (fromEmail?.merged?.person ?: storedPerson))
        return if (person != null) entry.copy(fields = baseFields + ProfileField(PERSON_LABEL, person)) else entry.copy(fields = baseFields)
    }
    // Per-entry updatedAt (from a manual edit or the import that wrote this
    // entry) wins over the document-level importedAt so an unrelated later
    // upload does not age retained entries.
    fun cutoffFor(entry: ProfileEntry): String? = entry.updatedAt ?: profile.importedAt
    fun afterCutoff(at: String?, cutoff: String?) = at != null && (cutoff == null || at > cutoff)
    val imported = importedAccounts.map { (entry, savedIndex, account) ->
        val entryPerson = entry.fields.firstOrNull { it.label == PERSON_LABEL }?.value
        var statement: DedupedFound? = null
        if (account != null) {
            for (found in foundList) {
                if (sameMembership(entry.title, account, found.merged.program, found.merged.number) &&
                    (entryPerson == null || found.merged.person == null || entryPerson == found.merged.person)
                ) {
                    matchedFound.add(found)
                    if (statement == null) statement = found
                }
            }
        }
        val cutoff = cutoffFor(entry)
        val balance = statement?.merged?.balance?.takeIf { afterCutoff(statement.merged.balanceAt, cutoff) }
        val status = statement?.merged?.status?.takeIf { afterCutoff(statement.merged.statusAt, cutoff) }
        val shown = if (statement == null || (balance == null && status == null)) {
            entry
        } else {
            // Under the labels the table reads first, so the email's win.
            entry.copy(
                fields = buildList {
                    balance?.let { add(ProfileField("Balance", it)) }
                    status?.let { add(ProfileField("Elite status", it)) }
                    addAll(entry.fields)
                    if (balance != null) add(ProfileField("Balance from email", statement.merged.balanceLabel ?: statement.merged.label ?: "A statement"))
                },
            )
        }
        ResolvedLoyalty(withPerson(shown, account, statement), savedIndex)
    }
    val all = imported + foundList.filter { it !in matchedFound }.map {
        ResolvedLoyalty(withPerson(foundLoyaltyEntry(it.merged), it.merged.number, it), -1)
    }
    // The owner's first, as a booking lists them.
    val (theirs, mine) = all.partition { loyaltySummary(it.entry).person != null }
    return mine + theirs
}

/**
 * Every program on a profile, the owner's before anyone else's: what TripIt
 * imported, then what emails showed that it did not have (by number). A statement newer than the TripIt upload
 * brings its balance and status to the imported program it matches, ahead of
 * the imported ones, which the table reads first.
 */
fun allLoyalty(profile: TravelProfile, travelers: List<Person> = emptyList()): List<ProfileEntry> =
    allLoyaltyWithSource(profile, travelers).map { it.entry }

/**
 * The owner's word on whose a membership is, replacing any earlier word on
 * it; [person] null says it is theirs. The oldest word goes when the list is full.
 */
fun withLoyaltyPerson(people: List<LoyaltyPerson>, program: String, number: String, person: String?): List<LoyaltyPerson> {
    val name = person?.trim()?.takeIf { it.isNotEmpty() }
    return (people.filterNot { sameOverrideTarget(it.program, it.number, program, number) } + LoyaltyPerson(program, number, name)).takeLast(MAX_LOYALTY_PEOPLE)
}

/** The programs grouped by whose they are: the owner's first (person null), then each other person's, by name. */
data class LoyaltyGroup(val person: String?, val entries: List<ProfileEntry>)

fun loyaltyByPerson(entries: List<ProfileEntry>): List<LoyaltyGroup> =
    entries.groupBy { loyaltySummary(it).person }
        .entries
        .sortedWith(compareBy<Map.Entry<String?, List<ProfileEntry>>> { it.key != null }.thenBy { it.key.orEmpty() })
        .map { LoyaltyGroup(it.key, it.value) }

/** The email-extracted membership behind a unified loyalty entry, when one exists, so the UI can remove it in place. */
fun findFoundLoyalty(found: List<FoundLoyalty>, entry: ProfileEntry): FoundLoyalty? {
    val summary = loyaltySummary(entry)
    val account = summary.account ?: return null
    val matches = found.filter { sameMembership(it.program, it.number, entry.title, account) }
    if (matches.size <= 1) return matches.firstOrNull()
    return matches.firstOrNull { if (summary.person != null) it.person == summary.person else it.person == null }
        ?: matches.firstOrNull { it.person == null || summary.person == null || it.person == summary.person }
        ?: matches.firstOrNull()
}

// One membership: the same number in the same program.
fun sameMembership(programA: String, numberA: String, programB: String, numberB: String): Boolean =
    sameProgram(programA, programB) && sameNumber(numberA, numberB, programA, programB)

// One program by its canonical airline alias, exact name, or a distinctive word
// in common. A name with no distinctive word ("Privilege Club") could be any
// program's.
private fun sameProgram(a: String, b: String): Boolean {
    val ca = canonicalProgram(a)
    val cb = canonicalProgram(b)
    if (ca != null && cb != null) return ca == cb
    val x = nameWords(a)
    val y = nameWords(b)
    return a.trim().equals(b.trim(), ignoreCase = true) || x.isEmpty() || y.isEmpty() || x.any { it in y }
}
