package app.travelmo.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import app.travelmo.auth.GoogleAccount

/** [account] as the shared screens act on it, signing out through this screen's context. */
@Composable
fun rememberSignedInAccount(account: GoogleAccount): SignedInAccount {
    val context = LocalContext.current.applicationContext
    return remember(account, context) {
        object : SignedInAccount {
            override suspend fun signOut() = account.signOut(context)

            override suspend fun signOutDeleted() = account.signOutDeleted(context)
        }
    }
}
