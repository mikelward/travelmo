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
import androidx.core.net.toUri
import app.travelmo.MainActivity
import app.travelmo.R
import app.travelmo.core.externalReminderUrl
import app.travelmo.core.opensAccessPage
import app.travelmo.log.TravelmoLog
import com.mikelward.androidlog.safe

/**
 * The reminder channel and how a reminder from the parser is shown. A tap
 * opens the trip, or an admin's access request the Access page
 * ([MainActivity] reads [EXTRA_URL] and [EXTRA_TAG]), or a check-in
 * reminder's airline site in the browser. Access requests have a channel
 * of their own.
 */
object ReminderNotifications {
    const val CHANNEL_ID = "reminders"

    /** Admins' "Access request" notifications (SPEC "Access"), in a channel of their own so they can be muted apart from trips. */
    const val ACCESS_CHANNEL_ID = "access_requests"

    /** The reminder's web URL, on the intent a tap sends to [MainActivity]. */
    const val EXTRA_URL = "app.travelmo.reminder_url"

    /** The reminder's tag, beside [EXTRA_URL]: an access request is told by both ([opensAccessPage]). */
    const val EXTRA_TAG = "app.travelmo.reminder_tag"

    /** Makes the channels if they are new; a channel's importance is the user's once it exists. */
    fun ensureChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(CHANNEL_ID, context.getString(R.string.reminders_channel), NotificationManager.IMPORTANCE_DEFAULT)
        channel.description = context.getString(R.string.reminders_channel_description)
        manager.createNotificationChannel(channel)
        val access = NotificationChannel(ACCESS_CHANNEL_ID, context.getString(R.string.access_channel), NotificationManager.IMPORTANCE_DEFAULT)
        access.description = context.getString(R.string.access_channel_description)
        manager.createNotificationChannel(access)
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
        val tap = PendingIntent.getActivity(context, tag.hashCode(), tapIntent(context, url, tag), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val channel = if (opensAccessPage(url, tag)) ACCESS_CHANNEL_ID else CHANNEL_ID
        val notification = NotificationCompat.Builder(context, channel)
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

    /**
     * What a tap opens: a check-in reminder's airline site in the browser; a
     * trip, or an admin's access request (the Access page), in the app.
     */
    internal fun tapIntent(context: Context, url: String?, tag: String): Intent =
        externalReminderUrl(url, tag)?.let { Intent(Intent.ACTION_VIEW, it.toUri()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
            ?: Intent(context, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                putExtra(EXTRA_URL, url)
                putExtra(EXTRA_TAG, tag)
            }
}
