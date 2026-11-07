package app.travelmo.core

import java.text.NumberFormat
import java.util.Locale

// A loyalty program at a glance, as packages/core/src/loyalty.ts: the
// account number, the balance and the status, read by their usual labels,
// and the program a booking's provider belongs to.

data class LoyaltySummary(val title: String, val account: String? = null, val balance: String? = null, val status: String? = null, val nextStatus: String? = null)

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
    if (Regex("""^\d{1,15}$""").matches(value)) NumberFormat.getIntegerInstance(Locale.US).format(value.toLong()) else value

fun loyaltySummary(entry: ProfileEntry): LoyaltySummary = LoyaltySummary(
    title = entry.title,
    account = field(entry, accountLabels),
    balance = field(entry, balanceLabels)?.let(::formatBalance),
    status = field(entry, statusLabels),
    nextStatus = field(entry, nextStatusLabels),
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

/** One line for a booking: the program, the number and the status. */
fun loyaltyLine(entry: ProfileEntry): String {
    val s = loyaltySummary(entry)
    return listOfNotNull(s.title, s.account, s.status).joinToString(" · ")
}
