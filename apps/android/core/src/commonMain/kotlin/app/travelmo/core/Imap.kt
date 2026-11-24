package app.travelmo.core

/*
 * Mailboxes connected over IMAP with an app password, as
 * packages/core/src/imap.ts has them: which server an address is read
 * from, and each connected mailbox.
 */

/** How many IMAP mailboxes one account may connect. */
const val MAX_IMAP_MAILBOXES = 5

/** Implicit TLS, the only kind the parser connects with. */
const val IMAP_TLS_PORT = 993

/** A provider whose server Travelmo fills in; [appPasswordUrl] is where it explains making an app password. */
data class ImapProvider(val name: String, val host: String, val port: Int = IMAP_TLS_PORT, val appPasswordUrl: String? = null)

val ICLOUD_IMAP = ImapProvider("iCloud", "imap.mail.me.com", appPasswordUrl = "https://support.apple.com/en-us/102654")
val YAHOO_IMAP = ImapProvider("Yahoo", "imap.mail.yahoo.com", appPasswordUrl = "https://help.yahoo.com/kb/SLN15241.html")
val INFOMANIAK_IMAP = ImapProvider("Infomaniak", "mail.infomaniak.com")

private val knownDomains = mapOf(
    "icloud.com" to ICLOUD_IMAP,
    "me.com" to ICLOUD_IMAP,
    "mac.com" to ICLOUD_IMAP,
    "ymail.com" to YAHOO_IMAP,
    "rocketmail.com" to YAHOO_IMAP,
    "ik.me" to INFOMANIAK_IMAP,
    "ikmail.com" to INFOMANIAK_IMAP,
    "etik.com" to INFOMANIAK_IMAP,
)
private val gmailDomains = setOf("gmail.com", "googlemail.com")
private val fastmailDomains = setOf(
    "fastmail.com", "fastmail.fm", "fastmail.net", "fastmail.org", "fastmail.us", "fastmail.to", "fastmail.in", "fastmail.cn", "sent.com", "messagingengine.com",
)
private val yahooDomain = Regex("^yahoo\\.[a-z.]+$")

/** Which server an address is read from, by its domain. */
sealed interface ImapServerChoice {
    data class Known(val provider: ImapProvider) : ImapServerChoice
    /** Use the Gmail section instead. */
    data object Gmail : ImapServerChoice
    /** Use the Fastmail section instead. */
    data object Fastmail : ImapServerChoice
    /** The user names the server. */
    data object Other : ImapServerChoice
}

fun imapServerFor(address: String): ImapServerChoice {
    val at = address.lastIndexOf('@')
    val domain = if (at < 0) "" else address.substring(at + 1).trim().lowercase()
    if (domain in gmailDomains) return ImapServerChoice.Gmail
    if (domain in fastmailDomains) return ImapServerChoice.Fastmail
    val known = knownDomains[domain] ?: YAHOO_IMAP.takeIf { yahooDomain.matches(domain) }
    return known?.let { ImapServerChoice.Known(it) } ?: ImapServerChoice.Other
}

/** What Settings says instead of connecting an address another section reads; null when IMAP is the way. */
fun imapRedirect(address: String): String? = when (imapServerFor(address)) {
    ImapServerChoice.Gmail -> "For a Gmail address, use Connect Gmail above."
    ImapServerChoice.Fastmail -> "For a Fastmail address, use the Fastmail section above."
    else -> null
}

/** A mailbox connected over IMAP as the user document shows it. [loginFailedAt]: the server last refused its app password then. */
data class ImapMailbox(
    val emailAddress: String,
    val connectedAt: String,
    val backfill: BackfillShown? = null,
    val loginFailedAt: String? = null,
)

/** The mailboxes, oldest connection first. */
fun imapMailboxes(mailboxes: List<ImapMailbox>): List<ImapMailbox> =
    mailboxes.sortedWith(compareBy({ it.connectedAt }, { it.emailAddress.lowercase() }))

/** Import record and source ids of IMAP emails: the mailbox's key, the inbox's UIDVALIDITY and the message's UID. */
data class ImapRecordId(val key: String, val uidValidity: String, val uid: Long)

private val imapRecord = Regex("^imap-([0-9a-z]+)-(\\d+)-(\\d+)$")

fun parseImapRecordId(id: String): ImapRecordId? {
    val match = imapRecord.find(id) ?: return null
    val uid = match.groupValues[3].toLongOrNull()?.takeIf { it > 0 } ?: return null
    return ImapRecordId(match.groupValues[1], match.groupValues[2], uid)
}

/** An IMAP server as typed, `host` or `host:port`, the port 993 by default. */
data class ImapServer(val host: String, val port: Int)

private val serverPattern = Regex("^([a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+)(:(\\d{1,5}))?$")

/** Null when [input] does not read as a server. */
fun parseImapServer(input: String): ImapServer? {
    val text = input.trim().lowercase().removePrefix("imaps://").removePrefix("imap://")
    val match = serverPattern.find(text) ?: return null
    val port = match.groupValues[6].takeIf { it.isNotEmpty() }?.toInt() ?: IMAP_TLS_PORT
    return if (port in 1..65535) ImapServer(match.groupValues[1], port) else null
}
