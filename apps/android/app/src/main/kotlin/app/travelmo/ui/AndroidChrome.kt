package app.travelmo.ui

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * Android's pieces of the shared screens (AppChrome): the ⋮ menu with
 * Report a bug, About, Access and the update dot; the crash report banner;
 * and links opened through an Intent, with a toast when no app takes one.
 */
class AndroidChrome(private val context: Context) : AppChrome {
    @Composable
    override fun Menu(modifier: Modifier, items: @Composable (close: () -> Unit) -> Unit) = AndroidAppMenu(modifier, items)

    @Composable
    override fun crashPending(): Boolean = androidCrashPending()

    @Composable
    override fun CrashBanner(modifier: Modifier) = AndroidLastCrashBanner(modifier)

    override fun openLink(url: String, what: String) = openLink(context, url, what)
}
