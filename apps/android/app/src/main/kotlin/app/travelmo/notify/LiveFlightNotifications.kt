package app.travelmo.notify

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.edit
import app.travelmo.R
import app.travelmo.core.LiveFlightMessage
import app.travelmo.core.liveFlight
import app.travelmo.core.liveFlightMessage
import org.json.JSONObject
import app.travelmo.log.TravelmoLog
import com.mikelward.androidlog.safe
import java.time.Instant

/**
 * A flight's Live Update: an ongoing notification, promoted to a chip in the status bar on
 * Android 16 and later, from two hours before departure until 45 minutes after landing. The
 * parser sends one after each look at the flight ([liveFlightMessage][app.travelmo.core.liveFlightMessage]);
 * each replaces the last without a sound, and one the flight no longer needs (cancelled, or over)
 * takes it down. Dismissed, it stays away for that flight.
 *
 * It moves on without the network too: the last message is kept, and an alarm draws it again when
 * the flight is taken to have left and when its landing estimate comes ([LiveFlight.redrawAt]
 * [app.travelmo.core.LiveFlight.redrawAt]), so a phone in flight mode still counts down to landing.
 */
object LiveFlightNotifications {
    const val CHANNEL_ID = "live_flights"

    private const val PREFS = "live_flights"
    private const val ACTION_DISMISSED = "app.travelmo.LIVE_FLIGHT_DISMISSED"
    private const val EXTRA_KEY = "key"
    private const val EXTRA_ENDS_AT = "endsAt"
    private const val EXTRA_TAG = "tag"
    private const val ACTION_REDRAW = "app.travelmo.LIVE_FLIGHT_REDRAW"

    /** Each flight's last message, by tag, for drawing it again with no network. */
    private const val MESSAGES = "live_flight_messages"

    /** Shows a Live Update message from the parser, keeping it for redrawing offline. */
    fun received(context: Context, data: Map<String, String>, now: Long = System.currentTimeMillis()) {
        val message = liveFlightMessage(data) ?: return
        context.getSharedPreferences(MESSAGES, Context.MODE_PRIVATE).edit { putString(message.tag, JSONObject(data).toString()) }
        show(context, message, now)
    }

    /** Draws a flight's Live Update again from its last message, as its alarm asks. */
    internal fun redraw(context: Context, tag: String, now: Long = System.currentTimeMillis()) {
        val json = context.getSharedPreferences(MESSAGES, Context.MODE_PRIVATE).getString(tag, null) ?: return
        val data = try {
            JSONObject(json).let { o -> o.keys().asSequence().associateWith { o.getString(it) } }
        } catch (e: org.json.JSONException) {
            TravelmoLog.error(e, "Live Update not redrawn: its kept message is unreadable")
            forget(context, tag)
            return
        }
        liveFlightMessage(data)?.let { show(context, it, now) } ?: forget(context, tag)
    }

    private fun forget(context: Context, tag: String) {
        context.getSharedPreferences(MESSAGES, Context.MODE_PRIVATE).edit { remove(tag) }
        context.getSystemService(AlarmManager::class.java).cancel(redrawIntent(context, tag))
    }

    private fun redrawIntent(context: Context, tag: String): PendingIntent = PendingIntent.getBroadcast(
        context,
        tag.hashCode(),
        Intent(context, LiveFlightRedrawReceiver::class.java).setAction(ACTION_REDRAW).putExtra(EXTRA_TAG, tag),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    /**
     * Draws it again at [at], or forgets it when nothing will change without news. Inexact, so no
     * exact-alarm permission: Android may hold it a few minutes in Doze, which a flight can spare.
     */
    private fun scheduleRedraw(context: Context, tag: String, at: Long?) {
        if (at == null) {
            forget(context, tag)
            return
        }
        context.getSystemService(AlarmManager::class.java).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, redrawIntent(context, tag))
    }

    private fun ensureChannel(context: Context) {
        val channel = NotificationChannel(CHANNEL_ID, context.getString(R.string.live_flights_channel), NotificationManager.IMPORTANCE_DEFAULT)
        channel.description = context.getString(R.string.live_flights_channel_description)
        // An update a minute: never a sound or a buzz; the "Flight changes" channel alerts.
        channel.setSound(null, null)
        channel.enableVibration(false)
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    fun show(context: Context, message: LiveFlightMessage, now: Long = System.currentTimeMillis()) {
        val manager = NotificationManagerCompat.from(context)
        val live = liveFlight(message.status, message.booking, Instant.ofEpochMilli(now).toString())
        if (live == null || live.endsAt <= now) {
            manager.cancel(message.tag, 0)
            forget(context, message.tag)
            return
        }
        scheduleRedraw(context, message.tag, live.redrawAt)
        if (!ReminderNotifications.allowed(context)) {
            TravelmoLog.info("Live Update not shown: notifications are not allowed")
            return
        }
        if (dismissed(context, message.key, live.endsAt, now)) return
        ensureChannel(context)
        val tap = PendingIntent.getActivity(
            context,
            message.tag.hashCode(),
            ReminderNotifications.tapIntent(context, message.url, message.tag),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val dismiss = PendingIntent.getBroadcast(
            context,
            message.tag.hashCode(),
            Intent(context, LiveFlightDismissedReceiver::class.java)
                .setAction(ACTION_DISMISSED)
                .putExtra(EXTRA_KEY, message.key)
                .putExtra(EXTRA_ENDS_AT, live.endsAt),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
        // In the air, the chip is a countdown to landing that the phone runs itself, so it keeps
        // going in flight mode; otherwise it is the chip's text.
        val landsAt = live.landsAt
        if (landsAt != null) {
            builder.setWhen(landsAt).setShowWhen(true).setUsesChronometer(true).setChronometerCountDown(true)
        } else {
            builder.setShortCriticalText(live.chip)
        }
        val notification = builder
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(message.booking.title)
            .setContentText(live.text)
            .setRequestPromotedOngoing(true)
            .setStyle(NotificationCompat.ProgressStyle().addProgressSegment(NotificationCompat.ProgressStyle.Segment(100)).setProgress(live.progress))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setContentIntent(tap)
            .setDeleteIntent(dismiss)
            // Down when the flight is over, should no later message say so.
            .setTimeoutAfter(live.endsAt - now)
            .build()
        try {
            manager.notify(message.tag, 0, notification)
        } catch (e: SecurityException) {
            // The permission was revoked between the check and the post.
            TravelmoLog.error(e, "Live Update not shown: %s", safe(e.javaClass.simpleName))
        }
    }

    /**
     * Whether the person swiped this flight's Live Update away, keeping that until the flight is
     * over as this update has it ([endsAt]: a delayed landing moves it later); forgets flights
     * that are over.
     */
    private fun dismissed(context: Context, key: String, endsAt: Long, now: Long): Boolean {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val over = prefs.all.filter { (_, until) -> (until as? Long ?: 0L) <= now }.keys
        if (over.isNotEmpty()) prefs.edit { over.forEach(::remove) }
        if (!prefs.contains(key)) return false
        if (prefs.getLong(key, 0L) < endsAt) prefs.edit { putLong(key, endsAt) }
        return true
    }

    internal fun rememberDismissed(context: Context, intent: Intent) {
        val key = intent.getStringExtra(EXTRA_KEY) ?: return
        val endsAt = intent.getLongExtra(EXTRA_ENDS_AT, 0L)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit { putLong(key, endsAt) }
        TravelmoLog.info("Live Update dismissed; none more for that flight")
    }
}

/** Remembers a swiped-away Live Update, so the next minute's message does not bring it back. */
class LiveFlightDismissedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        LiveFlightNotifications.rememberDismissed(context, intent)
    }
}

/** Draws a flight's Live Update again when its alarm comes, network or not. */
class LiveFlightRedrawReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val tag = intent.getStringExtra("tag") ?: return
        LiveFlightNotifications.redraw(context, tag)
    }
}
