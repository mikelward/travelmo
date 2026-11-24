package app.travelmo.notify

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationManagerCompat
import app.travelmo.TravelmoApplication
import app.travelmo.data.TripStore
import app.travelmo.log.TravelmoLog
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout

/**
 * A check-in reminder's "I've checked in" action: saves the mark for the
 * signed-in user through the app's store, as the button on the card does,
 * then takes the notification away. A mark that can't be saved (signed out,
 * offline, refused) leaves the notification up, so the action can be tried
 * again or the app opened.
 */
class CheckedInReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val tripId = intent.getStringExtra(EXTRA_TRIP_ID)
        val segmentId = intent.getStringExtra(EXTRA_SEGMENT_ID)
        val tag = intent.getStringExtra(EXTRA_TAG)
        // The persisted sign-in, read directly: this can be the first thing to
        // run in a cold process.
        val uid = FirebaseAuth.getInstance().currentUser?.uid
        if (tripId == null || segmentId == null || tag == null) {
            TravelmoLog.warning("Check-in action without its booking ignored")
            return
        }
        if (uid == null) {
            TravelmoLog.info("Check-in action while signed out; nothing saved")
            return
        }
        val store = (context.applicationContext as TravelmoApplication).trips
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                if (save(store, uid, tripId, segmentId)) NotificationManagerCompat.from(context).cancel(tag, 0)
            } finally {
                pending.finish()
            }
        }
    }

    companion object {
        const val EXTRA_TRIP_ID = "app.travelmo.checked_in_trip"
        const val EXTRA_SEGMENT_ID = "app.travelmo.checked_in_segment"
        const val EXTRA_TAG = "app.travelmo.checked_in_tag"

        /** A broadcast receiver has about ten seconds; the write gives up well within them. */
        private const val SAVE_TIMEOUT_MS = 8_000L

        /** Saves the mark; whether it was saved, a failure logged. */
        suspend fun save(store: TripStore, uid: String, tripId: String, segmentId: String): Boolean = try {
            withTimeout(SAVE_TIMEOUT_MS) { store.setCheckedIn(uid, tripId, segmentId, true) }
            TravelmoLog.info("Marked checked in from a notification")
            true
        } catch (e: TimeoutCancellationException) {
            // Offline, most likely: the notification stays.
            TravelmoLog.warning("Marking checked in from a notification timed out")
            false
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            TravelmoLog.error(e, "Marking checked in from a notification failed")
            false
        }
    }
}
