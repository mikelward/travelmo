package app.travelmo.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier

/**
 * What each app supplies that the shared screens show but cannot do
 * themselves: the ⋮ menu that ends every top bar, the offer of an earlier
 * run's crash report, opening a link in another app, the clipboard, and
 * saving a file where the user picks. Android's are in
 * AndroidChrome; until an app provides its own ([LocalAppChrome]) the
 * screens show none of them, as in a preview.
 */
interface AppChrome {
    /** The ⋮ menu: a screen's own [items] first, each given a `close` to call as it acts, then the app's. */
    @Composable
    fun Menu(modifier: Modifier, items: @Composable (close: () -> Unit) -> Unit)

    /** Whether an earlier run crashed and its report is still to be offered ([CrashBanner]). */
    @Composable
    fun crashPending(): Boolean

    /** The offer of that report, shown while [crashPending]. */
    @Composable
    fun CrashBanner(modifier: Modifier)

    /** Opens [url] in whatever app takes it, saying so when none does; [what] names it in the log, never the address. */
    fun openLink(url: String, what: String)

    /**
     * Opens an email found by a Gmail [search] where a link can't open it
     * (Android: the Gmail app, the search on the clipboard); else [url].
     */
    fun openGmailSearch(search: String, url: String) = openLink(url, "a booking's email")

    /** Puts [text] alone on the clipboard, labeled [label]; the platform confirms the copy itself. */
    fun copyToClipboard(label: String, text: String)

    /**
     * A function that asks the user where to save a file of [mimeType],
     * suggesting the name it is given, then writes [text] there; [onSaved]
     * hears true once written, false when writing failed, and nothing when
     * the user cancelled.
     */
    @Composable
    fun rememberTextSaver(mimeType: String, text: () -> String, onSaved: (Boolean) -> Unit): (suggestedName: String) -> Unit

    /** The app's version as Settings names it. */
    val versionName: String

    /** Settings' reminders on this device, after those by email (Android: as notifications). */
    @Composable
    fun PushSettings(viewModel: TripsViewModel)

    /** Settings' sections for this device, before deleting the account (Android: text size and the debug log). */
    @Composable
    fun DeviceSettings()
}

/** No menu, no crash reports, and links, copies and saves that go nowhere: what a preview shows. */
object NoAppChrome : AppChrome {
    @Composable
    override fun Menu(modifier: Modifier, items: @Composable (close: () -> Unit) -> Unit) {}

    @Composable
    override fun crashPending(): Boolean = false

    @Composable
    override fun CrashBanner(modifier: Modifier) {}

    override fun openLink(url: String, what: String) {}

    override fun copyToClipboard(label: String, text: String) {}

    @Composable
    override fun rememberTextSaver(mimeType: String, text: () -> String, onSaved: (Boolean) -> Unit): (suggestedName: String) -> Unit = {}

    override val versionName: String = ""

    @Composable
    override fun PushSettings(viewModel: TripsViewModel) {}

    @Composable
    override fun DeviceSettings() {}
}

val LocalAppChrome = staticCompositionLocalOf<AppChrome> { NoAppChrome }

/** The app's ⋮ menu, with a screen's own [items] first. */
@Composable
fun AppMenu(modifier: Modifier = Modifier, items: @Composable (close: () -> Unit) -> Unit = {}) =
    LocalAppChrome.current.Menu(modifier, items)

/** Whether to show [LastCrashBanner]; a screen calls it once, so an absent banner takes no room. */
@Composable
fun crashPending(): Boolean = LocalAppChrome.current.crashPending()

/** The offer of an earlier run's crash report. */
@Composable
fun LastCrashBanner(modifier: Modifier = Modifier) = LocalAppChrome.current.CrashBanner(modifier)
