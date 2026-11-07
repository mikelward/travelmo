package app.travelmo.auth

import android.content.Context
import android.util.Log
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import app.travelmo.core.normalizeEmail
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.firebase.auth.AuthCredential
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.GoogleAuthProvider
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.tasks.await

/** The signed-in Firebase user, as the screens need it. */
data class SignedIn(val uid: String, val email: String?)

sealed interface SignInResult {
    data object Success : SignInResult

    /** The user backed out of the account picker. Nothing to say. */
    data object Canceled : SignInResult

    /** No Google account on the device to pick. */
    data object NoAccount : SignInResult

    data object Failed : SignInResult
}

/**
 * Sign in with Google through Credential Manager, signing Firebase in with
 * the Google ID token, as the web app signs in with Google: the uid is the
 * same account's on every device, so the same trips and rules apply.
 * [available] is false on builds without Firebase or without the web client
 * id the google-services plugin generates; every entry point is then a no-op.
 */
class GoogleAccount(
    private val firebaseAvailable: () -> Boolean,
    private val webClientId: String?,
    private val auth: () -> FirebaseAuth = { FirebaseAuth.getInstance() },
    private val credentialManager: (Context) -> CredentialManager = { CredentialManager.create(it) },
) {
    val available: Boolean
        get() = !webClientId.isNullOrBlank() && firebaseAvailable()

    private val _user = MutableStateFlow<SignedIn?>(null)

    /** The signed-in user, or null when signed out. */
    val user: StateFlow<SignedIn?> = _user.asStateFlow()

    /** Starts tracking Firebase's current user. Call once, from Application. */
    fun start() {
        if (!available) return
        auth().addAuthStateListener { _user.value = it.currentUser?.toSignedIn() }
    }

    /** Shows the Sign in with Google sheet. [activityContext] must be an Activity. */
    suspend fun signIn(activityContext: Context): SignInResult {
        val clientId = webClientId
        if (!available || clientId == null) return SignInResult.Failed
        return try {
            val credential = googleCredential(activityContext, clientId) ?: return SignInResult.Failed
            auth().signInWithCredential(credential).await()
            SignInResult.Success
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            failure(e)
        }
    }

    /** Signs out of Firebase and clears Credential Manager's remembered choice. */
    suspend fun signOut(context: Context) {
        if (!available) return
        auth().signOut()
        try {
            credentialManager(context).clearCredentialState(ClearCredentialStateRequest())
        } catch (e: Exception) {
            Log.w(TAG, "Clearing the credential state failed", e)
        }
    }

    private suspend fun googleCredential(activityContext: Context, clientId: String): AuthCredential? {
        val request = GetCredentialRequest.Builder()
            .addCredentialOption(GetSignInWithGoogleOption.Builder(clientId).build())
            .build()
        val credential = credentialManager(activityContext).getCredential(activityContext, request).credential
        if (credential !is CustomCredential || credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) {
            Log.w(TAG, "Sign-in returned an unexpected credential type")
            return null
        }
        val idToken = GoogleIdTokenCredential.createFrom(credential.data).idToken
        return GoogleAuthProvider.getCredential(idToken, null)
    }

    private fun failure(e: Exception): SignInResult = when (e) {
        is GetCredentialCancellationException -> SignInResult.Canceled
        is NoCredentialException -> SignInResult.NoAccount
        is GetCredentialException -> {
            Log.w(TAG, "Sign-in failed: ${e.type}")
            SignInResult.Failed
        }
        else -> {
            Log.w(TAG, "Sign-in failed", e)
            SignInResult.Failed
        }
    }

    private fun FirebaseUser.toSignedIn() = SignedIn(uid, normalizeEmail(email))

    private companion object {
        const val TAG = "GoogleAccount"
    }
}
