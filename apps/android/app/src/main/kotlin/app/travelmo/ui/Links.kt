package app.travelmo.ui

import android.content.ActivityNotFoundException
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
