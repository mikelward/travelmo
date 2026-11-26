package app.travelmo.core

// Text as its words, for matching words rather than letters anywhere, as packages/core's words.ts: a
// reference 1234 is not in "Room 12345", nor Rome in "Romeo Hotel". Case and accents set aside;
// anything not a letter or digit separates words.
private val wordMarks = Regex("\\p{M}+")
private val wordBreaks = Regex("[^\\p{L}\\p{N}]+")

private val padding = Regex("(^|\\p{L})0+(?=\\p{N})")

/** Text as its words, as words.ts: case, accents and a number's leading zeros set aside ("Gate 01" is "Gate 1"). */
fun wordsOf(text: String): List<String> =
    decomposed(text).replace(wordMarks, "").lowercase().split(wordBreaks).filter { it.isNotEmpty() }.map(::unpadded)

/** A text's numbers without their leading zeros where a number starts it or follows a letter ("AB0123" is "AB123"); a lone zero stays. */
fun unpadded(text: String): String = text.replace(padding, "$1")

/** Whether [text] says [phrase] as whole words, in order and together. */
fun hasWords(text: String, phrase: String): Boolean {
    val words = wordsOf(text)
    val wanted = wordsOf(phrase)
    if (wanted.isEmpty()) return false
    return (0..words.size - wanted.size).any { i -> wanted.indices.all { j -> words[i + j] == wanted[j] } }
}

/** Whether each word of [query] starts a word of [text], as a search box finds as you type: "par" finds Paris, "ba" not Cuba. */
fun hasWordStarts(text: String, query: String): Boolean {
    val words = wordsOf(text)
    return wordsOf(query).all { q -> words.any { it.startsWith(q) } }
}
