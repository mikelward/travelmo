package app.travelmo.ui

/** The signed-in account as the shared screens act on it; Android's is its Google sign-in. */
interface SignedInAccount {
    /** Signs out, here and from the platform's saved sign-in. */
    suspend fun signOut()

    /** Signs out once the account has been deleted, so the sign-in screen says so. */
    suspend fun signOutDeleted()
}
