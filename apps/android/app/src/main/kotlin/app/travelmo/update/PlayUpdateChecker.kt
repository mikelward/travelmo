package app.travelmo.update

import android.content.Context
import app.travelmo.BuildConfig
import app.travelmo.log.TravelmoLog
import com.google.android.play.core.appupdate.AppUpdateManager
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.install.model.UpdateAvailability
import com.mikelward.androidlog.safe

/**
 * Asks Google Play whether a newer version of the app is out, for the red
 * dot on the ⋮ menu and its "Update available" item (SPEC "Android app"), as
 * stopdash's PlayUpdateChecker does. Detection only: the item opens the Play
 * listing, and Play does the download and install, so this never runs the
 * in-app update flow.
 *
 * Off in debug builds ([BuildConfig.PLAY_UPDATE_CHECKS_ENABLED]): their
 * `.debug` applicationId isn't a Play app, so a check there only ever fails.
 * [appUpdateManager] and [checksEnabled] are parameters so a test drives
 * Play's own fake instead.
 */
class PlayUpdateChecker(
    context: Context,
    private val appUpdateManager: AppUpdateManager = AppUpdateManagerFactory.create(context),
    private val checksEnabled: Boolean = BuildConfig.PLAY_UPDATE_CHECKS_ENABLED,
) {
    // Bumped per check, so a slow earlier answer can't overwrite a newer one.
    private var generation = 0

    /**
     * Asks Play, in the background (a Play `Task`, never on a render path).
     * [onResult] runs on the main thread: true when Play reports an update.
     * A failed check is inconclusive, but a dot has no way to show
     * "unknown", so it reports false (no dot) and is logged; Play still
     * updates the app on its own schedule.
     */
    fun checkForUpdate(onResult: (available: Boolean) -> Unit) {
        if (!checksEnabled) {
            onResult(false)
            return
        }
        val requested = ++generation
        appUpdateManager.appUpdateInfo
            .addOnSuccessListener { info ->
                if (requested != generation) return@addOnSuccessListener
                onResult(info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE)
            }
            .addOnFailureListener { e ->
                if (requested != generation) return@addOnFailureListener
                // The exception's class only: Play's message is no use here and is not ours to vouch for.
                TravelmoLog.warning("Play update check failed: %s", safe(e.javaClass.simpleName))
                onResult(false)
            }
    }
}
