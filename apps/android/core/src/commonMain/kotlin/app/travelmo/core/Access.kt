package app.travelmo.core

/**
 * Where an account stands (SPEC "Access"), as packages/core/src/access.ts's
 * `AccountAccess` names it: [NONE] is not let in yet (Travelmo is
 * invite-only).
 */
enum class AccountAccess(val wire: String) {
    APPROVED("approved"),
    DECLINED("declined"),
    NONE("none"),
    ;

    companion object {
        fun fromWire(value: String?): AccountAccess? = entries.firstOrNull { it.wire == value }
    }
}

/** The parser's endpoint that settles an account's access and says where it stands. */
const val ACCESS_CHECK_PATH = "/access/check"

private val statusField = Regex("\"status\"\\s*:\\s*\"([a-z]+)\"")

/** The status in `/access/check`'s answer (`{"status":"approved"}`); null for anything else. */
fun accessCheckAnswer(body: String): AccountAccess? = AccountAccess.fromWire(statusField.find(body)?.groupValues?.get(1))

/*
 * Who may use Travelmo, as packages/core/src/access.ts decides it;
 * firestore.rules and the parser decide the same way.
 */

/**
 * `access/{email}`, the id the lowercased address: [status] is the request
 * and the admins' decision (never [AccountAccess.NONE]); [invitedBy] is the
 * last approved user who shared something with the address, which approves
 * it unless an admin declined it.
 */
data class AccessRecord(
    val email: String,
    val status: AccountAccess? = null,
    val uid: String? = null,
    val invitedBy: String? = null,
    val invitedAt: String? = null,
    val approvedBy: String? = null,
    val approvedAt: String? = null,
    val declinedBy: String? = null,
    val declinedAt: String? = null,
)

/** A record as stored; null without its address. A status that isn't one counts as none. */
fun accessRecordOf(data: Map<String, Any?>): AccessRecord? {
    fun text(key: String) = (data[key] as? String)?.takeIf { it.isNotEmpty() }
    val email = text("email") ?: return null
    return AccessRecord(
        email = email,
        status = AccountAccess.fromWire(text("status"))?.takeIf { it != AccountAccess.NONE },
        uid = text("uid"),
        invitedBy = text("invitedBy"),
        invitedAt = text("invitedAt"),
        approvedBy = text("approvedBy"),
        approvedAt = text("approvedAt"),
        declinedBy = text("declinedBy"),
        declinedAt = text("declinedAt"),
    )
}

/** `config/access`, written by hand in the console: admins' addresses in lowercase. */
data class AccessConfig(val admins: List<String> = emptyList())

fun isAdminEmail(email: String?, config: AccessConfig?): Boolean = email != null && config != null && email in config.admins

/** Whether the account is an admin's: its sign-in or an address it linked is in the list (the web's `access.admin`). */
fun isAdmin(email: String?, linked: List<String>, config: AccessConfig?): Boolean =
    config?.admins.orEmpty().any { (email != null && it == email) || it in linked }

private fun lets(record: AccessRecord?): Boolean =
    record != null && record.status != AccountAccess.DECLINED && (record.status == AccountAccess.APPROVED || record.invitedBy != null)

/**
 * Whether an address, once confirmed as the account's, would let it in: an
 * admin's, or one whose record an admin approved or someone invited (and no
 * admin declined). A record speaks only for its own address.
 */
fun letsIn(email: String, record: AccessRecord?, config: AccessConfig?): Boolean =
    isAdminEmail(email, config) || (record?.email == email && lets(record))

/**
 * Where the account stands. [email] is its verified address, normalized
 * (null when unverified); [hasProfile] whether `users/{uid}` exists; [linked]
 * the addresses it confirmed besides its sign-in, and [linkedRecords] their
 * records. Only the sign-in's decline locks it out.
 */
fun accessStatus(
    email: String?,
    hasProfile: Boolean,
    record: AccessRecord?,
    config: AccessConfig?,
    linked: List<String> = emptyList(),
    linkedRecords: List<AccessRecord> = emptyList(),
): AccountAccess {
    if (isAdminEmail(email, config) || linked.any { isAdminEmail(it, config) }) return AccountAccess.APPROVED
    // A record speaks only for a verified address.
    val own = record?.takeIf { email != null && it.email == email }
    if (own?.status == AccountAccess.DECLINED) return AccountAccess.DECLINED
    if (own?.status == AccountAccess.APPROVED || own?.invitedBy != null || hasProfile) return AccountAccess.APPROVED
    if (linkedRecords.any { it.email in linked && lets(it) }) return AccountAccess.APPROVED
    return AccountAccess.NONE
}

/** What an approved user sharing with the address merges into its record. */
fun accessInvite(email: String, inviterUid: String, now: String): Map<String, String> =
    mapOf("email" to email, "invitedBy" to inviterUid, "invitedAt" to now)

/**
 * The fields an admin's decision changes: [AccountAccess.APPROVED] (also
 * inviting an address that never asked) or [AccountAccess.DECLINED] (also
 * revoking).
 */
fun accessDecision(decision: AccountAccess, adminUid: String, now: String): Map<String, String> = when (decision) {
    AccountAccess.APPROVED -> mapOf("status" to decision.wire, "approvedBy" to adminUid, "approvedAt" to now)
    AccountAccess.DECLINED -> mapOf("status" to decision.wire, "declinedBy" to adminUid, "declinedAt" to now)
    else -> throw IllegalArgumentException("A decision approves or declines")
}

/**
 * What an account from before approvals records of itself, so it is listed
 * on the Access page and an admin can revoke it (the web's recordSelf).
 */
fun accessSelfApproval(email: String, uid: String, now: String): Map<String, String> =
    mapOf("email" to email, "status" to AccountAccess.APPROVED.wire, "uid" to uid, "approvedBy" to uid, "approvedAt" to now)

/** Admins and the admin acting are never revoked, so no one locks out an admin; the rules refuse it too. */
fun canRevoke(email: String, adminEmail: String?, config: AccessConfig?): Boolean = email != adminEmail && !isAdminEmail(email, config)

/** Who the Access page lists: everyone approved by a record, by address. */
data class AccessLists(val approved: List<AccessRecord>)

/** Declined records and old requests are listed nowhere; inviting the address again approves it. */
fun accessLists(records: List<AccessRecord>): AccessLists = AccessLists(
    approved = records.filter { it.status == AccountAccess.APPROVED || (it.status != AccountAccess.DECLINED && it.invitedBy != null) }.sortedBy { it.email },
)

/** How the account was let in, as Profile shows it beside the address, as access.ts's accessBadge. */
enum class AccessBadge { ADMIN, INVITED }

/** [AccessBadge.ADMIN] for an admin's account, [AccessBadge.INVITED] for one let in because someone shared with it; null for the rest. */
fun accessBadge(admin: Boolean, email: String?, record: AccessRecord?): AccessBadge? = when {
    admin -> AccessBadge.ADMIN
    email != null && record?.email == email && record.invitedBy != null && record.status != AccountAccess.DECLINED -> AccessBadge.INVITED
    else -> null
}
