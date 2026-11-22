package app.travelmo.ui

import android.content.Context
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.wrapContentSize
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.travelmo.R
import app.travelmo.auth.GoogleAccount
import app.travelmo.auth.SignInResult
import app.travelmo.log.DebugLogging
import app.travelmo.ui.theme.Wordmark
import com.mikelward.androidlog.android.ShareOutcome
import kotlinx.coroutines.launch

/**
 * The entry: the logo, the name, the tagline, and Sign in with Google, as on
 * the web; after a deletion, that the account is gone. A sign-in that fails
 * for a reason the user can't fix offers the debug log, since Settings, where
 * it otherwise lives, is behind sign-in. After a crash, the crash banner
 * is on top.
 */
@Composable
fun SignInScreen(
    account: GoogleAccount,
    /** Sign-in and the debug-log share; a test hands in its own. */
    signIn: suspend (Context) -> SignInResult = account::signIn,
    shareLog: suspend (Context) -> ShareOutcome = { DebugLogging.share(it, signedIn = false) },
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val deleted by account.deleted.collectAsStateWithLifecycle()
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<Int?>(if (account.available) null else R.string.sign_in_unavailable) }
    var offerLog by remember { mutableStateOf(false) }
    var sharing by remember { mutableStateOf(false) }
    var shareNote by remember { mutableStateOf<Int?>(null) }
    val crashed = crashPending()
    Surface(modifier = Modifier.fillMaxSize()) {
        // Centered when it fits; when it doesn't (the crash banner, large
        // text, a small phone), it scrolls rather than push Sign in off the screen.
        BoxWithConstraints(Modifier.fillMaxSize().safeDrawingPadding()) {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()).heightIn(min = maxHeight).fillMaxWidth().padding(24.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                // Signed out, this is the screen the app opens on, so an earlier crash is offered here.
                if (crashed) LastCrashBanner(Modifier.padding(bottom = 24.dp))
                if (deleted) {
                    Text(
                        stringResource(R.string.account_deleted),
                        style = MaterialTheme.typography.bodyLarge,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(bottom = 24.dp),
                    )
                }
                Image(painterResource(R.drawable.logo), contentDescription = null, modifier = Modifier.size(96.dp).padding(bottom = 16.dp))
                Text(stringResource(R.string.app_name), style = MaterialTheme.typography.headlineMedium, fontFamily = Wordmark)
                Text(
                    stringResource(R.string.sign_in_tagline),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 8.dp, bottom = 24.dp),
                )
                Button(
                    enabled = account.available && !busy,
                    onClick = {
                        busy = true
                        message = null
                        shareNote = null
                        scope.launch {
                            val result = signIn(context)
                            busy = false
                            message = when (result) {
                                SignInResult.Success, SignInResult.Canceled -> null
                                SignInResult.NoAccount -> R.string.sign_in_no_account
                                SignInResult.Refused -> R.string.sign_in_refused
                                SignInResult.Failed -> R.string.sign_in_failed
                            }
                            offerLog = result == SignInResult.Refused || result == SignInResult.Failed
                        }
                    },
                ) {
                    Text(stringResource(R.string.sign_in_google))
                }
                message?.let {
                    Text(
                        stringResource(it),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.error,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(top = 16.dp),
                    )
                }
                if (offerLog) {
                    OutlinedButton(
                        enabled = !sharing,
                        onClick = {
                            sharing = true
                            shareNote = null
                            scope.launch {
                                val outcome = shareLog(context)
                                sharing = false
                                shareNote = when (outcome) {
                                    ShareOutcome.SHARED -> null
                                    ShareOutcome.COPIED_ONLY -> R.string.debug_log_copied_only
                                    ShareOutcome.FAILED -> R.string.debug_log_share_failed
                                }
                            }
                        },
                        modifier = Modifier.padding(top = 16.dp),
                    ) { Text(stringResource(if (sharing) R.string.sharing else R.string.share_debug_log)) }
                    shareNote?.let {
                        Text(
                            stringResource(it),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(top = 8.dp),
                        )
                    }
                }
            }
        }
        // Last, so it is on top. No top bar here, so the app's menu sits where one would end.
        AppMenu(modifier = Modifier.fillMaxSize().safeDrawingPadding().wrapContentSize(Alignment.TopEnd))
    }
}
