package app.travelmo.ui

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.widget.Toast
import androidx.core.net.toUri
import app.travelmo.R
import app.travelmo.log.TravelmoLog
import com.mikelward.androidlog.safe

/**
 * Opens [url] in whatever app takes it (a browser, Gmail). With none on the
 * device the tap says so rather than doing nothing; the log names [what]
 * was being opened, never the address, which can identify a message.
 */
fun openLink(context: Context, url: String, what: String) {
    try {
        context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri()))
    } catch (e: ActivityNotFoundException) {
        TravelmoLog.warning("No app to open %s: %s", safe(what), safe(e.javaClass.simpleName))
        Toast.makeText(context, R.string.link_failed, Toast.LENGTH_SHORT).show()
    }
}

private const val GMAIL_PACKAGE = "com.google.android.gm"

/**
 * Opens an email in the Gmail app by [search]: the app takes no link to a
 * message, and a browser sends one to Gmail's mobile site, which drops the
 * message id. So the search goes on the clipboard, a toast says to paste
 * it, and Gmail opens. Without Gmail, [url] opens as any link does.
 */
fun openGmailSearch(context: Context, search: String, url: String) {
    val gmail = context.packageManager.getLaunchIntentForPackage(GMAIL_PACKAGE)
    if (gmail == null) {
        TravelmoLog.info("Gmail is not installed: opening the email's link")
        openLink(context, url, "a booking's email")
        return
    }
    val clipboard = context.getSystemService(ClipboardManager::class.java)
    if (clipboard == null) {
        TravelmoLog.warning("No clipboard for the Gmail search: opening the email's link")
        openLink(context, url, "a booking's email")
        return
    }
    clipboard.setPrimaryClip(ClipData.newPlainText("Gmail search", search))
    Toast.makeText(context, R.string.gmail_search_copied, Toast.LENGTH_LONG).show()
    try {
        context.startActivity(gmail)
    } catch (e: ActivityNotFoundException) {
        TravelmoLog.warning("Gmail would not open: %s", safe(e.javaClass.simpleName))
        openLink(context, url, "a booking's email")
    }
}
