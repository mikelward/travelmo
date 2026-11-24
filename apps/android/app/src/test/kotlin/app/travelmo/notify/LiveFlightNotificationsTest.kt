package app.travelmo.notify

import android.Manifest
import android.app.Application
import android.app.Notification
import android.app.NotificationManager
import androidx.core.app.NotificationCompat
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.core.LiveFlightMessage
import app.travelmo.core.liveFlightMessage
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.Instant

/**
 * A flight's Live Update: promotable to a status-bar chip, silent, replaced by each message,
 * taken down by one the flight no longer needs, and kept away once swiped.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36])
class LiveFlightNotificationsTest {
    private val context = ApplicationProvider.getApplicationContext<android.content.Context>()
    private val manager = context.getSystemService(NotificationManager::class.java)

    private fun message(vararg over: Pair<String, String>): LiveFlightMessage = liveFlightMessage(
        mapOf(
            "kind" to "live",
            "tag" to "live-XX100_2026-12-13_SYD",
            "key" to "XX100_2026-12-13_SYD",
            "title" to "XX 100 SYD to SIN",
            "url" to "https://travelmo.example/trips/t1",
            "start" to "2026-12-13T09:00:00+11:00",
            "end" to "2026-12-13T15:30:00+08:00",
            "ident" to "XX100",
            "date" to "2026-12-13",
            "found" to "true",
            "departureGate" to "28",
            "departureTerminal" to "3",
            "scheduledOut" to "2026-12-12T22:00:00Z",
            "scheduledIn" to "2026-12-13T07:30:00Z",
            "checkedAt" to "2026-12-12T21:00:00Z",
        ) + over,
    )!!

    private fun at(instant: String) = Instant.parse(instant).toEpochMilli()

    @Before
    fun allow() {
        shadowOf(context as Application).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
    }

    @Test
    fun `shows the terminal and gate as a silent, promotable ongoing notification`() {
        LiveFlightNotifications.show(context, message(), at("2026-12-12T21:00:00Z"))

        val posted = shadowOf(manager).allNotifications.single()
        posted.channelId shouldBe LiveFlightNotifications.CHANNEL_ID
        NotificationCompat.getShortCriticalText(posted) shouldBe "T3 G28"
        posted.extras.getCharSequence(Notification.EXTRA_TITLE).toString() shouldBe "XX 100 SYD to SIN"
        posted.extras.getCharSequence(Notification.EXTRA_TEXT).toString() shouldBe "Leaves at 09:00 · Departs from terminal 3, gate 28"
        NotificationCompat.isRequestPromotedOngoing(posted) shouldBe true
        NotificationCompat.hasPromotableCharacteristics(posted) shouldBe true
        manager.getNotificationChannel(LiveFlightNotifications.CHANNEL_ID).sound.shouldBeNull()
    }

    @Test
    fun `a later message replaces it and a cancellation takes it down`() {
        LiveFlightNotifications.show(context, message(), at("2026-12-12T21:00:00Z"))
        LiveFlightNotifications.show(context, message("departureGate" to "30"), at("2026-12-12T21:01:00Z"))
        NotificationCompat.getShortCriticalText(shadowOf(manager).allNotifications.single()) shouldBe "T3 G30"

        LiveFlightNotifications.show(context, message("cancelled" to "true"), at("2026-12-12T21:02:00Z"))
        shadowOf(manager).allNotifications.shouldBeEmpty()
    }

    @Test
    fun `once swiped away it stays away for that flight`() {
        LiveFlightNotifications.show(context, message(), at("2026-12-12T21:00:00Z"))
        val swiped = shadowOf(manager).allNotifications.single().deleteIntent
        manager.cancelAll()
        // What the system does on a swipe: sends the delete intent to the receiver.
        val intent = shadowOf(swiped).savedIntent
        LiveFlightDismissedReceiver().onReceive(context, intent)

        LiveFlightNotifications.show(context, message("departureGate" to "30"), at("2026-12-12T21:01:00Z"))
        shadowOf(manager).allNotifications.shouldBeEmpty()
    }

    @Test
    fun `a swipe holds through a landing delayed past the flight's first end`() {
        LiveFlightNotifications.show(context, message(), at("2026-12-12T21:00:00Z"))
        LiveFlightDismissedReceiver().onReceive(context, shadowOf(shadowOf(manager).allNotifications.single().deleteIntent).savedIntent)
        manager.cancelAll()
        // Landing two hours late (09:30Z), told while still dismissed.
        val late = arrayOf("actualOut" to "2026-12-12T22:00:00Z", "estimatedIn" to "2026-12-13T09:30:00Z")
        LiveFlightNotifications.show(context, message(*late), at("2026-12-13T07:00:00Z"))
        // Past the first end (08:15Z), before the new one (10:15Z).
        LiveFlightNotifications.show(context, message(*late), at("2026-12-13T08:30:00Z"))
        shadowOf(manager).allNotifications.shouldBeEmpty()
    }
}
