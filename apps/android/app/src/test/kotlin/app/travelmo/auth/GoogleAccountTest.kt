package app.travelmo.auth

import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.test.ext.junit.runners.AndroidJUnit4
import app.travelmo.log.TravelmoLog
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import io.kotest.matchers.string.shouldNotContain
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

@RunWith(AndroidJUnit4::class)
@Config(sdk = [36])
class GoogleAccountTest {
    private val account = GoogleAccount(firebaseAvailable = { false }, webClientId = null)

    @Test
    fun `a cancellation stays quiet on screen and logs Play services' status code alone`() {
        val result = account.failure(GetCredentialCancellationException("[16] Account reauth failed for someone@example.com."))
        result shouldBe SignInResult.Canceled
        val log = TravelmoLog.snapshot().joinToString("\n")
        log shouldContain "Sign-in canceled, status 16"
        log shouldNotContain "example.com"
    }

    @Test
    fun `a message without a status code logs none`() {
        playServicesStatus("activity is cancelled by the user.") shouldBe "none"
        playServicesStatus(null) shouldBe "none"
        playServicesStatus(" [10] Developer console is not set up correctly.") shouldBe "10"
    }
}
