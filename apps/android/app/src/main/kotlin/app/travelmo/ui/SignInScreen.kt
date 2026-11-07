package app.travelmo.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import app.travelmo.R
import app.travelmo.auth.GoogleAccount
import app.travelmo.auth.SignInResult
import kotlinx.coroutines.launch

/** The entry: the name, the tagline, and Sign in with Google, as on the web. */
@Composable
fun SignInScreen(account: GoogleAccount) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<Int?>(if (account.available) null else R.string.sign_in_unavailable) }
    Surface(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(stringResource(R.string.app_name), style = MaterialTheme.typography.headlineMedium)
            Text(
                stringResource(R.string.sign_in_tagline),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 8.dp, bottom = 24.dp),
            )
            Button(
                enabled = account.available && !busy,
                onClick = {
                    busy = true
                    message = null
                    scope.launch {
                        val result = account.signIn(context)
                        busy = false
                        message = when (result) {
                            SignInResult.Success, SignInResult.Canceled -> null
                            SignInResult.NoAccount -> R.string.sign_in_no_account
                            SignInResult.Failed -> R.string.sign_in_failed
                        }
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
                    modifier = Modifier.padding(top = 16.dp),
                )
            }
        }
    }
}
