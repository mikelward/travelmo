package app.travelmo.core

/*
 * Several Gmail mailboxes per account, as packages/core/src/gmail.ts has
 * them: each connected mailbox, and which one an imported email came from.
 */

/** How many mailboxes one account may connect. */
const val MAX_GMAIL_MAILBOXES = 5

/**
 * A connected mailbox as the user document shows it. [idPrefix] is what its
 * emails' import records and sources carry ahead of Gmail's message id:
 * empty for the account's first, as for one connected before there could
 * be several.
 */
data class GmailMailbox(val emailAddress: String, val connectedAt: String, val idPrefix: String = "")

/** The mailboxes, oldest connection first; [legacy] is one connected before there could be several, until the parser moves it. */
fun gmailMailboxes(mailboxes: List<GmailMailbox>, legacy: GmailMailbox? = null): List<GmailMailbox> {
    val all = if (legacy != null && mailboxes.none { it.emailAddress.equals(legacy.emailAddress, ignoreCase = true) }) mailboxes + legacy else mailboxes
    return all.sortedWith(compareBy({ it.connectedAt }, { it.emailAddress }))
}

/** The mailbox (by key; none for the first) and Gmail's own id of an email source or import record. */
data class GmailSourceId(val key: String?, val messageId: String)

private val prefixed = Regex("^gmail-([0-9a-z]+)-(.+)$")

fun parseGmailSourceId(sourceId: String): GmailSourceId =
    prefixed.find(sourceId)?.let { GmailSourceId(it.groupValues[1], it.groupValues[2]) } ?: GmailSourceId(null, sourceId)

/** The connected mailbox an email source came from, if it is still connected. */
fun sourceMailbox(sourceId: String, mailboxes: List<GmailMailbox>): GmailMailbox? {
    val key = parseGmailSourceId(sourceId).key ?: return mailboxes.firstOrNull { it.idPrefix.isEmpty() }
    return mailboxes.firstOrNull { it.idPrefix == "gmail-$key-" }
}

/** Opens an imported email in the mailbox it came from; once that is disconnected, in the phone's default account. */
fun gmailSourceLink(sourceId: String, mailboxes: List<GmailMailbox>): String =
    gmailMessageUrl(parseGmailSourceId(sourceId).messageId, sourceMailbox(sourceId, mailboxes)?.emailAddress)
