package app.travelmo.core

import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import kotlin.test.Test

class PeopleTest {
    @Test
    fun `the user is whoever they said`() {
        guessMe(listOf(Person("a", "a", bookings = 9, direct = 9), Person("b", "b", me = true, bookings = 1)))?.id shouldBe "b"
    }

    @Test
    fun `else whoever emails sent straight to the user name most then any booking`() {
        guessMe(listOf(Person("mum", "Pat", bookings = 9), Person("me", "Sam", bookings = 4, direct = 4)))?.id shouldBe "me"
        guessMe(listOf(Person("a", "a", bookings = 2), Person("b", "b", bookings = 5)))?.id shouldBe "b"
        guessMe(emptyList()).shouldBeNull()
    }
}
