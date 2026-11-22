package app.travelmo.update

import android.app.Application
import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.android.gms.tasks.Tasks
import com.google.android.play.core.appupdate.AppUpdateManager
import com.google.android.play.core.appupdate.testing.FakeAppUpdateManager
import io.kotest.matchers.shouldBe
import java.lang.reflect.Proxy
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * [PlayUpdateChecker] against Play's own [FakeAppUpdateManager], as in
 * stopdash: no real Play, no network. Play's callbacks land on the main
 * looper, so each check is flushed with [idle] before asserting.
 */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36])
class PlayUpdateCheckerTest {
    private val app: Application = ApplicationProvider.getApplicationContext()

    private fun checker(manager: AppUpdateManager, checksEnabled: Boolean = true) =
        PlayUpdateChecker(app, appUpdateManager = manager, checksEnabled = checksEnabled)

    private fun idle() = shadowOf(Looper.getMainLooper()).idle()

    @Test
    fun `reports an update when Play has one`() {
        val fake = FakeAppUpdateManager(app).apply { setUpdateAvailable(101) }
        var result: Boolean? = null
        checker(fake).checkForUpdate { result = it }
        idle()
        result shouldBe true
    }

    @Test
    fun `reports none when Play has none`() {
        val fake = FakeAppUpdateManager(app)
        var result: Boolean? = null
        checker(fake).checkForUpdate { result = it }
        idle()
        result shouldBe false
    }

    @Test
    fun `a failed check reports none`() {
        // Play's fake can't fail its check, so this manager's check fails
        // and nothing else is expected to be called.
        val failing = Proxy.newProxyInstance(AppUpdateManager::class.java.classLoader, arrayOf(AppUpdateManager::class.java)) { _, method, _ ->
            if (method.name != "getAppUpdateInfo") throw UnsupportedOperationException(method.name)
            Tasks.forException<Any>(IllegalStateException("Play is not available"))
        } as AppUpdateManager
        var result: Boolean? = null
        checker(failing).checkForUpdate { result = it }
        idle()
        result shouldBe false
    }

    @Test
    fun `a debug build reports none without asking Play`() {
        // Synchronously, so before Play could have answered.
        val fake = FakeAppUpdateManager(app).apply { setUpdateAvailable(101) }
        var result: Boolean? = null
        checker(fake, checksEnabled = false).checkForUpdate { result = it }
        result shouldBe false
    }

    @Test
    fun `an older check cannot overwrite a newer answer`() {
        val fake = FakeAppUpdateManager(app).apply { setUpdateAvailable(101) }
        val checker = checker(fake)
        val results = mutableListOf<Boolean>()
        checker.checkForUpdate { results += it }
        checker.checkForUpdate { results += it }
        idle()
        results shouldBe listOf(true)
    }
}
