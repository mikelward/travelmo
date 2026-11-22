package app.travelmo.ui

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.mikelward.androidzoom.FontSizeSettings
import io.kotest.matchers.shouldBe
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/** Where the text size is kept, and the in-memory value every screen draws at. */
@RunWith(AndroidJUnit4::class)
@Config(sdk = [36])
class TextSizeSettingTest {
    private val context: Context get() = ApplicationProvider.getApplicationContext()
    private val prefs get() = context.getSharedPreferences("text_size", Context.MODE_PRIVATE)

    @Before
    fun reset() {
        prefs.edit().clear().commit()
        TextSizeSetting.resetForTest()
    }

    @After
    fun leaveDefaults() = reset()

    @Test
    fun `nothing stored is the system's size with pinch on`() {
        TextSizeStore(context).read() shouldBe FontSizeSettings(scale = 1f, pinchEnabled = true)
        TextSizeSetting.current shouldBe FontSizeSettings(scale = 1f, pinchEnabled = true)
    }

    @Test
    fun `a stored size outside the range is clamped on read`() {
        prefs.edit().putFloat("scale", 3f).commit()
        TextSizeStore(context).read().scale shouldBe 1.6f
        prefs.edit().putFloat("scale", 0.1f).commit()
        TextSizeStore(context).read().scale shouldBe 0.8f
        prefs.edit().putFloat("scale", Float.NaN).commit()
        TextSizeStore(context).read().scale shouldBe 1f
    }

    @Test
    fun `a chosen size is in force at once and stored`() {
        TextSizeSetting.setScale(context, 1.3f)
        TextSizeSetting.current.scale shouldBe 1.3f
        TextSizeStore(context).read().scale shouldBe 1.3f
        TextSizeSetting.saveFailed shouldBe false
    }

    @Test
    fun `a size past the end is stored at the end`() {
        TextSizeSetting.setScale(context, 2f)
        TextSizeSetting.current.scale shouldBe 1.6f
        TextSizeStore(context).read().scale shouldBe 1.6f
    }

    @Test
    fun `turning pinch off keeps the size and is stored`() {
        TextSizeSetting.setScale(context, 1.2f)
        TextSizeSetting.setPinchEnabled(context, false)
        TextSizeStore(context).read() shouldBe FontSizeSettings(scale = 1.2f, pinchEnabled = false)
    }

    @Test
    fun `warming reads the stored size`() {
        TextSizeStore(context).write(FontSizeSettings(scale = 1.4f, pinchEnabled = false))
        TextSizeSetting.warm(context)
        TextSizeSetting.current shouldBe FontSizeSettings(scale = 1.4f, pinchEnabled = false)
    }

    @Test
    fun `a warm read landing after a choice keeps the choice`() {
        TextSizeStore(context).write(FontSizeSettings(scale = 1.4f, pinchEnabled = true))
        val queued = mutableListOf<Runnable>()
        TextSizeSetting.dispatch = { queued += it }
        TextSizeSetting.warm(context)
        TextSizeSetting.setScale(context, 0.9f)
        queued.forEach { it.run() }
        TextSizeSetting.current.scale shouldBe 0.9f
        TextSizeStore(context).read().scale shouldBe 0.9f
    }

    @Test
    fun `a refused write stays in force and says it wasn't saved`() {
        TextSizeSetting.storeFor = { { false } }
        TextSizeSetting.setScale(context, 1.5f)
        TextSizeSetting.current.scale shouldBe 1.5f
        TextSizeSetting.saveFailed shouldBe true
    }

    @Test
    fun `a write that throws is logged as not saved`() {
        TextSizeSetting.storeFor = { { throw IllegalStateException("disk full") } }
        TextSizeSetting.setScale(context, 1.5f)
        TextSizeSetting.saveFailed shouldBe true
    }

    @Test
    fun `a read that throws leaves the system's size`() {
        TextSizeSetting.readerFor = { { throw IllegalStateException("unreadable") } }
        TextSizeSetting.warm(context)
        TextSizeSetting.current.scale shouldBe 1f
    }
}
