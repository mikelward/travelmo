package app.travelmo.notify

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import app.travelmo.MainActivity
import app.travelmo.R
import app.travelmo.core.externalReminderUrl
import app.travelmo.log.TravelmoLog
import com.mikelward.androidlog.safe

/**
 * The notification channels and how a message from the parser is shown. A
 * tap opens the trip, or an admin's access request the Access page
 * ([MainActivity] reads [EXTRA_URL]), or a check-in reminder's airline
 * site in the browser. News of a flight (a gate, delay, cancellation,
 * diversion or carousel) has a channel of its own that interrupts, with
 * its own chime; everything else is a reminder.
 */
object ReminderNotifications {
    const val CHANNEL_ID = "reminders"

    /**
     * Flight news. Android fixes a channel's sound when it is made, so a new
     * sound needs a new id (and the old one deleted, as [OLD_ACCESS_CHANNEL_ID] was).
     */
    const val FLIGHT_CHANNEL_ID = "flight_changes"

    /** The parser tags flight news `flight-<flight>` (`apps/parser/src/flightStatus.ts`). */
    private const val FLIGHT_TAG_PREFIX = "flight-"

    /** The channel admins' access requests had, before nobody could ask; removed where an older version made it. */
    private const val OLD_ACCESS_CHANNEL_ID = "access_requests"

    /** The reminder's web URL, on the intent a tap sends to [MainActivity]. */
    const val EXTRA_URL = "app.travelmo.reminder_url"

    /** Makes the channels if they are new; a channel's importance is the user's once it exists. */
    fun ensureChannel(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(CHANNEL_ID, context.getString(R.string.reminders_channel), NotificationManager.IMPORTANCE_DEFAULT)
        channel.description = context.getString(R.string.reminders_channel_description)
        manager.createNotificationChannel(channel)
        val flights = NotificationChannel(FLIGHT_CHANNEL_ID, context.getString(R.string.flight_changes_channel), NotificationManager.IMPORTANCE_HIGH)
        flights.description = context.getString(R.string.flight_changes_channel_description)
        flights.setSound(chimeUri(context), AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
        manager.createNotificationChannel(flights)
        manager.deleteNotificationChannel(OLD_ACCESS_CHANNEL_ID)
    }

    /** The channel a message with this [tag] is shown in. */
    fun channelFor(tag: String): String = if (tag.startsWith(FLIGHT_TAG_PREFIX)) FLIGHT_CHANNEL_ID else CHANNEL_ID

    /**
     * By name, not by `R.raw` id: the channel keeps this URI across upgrades,
     * and a resource's numeric id can change from one build to the next.
     */
    private fun chimeUri(context: Context) =
        "${ContentResolver.SCHEME_ANDROID_RESOURCE}://${context.packageName}/raw/flight_chime".toUri()

    /** Whether the app may post notifications at all: the permission, and the app not blocked in the system settings. */
    fun allowed(context: Context): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED &&
            NotificationManagerCompat.from(context).areNotificationsEnabled()

    /** The booking a check-in reminder is about, for its "I've checked in" action. */
    data class CheckedInTarget(val tripId: String, val segmentId: String)

    /**
     * Shows one reminder; [tag] (one per trip) makes a later reminder for the
     * same trip replace the earlier. A check-in reminder ([checkedIn]) offers
     * "I've checked in" ([CheckedInReceiver]). Nothing is shown without the
     * permission, which only the switch in Settings asks for.
     */
    fun show(context: Context, title: String, body: String, url: String?, tag: String, checkedIn: CheckedInTarget? = null) {
        if (!allowed(context)) {
            TravelmoLog.info("Reminder not shown: notifications are not allowed")
            return
        }
        ensureChannel(context)
        val tap = PendingIntent.getActivity(context, tag.hashCode(), tapIntent(context, url, tag), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = NotificationCompat.Builder(context, channelFor(tag))
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body.lineSequence().firstOrNull().orEmpty())
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(tap)
            .setAutoCancel(true)
            .apply { checkedIn?.let { addAction(0, context.getString(R.string.checked_in_action), checkedInIntent(context, it, tag)) } }
            .build()
        try {
            NotificationManagerCompat.from(context).notify(tag, 0, notification)
        } catch (e: SecurityException) {
            // The permission was revoked between the check and the post.
            TravelmoLog.error(e, "Reminder not shown: %s", safe(e.javaClass.simpleName))
        }
    }

    /** The broadcast "I've checked in" sends, naming the booking and the notification to take away. */
    internal fun checkedInIntent(context: Context, target: CheckedInTarget, tag: String): PendingIntent {
        val intent = Intent(context, CheckedInReceiver::class.java)
            .putExtra(CheckedInReceiver.EXTRA_TRIP_ID, target.tripId)
            .putExtra(CheckedInReceiver.EXTRA_SEGMENT_ID, target.segmentId)
            .putExtra(CheckedInReceiver.EXTRA_TAG, tag)
        return PendingIntent.getBroadcast(context, tag.hashCode(), intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    /**
     * What a tap opens: a check-in reminder's airline site in the browser; a
     * trip, or an admin's access request (the Access page), in the app.
     */
    internal fun tapIntent(context: Context, url: String?, tag: String): Intent =
        externalReminderUrl(url)?.let { Intent(Intent.ACTION_VIEW, it.toUri()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
            ?: Intent(context, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                putExtra(EXTRA_URL, url)
            }
}
