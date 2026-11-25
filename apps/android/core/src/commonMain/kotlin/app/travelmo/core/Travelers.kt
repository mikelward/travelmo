package app.travelmo.core

// Travelers: who a booking is for (SPEC "Travelers"); travelers.ts is the
// reference. Emails write a passenger's name every way there is
// ("SMITH/JOHN MR", "Smith, John", "MRS JANE DOE"): these put one in the form
// people write it in and tell whether two are one person's.

/** Words that say how to address someone, not who they are; passenger-type codes too. */
private val titles = setOf("mr", "mrs", "ms", "miss", "mstr", "master", "mx", "dr", "prof", "sir", "dame", "madam", "rev", "chd", "inf", "adt")

/** Titles an airline's record glues onto the given name ("SMITH/JOHNMR"). */
private val glued = Regex("(MRS|MR|MSTR|MISS)$")

/** Titles a record may glue on, "MS" among them: a name with one matches the same name without (gluedTitle in travelers.ts). */
private val gluedTitles = listOf("mrs", "mr", "mstr", "miss", "ms")

private fun gluedTitle(a: String, b: String) = gluedTitles.any { a == b + it || b == a + it }

/** Whether [name] is the better spelling of [kept]: a whole first name over an initial, none glued on over one. */
private fun fuller(name: String, kept: String): Boolean {
    val a = name.substringBefore(' ').lowercase()
    val b = kept.substringBefore(' ').lowercase()
    return if (gluedTitle(a, b)) a.length < b.length else a.length > b.length
}

/** The most travelers a booking keeps, as the stored schema allows. */
const val MAX_TRAVELERS = 20

private fun isTitle(word: String) = word.lowercase().replace(".", "") in titles

/** "JOHN" as "John", each part of "o'neil-smith" capitalised. */
private fun titleCase(word: String): String {
    val lower = word.lowercase()
    val out = StringBuilder()
    for ((i, c) in lower.withIndex()) out.append(if (i == 0 || lower[i - 1] in "-'’") c.uppercaseChar() else c)
    return out.toString()
}

/**
 * A passenger's name as people write it, or null when it holds no name:
 * "SMITH/JOHN MR", "Smith, John" and "Mr John Smith" are all "John Smith". A
 * name written in mixed case keeps its case.
 */
fun canonicalName(raw: String): String? {
    val text = raw.trim().split(Regex("\\s+")).joinToString(" ")
    if (text.none { it.isLetter() }) return null
    val slash = text.indexOf('/')
    val comma = text.indexOf(',')
    val (given, family) = when {
        slash > 0 -> {
            val words = text.substring(slash + 1).trim().split(" ").toMutableList()
            val last = words.last()
            val stripped = last.replace(glued, "")
            if (last == last.uppercase() && stripped != last && stripped.length >= 2) words[words.lastIndex] = stripped
            words.joinToString(" ") to text.substring(0, slash).trim()
        }
        comma > 0 -> text.substring(comma + 1).trim() to text.substring(0, comma).trim()
        else -> text to ""
    }
    val whole = listOf(given, family).joinToString(" ")
    val words = whole.split(" ").filter { it.isNotEmpty() && !isTitle(it) }
    if (words.isEmpty()) return null
    val oneCase = whole == whole.uppercase() || whole == whole.lowercase()
    return words.joinToString(" ") { if (oneCase) titleCase(it) else it }
}

/** Latin letters with accents and the letters they are compared as: travelers.ts's table. */
private const val ACCENTED = "àáâãäåāăąạảấầẩẫậắằẳẵặçćčďđèéêëēėęěẹẻẽếềểễệìíîïīįỉịñńňòóôõöøōőơọỏốồổỗộớờởỡợŕřśšşťùúûüūůűųưụủứừửữựýÿỳỵỷỹźżž"
private const val PLAIN = "aaaaaaaaaaaaaaaaaaaaacccddeeeeeeeeeeeeeeeeiiiiiiiinnnooooooooooooooooooooorrssstuuuuuuuuuuuuuuuuyyyyyyzzz"

/** A name's words as compared: lowercase, accents and punctuation gone. */
private fun travelerWords(name: String): List<String> {
    val folded = name.lowercase().map { c -> ACCENTED.indexOf(c).let { if (it >= 0) PLAIN[it] else c } }
    return folded.joinToString("") { c -> if (c.isLetter() || c == ' ' || c == '-') c.toString() else "" }
        .split(' ', '-').filter { it.isNotEmpty() }
}

/**
 * Whether two names are one person's: the same words, or the same first and
 * last (a middle name or not), or the same last with one first an initial of
 * the other ("J Smith" is "John Smith").
 */
fun sameTraveler(a: String, b: String): Boolean {
    val x = travelerWords(canonicalName(a) ?: a)
    val y = travelerWords(canonicalName(b) ?: b)
    if (x.isEmpty() || y.isEmpty()) return false
    if (x == y) return true
    if (x.size < 2 || y.size < 2 || x.last() != y.last()) return false
    val (fx, fy) = x.first() to y.first()
    return fx == fy || gluedTitle(fx, fy) || (fx.length == 1 && fy.startsWith(fx)) || (fy.length == 1 && fx.startsWith(fy))
}

/** A booking's travelers as filed: each name once, in order, at most [MAX_TRAVELERS]; null when none is a name. */
fun canonicalTravelers(raw: List<String>): List<String>? {
    val names = mutableListOf<String>()
    for (each in raw) {
        if (names.size == MAX_TRAVELERS) break
        val name = canonicalName(each) ?: continue
        // One name for each person, the fuller spelling kept: "John Smith" takes "J Smith"'s place.
        val i = names.indexOfFirst { sameTraveler(it, name) }
        if (i < 0) names += name
        else if (fuller(name, names[i])) names[i] = name
    }
    return names.ifEmpty { null }
}

/** The person a name is, among those known, by their name or any other spelling; the user first when it could be either. */
fun findPerson(people: List<Person>, raw: String): Person? {
    val name = canonicalName(raw) ?: return null
    val matches = people.filter { p -> (listOf(p.name) + p.aliases).any { sameTraveler(it, name) } }
    return matches.firstOrNull { it.me } ?: matches.firstOrNull()
}

/**
 * Someone the user's bookings name (PersonDoc in packages/core): how many
 * bookings named them, how many of those came in emails sent straight to the
 * user, and whether the user said this is them.
 */
data class Person(
    val id: String,
    val name: String,
    val aliases: List<String> = emptyList(),
    val me: Boolean = false,
    val bookings: Int = 0,
    val direct: Int = 0,
)
