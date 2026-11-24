package app.travelmo.notify

import android.Manifest
import android.app.Application
import android.app.Notification
import android.app.NotificationManager
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.MainActivity
import app.travelmo.R
import io.kotest.matchers.shouldBe
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * Which channel a notification lands in, and where a tapped one goes: an
 * admin's access request to the Access page in the app, an airline's site
 * to the browser.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36])
class ReminderNotificationsTest {
    private val context = ApplicationProvider.getApplicationContext<android.content.Context>()

    @Test
    fun `a trip opens in the app and an airline's site in the browser`() {
        ReminderNotifications.tapIntent(context, "https://travelmo.example/trips/dublin", "reminder-dublin").component?.className shouldBe MainActivity::class.java.name
        val airline = ReminderNotifications.tapIntent(context, "https://airline.example/access", "checkin-t1-s1")
        airline.action shouldBe Intent.ACTION_VIEW
        airline.dataString shouldBe "https://airline.example/access"
    }

    @Test
    fun `flight news interrupts with the chime and reminders do not`() {
        shadowOf(context as Application).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        ReminderNotifications.show(context, "BA 117 LHR to JFK", "Now departs from terminal 5, gate B32 (was gate A10)", "https://travelmo.example/trips/nyc", "flight-BA117-2026-12-01")
        ReminderNotifications.show(context, "Before your trip to Paris", "Your passport runs out too soon.", "https://travelmo.example/trips/paris", "reminder-paris")

        val manager = context.getSystemService(NotificationManager::class.java)
        val posted = shadowOf(manager).allNotifications.associate { it.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() to it.channelId }
        posted shouldBe mapOf("BA 117 LHR to JFK" to ReminderNotifications.FLIGHT_CHANNEL_ID, "Before your trip to Paris" to ReminderNotifications.CHANNEL_ID)

        val flights = manager.getNotificationChannel(ReminderNotifications.FLIGHT_CHANNEL_ID)
        flights.importance shouldBe NotificationManager.IMPORTANCE_HIGH
        flights.sound.toString() shouldBe "android.resource://${context.packageName}/raw/flight_chime"
        // The name resolves to the bundled chime.
        context.resources.getIdentifier("flight_chime", "raw", context.packageName) shouldBe R.raw.flight_chime
        manager.getNotificationChannel(ReminderNotifications.CHANNEL_ID).importance shouldBe NotificationManager.IMPORTANCE_DEFAULT
    }

    @Test
    fun `a check-in reminder offers I've checked in and other reminders do not`() {
        shadowOf(context as Application).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        ReminderNotifications.show(context, "Check in for XX 100 to Dubai", "Online check-in is open.", "https://airline.example/", "checkin-t1-f1", ReminderNotifications.CheckedInTarget("t1", "f1"))
        ReminderNotifications.show(context, "Before your trip to Paris", "Your passport runs out too soon.", "https://travelmo.example/trips/paris", "reminder-paris")

        val manager = context.getSystemService(NotificationManager::class.java)
        val byTitle = shadowOf(manager).allNotifications.associateBy { it.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() }
        byTitle.getValue("Before your trip to Paris").actions shouldBe null
        val action = byTitle.getValue("Check in for XX 100 to Dubai").actions.single()
        action.title.toString() shouldBe "I’ve checked in"
        val sent = shadowOf(action.actionIntent).savedIntent
        sent.component?.className shouldBe CheckedInReceiver::class.java.name
        sent.getStringExtra(CheckedInReceiver.EXTRA_TRIP_ID) shouldBe "t1"
        sent.getStringExtra(CheckedInReceiver.EXTRA_SEGMENT_ID) shouldBe "f1"
        sent.getStringExtra(CheckedInReceiver.EXTRA_TAG) shouldBe "checkin-t1-f1"
    }
}
