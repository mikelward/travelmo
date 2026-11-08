package app.travelmo.notify

import app.travelmo.TravelmoApplication
import app.travelmo.log.TravelmoLog
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import kotlinx.coroutines.runBlocking

/**
 * Cloud Messaging's callbacks. The parser sends data messages (the kind
 * Messaging queues one by one for an offline phone), so every reminder
 * arrives here, in front or not, and is drawn from its data; a refreshed
 * token replaces the one registered under the signed-in user, so the parser
 * keeps reaching this phone.
 */
class ReminderMessagingService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        val data = message.data
        val title = data["title"]
        val body = data["body"]
        if (title == null || body == null) {
            TravelmoLog.warning("Message without a title or body ignored")
            return
        }
        ReminderNotifications.show(this, title, body, data["url"], data["tag"] ?: "reminder")
    }

    override fun onNewToken(token: String) {
        val app = application as TravelmoApplication
        // The persisted sign-in, read directly: this can be the first thing to
        // run in a cold process, before the account's listener has reported.
        val uid = FirebaseAuth.getInstance().currentUser?.uid
        if (uid == null) {
            TravelmoLog.info("Token refreshed while signed out; nothing registered")
            return
        }
        // Firebase calls this on a background thread; the write is short. A
        // failure here is made good the next time Settings asks for the
        // token, which reconciles what is remembered with what the phone has.
        runBlocking {
            try {
                app.pushDevice.tokenChanged(app.trips, uid, token)
            } catch (e: Exception) {
                TravelmoLog.error(e, "Re-registering the refreshed token failed")
            }
        }
    }
}
