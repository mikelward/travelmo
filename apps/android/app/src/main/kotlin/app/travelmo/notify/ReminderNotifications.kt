package app.travelmo.notify

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import app.travelmo.MainActivity
import app.travelmo.R
import app.travelmo.log.TravelmoLog
import com.mikelward.androidlog.safe

/**
 * The reminder channel and how a reminder from the parser is shown. A tap
 * opens the trip: [MainActivity] reads [EXTRA_URL].
 */
object ReminderNotifications {
    const val CHANNEL_ID = "reminders"

    /** The reminder's web URL, on the intent a tap sends to [MainActivity]. */
    const val EXTRA_URL = "app.travelmo.reminder_url"

    /** Makes the channel if it is new; a channel's importance is the user's once it exists. */
    fun ensureChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(CHANNEL_ID, context.getString(R.string.reminders_channel), NotificationManager.IMPORTANCE_DEFAULT)
        channel.description = context.getString(R.string.reminders_channel_description)
        manager.createNotificationChannel(channel)
    }

    /** Whether the app may post notifications at all: the permission, and the app not blocked in the system settings. */
    fun allowed(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED &&
            NotificationManagerCompat.from(context).areNotificationsEnabled()

    /**
     * Shows one reminder; [tag] (one per trip) makes a later reminder for the
     * same trip replace the earlier. Nothing is shown without the permission,
     * which only the switch in Settings asks for.
     */
    fun show(context: Context, title: String, body: String, url: String?, tag: String) {
        if (!allowed(context)) {
            TravelmoLog.info("Reminder not shown: notifications are not allowed")
            return
        }
        ensureChannel(context)
        val open = Intent(context, MainActivity::class.java).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            putExtra(EXTRA_URL, url)
        }
        val tap = PendingIntent.getActivity(context, tag.hashCode(), open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body.lineSequence().firstOrNull().orEmpty())
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(tap)
            .setAutoCancel(true)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(tag, 0, notification)
        } catch (e: SecurityException) {
            // The permission was revoked between the check and the post.
            TravelmoLog.error(e, "Reminder not shown: %s", safe(e.javaClass.simpleName))
        }
    }
}
