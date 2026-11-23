package app.travelmo.core

/**
 * Where an account stands (SPEC "Access"), as packages/core/src/access.ts's
 * `AccountAccess` names it: [NONE] has never asked.
 */
enum class AccountAccess(val wire: String) {
    APPROVED("approved"),
    REQUESTED("requested"),
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
