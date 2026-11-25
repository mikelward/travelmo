package app.travelmo.core

import io.kotest.matchers.collections.shouldHaveSize
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import kotlin.test.Test

// The cases of travelers.test.ts.
class TravelersTest {
    @Test
    fun `reads an airline record's surname and given name with or without a title`() {
        canonicalName("SMITH/JOHN MR") shouldBe "John Smith"
        canonicalName("SMITH/JOHNMR") shouldBe "John Smith"
        canonicalName("SMITH/JANE MS") shouldBe "Jane Smith"
        canonicalName("SMITH/SHAMS") shouldBe "Shams Smith"
        canonicalName("DOE/JANE ANNE MRS") shouldBe "Jane Anne Doe"
        canonicalName("O'NEIL-WARD/MARY MISS") shouldBe "Mary O'Neil-Ward"
    }

    @Test
    fun `reads a list's surname and given name and a greeting's title first`() {
        canonicalName("Smith, John") shouldBe "John Smith"
        canonicalName("MRS JANE DOE") shouldBe "Jane Doe"
        canonicalName("Dr. Ada Example") shouldBe "Ada Example"
    }

    @Test
    fun `keeps a name's own mixed case and tidies spacing`() {
        canonicalName("  Ronan   McDonald ") shouldBe "Ronan McDonald"
        canonicalName("josé álvarez") shouldBe "José Álvarez"
    }

    @Test
    fun `finds no name in titles or punctuation alone and leaves a name that only ends like a title`() {
        canonicalName("MR").shouldBeNull()
        canonicalName(" - ").shouldBeNull()
        canonicalName("SMITH/AMIR") shouldBe "Amir Smith"
    }

    @Test
    fun `matches a name however it is written with or without a middle name or with an initial`() {
        sameTraveler("SMITH/JOHN MR", "John Smith") shouldBe true
        sameTraveler("José Álvarez", "JOSE ALVAREZ") shouldBe true
        sameTraveler("Jane Anne Doe", "Jane Doe") shouldBe true
        sameTraveler("J Smith", "John Smith") shouldBe true
        sameTraveler("Trần An", "Tran An") shouldBe true
        sameTraveler("Søren Hansen", "Soren Hansen") shouldBe true
    }

    @Test
    fun `keeps apart different first names or the same first name in different families`() {
        sameTraveler("John Smith", "Jane Smith") shouldBe false
        sameTraveler("John Smith", "John Jones") shouldBe false
        sameTraveler("Smith", "John Smith") shouldBe false
    }

    @Test
    fun `files each name once in order and at most twenty`() {
        canonicalTravelers(listOf("SMITH/JOHN MR", "SMITH/JANE MRS", "John Smith")) shouldBe listOf("John Smith", "Jane Smith")
        canonicalTravelers(listOf("MR", " ")).shouldBeNull()
        canonicalTravelers(listOf("J Smith", "John Smith", "Jane Smith")) shouldBe listOf("John Smith", "Jane Smith")
        // MS glued on matches the name without, which is kept.
        sameTraveler("SMITH/JANEMS", "Jane Smith") shouldBe true
        canonicalTravelers(listOf("SMITH/JANEMS", "SMITH/JANE MS")) shouldBe listOf("Jane Smith")
        canonicalTravelers(listOf("SMITH/SHAMS", "Shams Smith")) shouldBe listOf("Shams Smith")
        canonicalTravelers((0 until 25).map { "Person${'A' + it} Example" })!! shouldHaveSize 20
    }

    @Test
    fun `finds someone by their name or any spelling and no one for a new name`() {
        val people = listOf(Person("me", "Sam Example", listOf("S Example"), me = true), Person("mum", "Pat Example", listOf("EXAMPLE/PATRICIA MRS")))
        findPerson(people, "EXAMPLE/SAM MR")?.id shouldBe "me"
        findPerson(people, "Patricia Example")?.id shouldBe "mum"
        findPerson(people, "Alex Example").shouldBeNull()
        findPerson(people, "MR").shouldBeNull()
    }

    @Test
    fun `finds no one through an initial when the whole first name known is another`() {
        val smiths = listOf(Person("john", "J Smith", listOf("John Smith")))
        findPerson(smiths, "Jane Smith").shouldBeNull()
        findPerson(smiths, "SMITH/JOHN MR")?.id shouldBe "john"
        findPerson(smiths, "J Smith")?.id shouldBe "john"
        findPerson(listOf(Person("j", "J Smith")), "Jane Smith")?.id shouldBe "j"
    }
}
