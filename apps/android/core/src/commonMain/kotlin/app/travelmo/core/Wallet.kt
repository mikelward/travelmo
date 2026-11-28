package app.travelmo.core

enum class DocumentInputType(val label: String) {
    PASSPORT("Passport"),
    VISA("Visa"),
    SHARE_CODE("UK share code"),
    KTN("Known Traveler Number"),
    ID("National ID"),
    INSURANCE("Travel insurance"),
    OTHER("Other"),
}

data class DocumentInput(
    val type: DocumentInputType,
    val title: String,
    val country: String? = null,
    val number: String? = null,
    val expires: String? = null,
    val issued: String? = null,
    val notes: String? = null,
)

data class LoyaltyInput(
    val program: String,
    val number: String? = null,
    val status: String? = null,
    val balance: String? = null,
    val person: String? = null,
)

data class UpcomingFlight(
    val tripId: String,
    val tripTitle: String,
    val segment: Segment,
    val departureMs: Long,
)

fun defaultDocumentTitle(type: DocumentInputType, country: String? = null): String {
    val c = country?.trim().orEmpty()
    return if (c.isNotEmpty()) "$c ${type.label}" else type.label
}

private fun lastPart(label: String): String = label.substringAfterLast('›').trim().lowercase()

private fun findField(entry: ProfileEntry, test: (String) -> Boolean): String? =
    entry.fields.firstOrNull { test(lastPart(it.label)) && it.value.isNotBlank() }?.value?.trim()

private val docTypeLabelRe = Regex("""^(document )?type$""")
private val passportRe = Regex("""\b(e-?)?passports?\b""")
private val shareCodeRe = Regex("""\bshare\s*codes?\b""")
private val visaRe = Regex("""\b(e-?)?visas?\b""")
private val ktnRe = Regex("""\b(known traveler|ktn|global entry|tsa pre|nexus|sentri)\b""")
private val idRe = Regex("""\b(national id|id card|identity|driver'?s? licen[cs]e)\b""")
private val insuranceRe = Regex("""\binsurance\b""")
private val nationalityRe = Regex("""\b(nationality|citizenship)\b""")
private val countryRe = Regex("""\bcountry\b""")
private val birthRe = Regex("""\bbirth""")
private val numberRe = Regex("""\b(number|no\.?|id)\b""")
private val typeWordRe = Regex("""\btype\b""")
private val expiryRe = Regex("""expir|valid (until|to|through)|valid thru""")
private val issueRe = Regex("""issue""")
private val notesRe = Regex("""\bnotes?\b""")
private val accountOrNumberRe = Regex("""\b(number|no\.?|account)\b""")
private val spacesRe = Regex("""\s+""")

private fun isNationalityLabel(l: String): Boolean = nationalityRe.containsMatchIn(l)
private fun isCountryLabel(l: String): Boolean = countryRe.containsMatchIn(l) && !birthRe.containsMatchIn(l) && !isNationalityLabel(l)
private fun isNumberLabel(l: String): Boolean = numberRe.containsMatchIn(l) && !typeWordRe.containsMatchIn(l)

private val managedLoyaltyLabels = setOf(
    "account number",
    "membership number",
    "member number",
    "account no",
    "membership no",
    "account",
    "number",
    "balance",
    "points balance",
    "miles balance",
    "point balance",
    "points",
    "miles",
    "elite status",
    "status",
    "tier",
    "level",
    "elite level",
)

private fun isManagedDocField(label: String, type: DocumentInputType): Boolean {
    val l = lastPart(label)
    return docTypeLabelRe.matches(l) ||
        isCountryLabel(l) ||
        (type == DocumentInputType.PASSPORT && isNationalityLabel(l)) ||
        isNumberLabel(l) ||
        expiryRe.containsMatchIn(l) ||
        issueRe.containsMatchIn(l) ||
        notesRe.containsMatchIn(l)
}

private fun isManagedLoyaltyField(label: String): Boolean {
    if (label == PERSON_LABEL) return true
    if ('›' in label) return false
    return lastPart(label) in managedLoyaltyLabels
}

fun buildDocumentEntry(input: DocumentInput, existing: ProfileEntry? = null): ProfileEntry {
    val country = input.country?.trim()?.ifEmpty { null }
    val title = input.title.trim().ifEmpty { defaultDocumentTitle(input.type, country) }
    val fields = mutableListOf(ProfileField("Document type", input.type.label))
    if (country != null) {
        fields += ProfileField(if (input.type == DocumentInputType.PASSPORT) "Nationality" else "Country", country)
    }
    input.number?.trim()?.ifEmpty { null }?.let { fields += ProfileField("Number", it) }
    input.expires?.trim()?.ifEmpty { null }?.let { fields += ProfileField("Expiration date", it) }
    input.issued?.trim()?.ifEmpty { null }?.let { fields += ProfileField("Issue date", it) }
    input.notes?.trim()?.ifEmpty { null }?.let { fields += ProfileField("Notes", it) }
    existing?.fields?.forEach { f ->
        if (!isManagedDocField(f.label, input.type)) fields += f
    }
    return ProfileEntry(title, fields, manual = true)
}

fun parseDocumentEntry(entry: ProfileEntry): DocumentInput {
    val explicitTypes = entry.fields.filter { docTypeLabelRe.matches(lastPart(it.label)) && it.value.isNotBlank() }.map { it.value }
    val typeText = (if (explicitTypes.isNotEmpty()) explicitTypes.joinToString(" ") else entry.title).lowercase()

    val type = when {
        passportRe.containsMatchIn(typeText) -> DocumentInputType.PASSPORT
        shareCodeRe.containsMatchIn(typeText) -> DocumentInputType.SHARE_CODE
        visaRe.containsMatchIn(typeText) -> DocumentInputType.VISA
        ktnRe.containsMatchIn(typeText) -> DocumentInputType.KTN
        idRe.containsMatchIn(typeText) -> DocumentInputType.ID
        insuranceRe.containsMatchIn(typeText) -> DocumentInputType.INSURANCE
        else -> DocumentInputType.OTHER
    }

    // Prefer nationality only for passports; visas and other documents use their admission/issuing country.
    val country = if (type == DocumentInputType.PASSPORT) {
        findField(entry, ::isNationalityLabel) ?: findField(entry, ::isCountryLabel)
    } else {
        findField(entry, ::isCountryLabel)
    }
    val number = findField(entry, ::isNumberLabel)
    val expires = findField(entry) { expiryRe.containsMatchIn(it) }?.let { parseDocumentDate(it) ?: it }
    val issued = findField(entry) { issueRe.containsMatchIn(it) }?.let { parseDocumentDate(it) ?: it }
    val notes = findField(entry) { notesRe.containsMatchIn(it) }

    return DocumentInput(
        type = type,
        title = entry.title,
        country = country,
        number = number,
        expires = expires,
        issued = issued,
        notes = notes,
    )
}

private val loyaltyAccountLabels = listOf("account number", "membership number", "member number", "account no", "membership no", "account", "number")
private val loyaltyBalanceLabels = listOf("balance", "points balance", "miles balance", "point balance", "points", "miles")
private val loyaltyStatusLabels = listOf("elite status", "status", "tier", "level", "elite level")

private fun sourceFieldIndex(fields: List<ProfileField>, wanted: List<String>): Int {
    for (nested in listOf(false, true)) {
        for (want in wanted) {
            val idx = fields.indexOfFirst { ('›' in it.label) == nested && lastPart(it.label) == want && it.value.isNotBlank() }
            if (idx >= 0) return idx
        }
    }
    return -1
}

fun buildLoyaltyEntry(input: LoyaltyInput, existing: ProfileEntry? = null, updatedAt: String? = null): ProfileEntry {
    val fields = mutableListOf<ProfileField>()
    input.number?.trim()?.ifEmpty { null }?.let { fields += ProfileField("Account number", it) }
    input.status?.trim()?.ifEmpty { null }?.let { fields += ProfileField("Status", it) }
    input.balance?.trim()?.ifEmpty { null }?.let { fields += ProfileField("Balance", it) }
    input.person?.trim()?.ifEmpty { null }?.let { fields += ProfileField(PERSON_LABEL, it) }
    existing?.let { prev ->
        val sourcedIndices = setOf(
            sourceFieldIndex(prev.fields, loyaltyAccountLabels),
            sourceFieldIndex(prev.fields, loyaltyBalanceLabels),
            sourceFieldIndex(prev.fields, loyaltyStatusLabels),
        )
        prev.fields.forEachIndexed { idx, f ->
            if (!isManagedLoyaltyField(f.label) && idx !in sourcedIndices) fields += f
        }
    }
    return ProfileEntry(input.program.trim(), fields, updatedAt ?: existing?.updatedAt, manual = true)
}

fun parseLoyaltyEntry(entry: ProfileEntry): LoyaltyInput {
    val s = loyaltySummary(entry)
    return LoyaltyInput(
        program = s.title,
        number = s.account,
        status = s.status,
        balance = s.balance,
        person = s.person,
    )
}

private fun norm(s: String): String = s.trim().lowercase().replace(spacesRe, " ")

private fun numberKey(entry: ProfileEntry): String? {
    val num = findField(entry) { accountOrNumberRe.containsMatchIn(it) }
    return num?.let { "${norm(entry.title)}|${norm(it)}" }
}

private fun exactKey(entry: ProfileEntry): String {
    val fields = entry.fields.map { "${norm(it.label)}=${norm(it.value)}" }.sorted().joinToString("\u0000")
    return "${norm(entry.title)}\u0000$fields"
}

fun mergeProfileEntries(existing: List<ProfileEntry>, imported: List<ProfileEntry>): List<ProfileEntry> {
    val out = existing.toMutableList()
    val indexByNum = mutableMapOf<String, Int>()
    val indexByExact = mutableMapOf<String, Int>()
    out.forEachIndexed { i, e ->
        numberKey(e)?.let { nk -> if (nk !in indexByNum) indexByNum[nk] = i }
        val ek = exactKey(e)
        if (ek !in indexByExact) indexByExact[ek] = i
    }
    for (e in imported) {
        val nk = numberKey(e)
        if (nk != null) {
            val idx = indexByNum[nk]
            if (idx != null) {
                if (!out[idx].manual) out[idx] = e
            } else {
                indexByNum[nk] = out.size
                out += e
            }
        } else {
            val ek = exactKey(e)
            val idx = indexByExact[ek]
            if (idx != null) {
                if (!out[idx].manual) out[idx] = e
            } else {
                indexByExact[ek] = out.size
                out += e
            }
        }
    }
    return out
}

private const val WALLET_HOUR_MS = 60L * 60L * 1000L

fun upcomingBoardingFlights(
    trips: List<Trip>,
    segmentsByTrip: Map<String, List<Segment>>,
    nowMs: Long,
    windowHours: Int = 48,
): List<UpcomingFlight> {
    val minMs = nowMs - 3L * WALLET_HOUR_MS
    val maxMs = nowMs + windowHours.toLong() * WALLET_HOUR_MS
    val out = mutableListOf<UpcomingFlight>()
    for (trip in trips) {
        if (trip.cancelledAt != null) continue
        val segments = segmentsByTrip[trip.id].orEmpty()
        for (segment in segments) {
            if (segment.type != SegmentType.FLIGHT || segment.isCancelled) continue
            val departureMs = runCatching { instantMillis(segment.start) }.getOrNull() ?: continue
            if (departureMs in minMs..maxMs) {
                out += UpcomingFlight(trip.id, trip.title, segment, departureMs)
            }
        }
    }
    return out.sortedBy { it.departureMs }
}
