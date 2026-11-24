package app.travelmo.auth

/** The signed-in Firebase user, as the screens need it; [emailVerified] whether Google verified [email], as access asks. */
data class SignedIn(val uid: String, val email: String?, val emailVerified: Boolean = true)
