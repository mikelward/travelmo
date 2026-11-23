package app.travelmo.core

import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import kotlin.test.Test

class ParserTest {
    @Test
    fun `joins the parser's address and a path with one slash`() {
        parserEndpoint("https://parser.example.com", ACCOUNT_DELETE_PATH) shouldBe "https://parser.example.com/account/delete"
        parserEndpoint("https://parser.example.com/", ACCOUNT_DELETE_PATH) shouldBe "https://parser.example.com/account/delete"
        parserEndpoint(" https://parser.example.com// ", "account/delete") shouldBe "https://parser.example.com/account/delete"
    }

    @Test
    fun `has no endpoint without an address`() {
        parserEndpoint(null, ACCOUNT_DELETE_PATH).shouldBeNull()
        parserEndpoint("", ACCOUNT_DELETE_PATH).shouldBeNull()
        parserEndpoint("  ", ACCOUNT_DELETE_PATH).shouldBeNull()
    }

    @Test
    fun `says why a deletion failed in words with the status where it helps`() {
        accountDeletionFailure(null) shouldContain "Check your connection"
        accountDeletionFailure(401) shouldContain "sign in again"
        accountDeletionFailure(403) shouldContain "sign in again"
        accountDeletionFailure(500) shouldBe "Couldn't delete your account (error 500). Try again."
    }
}
