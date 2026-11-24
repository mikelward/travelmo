package app.travelmo.data

import app.travelmo.core.AccountAccess

/** Settles the signed-in account's access with the parser (SPEC "Access"); a fake in tests. */
interface AccessCheck {
    /**
     * Where the account stands once settled; null when that could not be
     * told (offline, no parser). Throws [AccountDeletionUnfinished] when
     * the parser says the account's deletion stopped part way.
     */
    suspend fun check(): AccountAccess?
}

/** The account's deletion stopped before its sign-in went (SPEC "Deleting an account"). */
class AccountDeletionUnfinished : Exception("Deleting the account didn't finish")

/** A build with no parser behind it: nothing to settle. */
object NoAccessCheck : AccessCheck {
    override suspend fun check(): AccountAccess? = null
}
