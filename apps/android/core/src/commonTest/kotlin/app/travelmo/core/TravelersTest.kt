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

    @Test
    fun `matches a first and middle name run together or with the middle one an initial`() {
        sameTraveler("MIKELBRADLEE WARD", "Mikel Bradlee Ward") shouldBe true
        sameTraveler("Mikel Bradlee Ward", "WARD/MIKELB MR") shouldBe true
        sameTraveler("Anna Maria Lena Berg", "Annamarial Berg") shouldBe true
        sameTraveler("Mikelb Ward", "Mikel Ward") shouldBe false
        sameTraveler("Mikela Ward", "Mikel Bradlee Ward") shouldBe false
        canonicalTravelers(listOf("MIKELBRADLEE WARD", "Mikel Bradlee Ward")) shouldBe listOf("Mikel Bradlee Ward")
        sameTraveler("John Smith Jr", "John Smith") shouldBe false
    }

    @Test
    fun `merges two people keeping one name and every other spelling once`() {
        val ward = Person("p1", "Jessica Ward", aliases = listOf("J Ward"))
        val wilkes = Person("p2", "Jessica Wilkes", aliases = listOf("WILKES/JESSICA MS", "J Ward"))
        val merged = mergedPerson(ward, wilkes, me = false)
        merged.name shouldBe "Jessica Ward"
        merged.aliases shouldBe listOf("J Ward", "Jessica Wilkes", "WILKES/JESSICA MS")
        merged.me shouldBe false
        mergedPerson(ward, wilkes, me = true).me shouldBe true
        findPerson(listOf(merged), "Jessica Wilkes")?.id shouldBe "p1"
        mergedPerson(ward, wilkes.copy(aliases = List(60) { "J$it Wilkes" }), me = false).aliases.let {
            it shouldHaveSize 50
            it.last() shouldBe "J59 Wilkes"
        }
    }

    @Test
    fun `adds a spelling once`() {
        val me = Person("p1", "Mikel Ward", aliases = listOf("MIKEL WARD"))
        withAlias(me, " Michael Ward ") shouldBe listOf("MIKEL WARD", "Michael Ward")
        withAlias(me, "MIKEL WARD") shouldBe me.aliases
        withAlias(me, "Mikel Ward") shouldBe me.aliases
    }
}
