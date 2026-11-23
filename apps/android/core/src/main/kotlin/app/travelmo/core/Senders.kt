package app.travelmo.core

// The user's sender rules (users/{uid}/settings/patterns), as
// packages/core's senders.ts reads and teaches them.

/** Which list a sender is on: always import, or never. */
enum class SenderList { ALLOW, DENY }

data class SenderPatterns(val allow: List<String> = emptyList(), val deny: List<String> = emptyList()) {
    fun list(which: SenderList) = if (which == SenderList.ALLOW) allow else deny
}

private val fromAddress = Regex("""<?[^\s<>@]+@([^\s<>]+?)>?\s*$""")

/** The domain out of a From header, or a bare domain; null without a dot. */
fun domainOf(from: String): String? {
    val trimmed = from.trim().lowercase()
    val domain = fromAddress.find(trimmed)?.groupValues?.get(1) ?: if ('@' in trimmed) null else trimmed
    return domain?.takeIf { '.' in it }
}

/** The parser's rule: a pattern covers its own domain and every subdomain. */
fun covers(pattern: String, domain: String): Boolean = domain == pattern || domain.endsWith(".$pattern")

fun isListed(patterns: SenderPatterns?, domain: String, which: SenderList): Boolean =
    patterns?.list(which)?.any { covers(it, domain) } ?: false

/** What the parser does with mail from this domain: denials win, as in prefilter.ts. */
fun effectiveDecision(patterns: SenderPatterns?, domain: String): SenderList? = when {
    isListed(patterns, domain, SenderList.DENY) -> SenderList.DENY
    isListed(patterns, domain, SenderList.ALLOW) -> SenderList.ALLOW
    else -> null
}

/** The rules with [domain] added to one list and every pattern covering it taken off the other. */
fun withLearned(current: SenderPatterns, domain: String, which: SenderList): SenderPatterns {
    val added = (current.list(which) + domain).distinct()
    val other = (if (which == SenderList.ALLOW) current.deny else current.allow).filterNot { covers(it, domain) }
    return if (which == SenderList.ALLOW) SenderPatterns(allow = added, deny = other) else SenderPatterns(allow = other, deny = added)
}
