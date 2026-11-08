package app.travelmo.notify

import android.content.Context
import androidx.core.content.edit
import app.travelmo.core.deviceId
import app.travelmo.data.TripStore
import app.travelmo.log.TravelmoLog
import com.google.firebase.messaging.FirebaseMessaging
import com.mikelward.androidlog.safe
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.tasks.await

/**
 * This phone as a reminder device: its Cloud Messaging token, and which
 * user it is registered under. The screens read it through the view model;
 * a fake stands in for it in tests. [FirebasePushDevice] is the real one.
 */
interface PushDevice {
    /** The last token known, null before [token] answered or when there is none; moves when Messaging rotates it. */
    val latest: StateFlow<String?>

    /** Asks the phone for its current token, which becomes [latest]; null when there is none (Firebase dormant, Play services missing). */
    suspend fun token(): String?

    /** Remembers that the device with [id] is registered under [uid], or, with a null [id], that it is not. */
    fun remember(uid: String, id: String?)

    /** The device id remembered for [uid], if the phone is registered under them. */
    fun remembered(uid: String): String?

    /**
     * A refreshed token: when this phone was registered under [uid], the new
     * token takes the old one's place (both documents briefly, then the old
     * is removed), so the setting stays on with no gap in delivery.
     */
    suspend fun tokenChanged(store: TripStore, uid: String, token: String) {
        val old = remembered(uid)
        val new = deviceId(token)
        if (old != null && old != new) {
            store.replaceDevice(uid, old, new, token)
            remember(uid, new)
            TravelmoLog.info("Re-registered this phone under a refreshed token")
        }
        tokenKnown(token)
    }

    /** Records a token the phone now has, for [latest]. */
    fun tokenKnown(token: String?)
}

/** No push channel at all: the switch does not show. */
object NoPushDevice : PushDevice {
    override val latest: StateFlow<String?> = MutableStateFlow(null)
    override suspend fun token(): String? = null
    override fun remember(uid: String, id: String?) {}
    override fun remembered(uid: String): String? = null
    override fun tokenKnown(token: String?) {}
}

class FirebasePushDevice(context: Context) : PushDevice {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val _latest = MutableStateFlow<String?>(null)
    override val latest: StateFlow<String?> = _latest.asStateFlow()

    override suspend fun token(): String? = try {
        FirebaseMessaging.getInstance().token.await().also { tokenKnown(it) }
    } catch (e: Exception) {
        // No Play services, or Messaging unreachable: no switch rather than a broken one.
        TravelmoLog.warning("No messaging token: %s", safe(e.javaClass.simpleName))
        null
    }

    override fun tokenKnown(token: String?) {
        _latest.value = token
    }

    override fun remember(uid: String, id: String?) {
        prefs.edit { if (id == null) remove(key(uid)) else putString(key(uid), id) }
    }

    override fun remembered(uid: String): String? = prefs.getString(key(uid), null)

    private fun key(uid: String) = "device:$uid"

    private companion object {
        const val PREFS = "reminders"
    }
}
