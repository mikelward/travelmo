package app.travelmo.core

/*
 * Linked email addresses (SPEC "Linked email addresses"), as
 * packages/core/src/emails.ts has them: every address a user confirmed
 * counts as them wherever Travelmo knows people by email.
 */

/** How many addresses an account may link besides its sign-in, pending ones included. */
const val MAX_LINKED_EMAILS = 10

/** Firestore's limit on the values of one `array-contains-any` query. */
const val MAX_QUERY_EMAILS = 30

const val ADD_EMAIL_PATH = "/emails/add"
const val REMOVE_EMAIL_PATH = "/emails/remove"

private val addressPattern = Regex("^[^\\s@/]+@[^\\s@/]+\\.[^\\s@/]+$")

/** One address, trimmed and lowercased as sharing and the rules compare it; null for anything else (packages/core's `normalizeEmail`). */
fun emailAddressOf(value: String?): String? = value?.trim()?.lowercase()?.takeIf { addressPattern.matches(it) }

/** A link waiting for its confirmation (`users/{uid}.pendingEmails`). */
data class PendingEmail(val email: String, val sentAt: String, val expiresAt: String)

/**
 * What `users/{uid}` says about the account's addresses: those it confirmed
 * (`emails`, server-written), the Gmail mailboxes it connected ([gmails],
 * oldest first), which count while connected, and those waiting for
 * confirmation. [gmail] is one connected before there could be several.
 */
data class AddressHolder(
    val emails: List<String> = emptyList(),
    val gmail: String? = null,
    val pendingEmails: List<PendingEmail> = emptyList(),
    val gmails: List<String> = emptyList(),
)

private fun mailboxAddresses(user: AddressHolder?): List<String?> = (user?.gmails.orEmpty() + listOfNotNull(user?.gmail)).map(::emailAddressOf)

/** The addresses the account confirmed besides its sign-in: those it linked, then its connected Gmail mailboxes. */
fun linkedEmails(user: AddressHolder?): List<String> =
    (user?.emails.orEmpty().map(::emailAddressOf) + mailboxAddresses(user)).filterNotNull().distinct()

/** Every address that is the account's, its verified sign-in first. */
fun myAddresses(signIn: String?, user: AddressHolder?): List<String> = (listOf(emailAddressOf(signIn)) + linkedEmails(user)).filterNotNull().distinct()

/** The addresses asked about in one query; the link limit keeps the list within it. */
fun queryAddresses(addresses: List<String>): List<String> = addresses.take(MAX_QUERY_EMAILS)

fun isMine(email: String?, addresses: List<String>): Boolean = emailAddressOf(email)?.let { it in addresses } ?: false

/** Whether a trip's `sharedWith` or a profile's `trustedEmails` names the account by any of its addresses. */
fun sharedWithAny(list: List<String>, addresses: List<String>): Boolean = list.any { isMine(it, addresses) }

enum class EmailRowKind { SIGN_IN, GMAIL, CONFIRMED, PENDING }

data class EmailRow(val email: String, val kind: EmailRowKind) {
    /** Confirmed and pending addresses can be removed; the sign-in and the connected Gmail cannot. */
    val removable: Boolean get() = kind == EmailRowKind.CONFIRMED || kind == EmailRowKind.PENDING
}

private fun live(pending: List<PendingEmail>?, now: String) = pending.orEmpty().filter { it.expiresAt > now }

/** Settings' "Email addresses": the sign-in, those confirmed, the connected Gmail mailboxes (unless confirmed too), then live pending ones. */
fun emailRows(signIn: String?, user: AddressHolder?, now: String): List<EmailRow> {
    val rows = LinkedHashMap<String, EmailRow>()
    fun add(email: String?, kind: EmailRowKind) {
        if (email != null && email !in rows) rows[email] = EmailRow(email, kind)
    }
    add(emailAddressOf(signIn), EmailRowKind.SIGN_IN)
    user?.emails.orEmpty().forEach { add(emailAddressOf(it), EmailRowKind.CONFIRMED) }
    mailboxAddresses(user).forEach { add(it, EmailRowKind.GMAIL) }
    live(user?.pendingEmails, now).forEach { add(emailAddressOf(it.email), EmailRowKind.PENDING) }
    return rows.values.toList()
}

/** Why an address cannot be linked, by the parser's name for it. */
enum class LinkRefusal(val wire: String, val text: String) {
    INVALID("invalid", "Enter one email address."),
    YOURS("yours", "That address is already yours."),
    FULL("full", "You can add up to $MAX_LINKED_EMAILS addresses."),
    LIMIT("limit", "Too many confirmation emails today. Try again tomorrow."),
    TAKEN("taken", "That address belongs to another Travelmo account."),
    EXPIRED("expired", "This link has expired or is for another account. Add the address again."),
    NOT_INVITED("notInvited", "That address hasn't been invited to Travelmo."),
    ;

    companion object {
        fun fromWire(value: String?): LinkRefusal? = entries.firstOrNull { it.wire == value }
    }
}

/** The address to link, normalized, or why not; asking again for a pending one sends a fresh link. */
sealed interface LinkCheck {
    data class Ok(val email: String) : LinkCheck

    data class Refused(val refusal: LinkRefusal) : LinkCheck
}

fun checkNewLink(raw: String, signIn: String?, user: AddressHolder?, now: String): LinkCheck {
    val email = emailAddressOf(raw) ?: return LinkCheck.Refused(LinkRefusal.INVALID)
    if (email in myAddresses(signIn, user)) return LinkCheck.Refused(LinkRefusal.YOURS)
    val pending = live(user?.pendingEmails, now).filter { it.email != email }
    if (user?.emails.orEmpty().size + pending.size >= MAX_LINKED_EMAILS) return LinkCheck.Refused(LinkRefusal.FULL)
    return LinkCheck.Ok(email)
}

private val refusalField = Regex("\"refusal\"\\s*:\\s*\"([a-zA-Z]+)\"")

/** The parser's refusal (`{"refusal":"taken"}`); null for anything else. */
fun refusalOf(body: String): LinkRefusal? = LinkRefusal.fromWire(refusalField.find(body)?.groupValues?.get(1))
