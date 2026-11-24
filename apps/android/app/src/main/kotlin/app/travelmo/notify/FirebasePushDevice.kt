package app.travelmo.notify

import android.content.Context
import androidx.core.content.edit
import app.travelmo.log.TravelmoLog
import com.google.firebase.messaging.FirebaseMessaging
import com.mikelward.androidlog.safe
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.tasks.await

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
