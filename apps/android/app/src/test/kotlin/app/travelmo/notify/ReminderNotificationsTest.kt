package app.travelmo.notify

import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.MainActivity
import io.kotest.matchers.shouldBe
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** Where a tapped notification goes: an admin's access request to the Access page in the app, an airline's site to the browser. */
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
}
