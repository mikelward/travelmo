package app.travelmo.core

/**
 * Which of the user's people is the user (guessMe in travelers.ts): the one
 * they said, else the one most often named on emails sent straight to them,
 * then on any booking; none before any booking named anyone.
 */
fun guessMe(people: List<Person>): Person? =
    people.firstOrNull { it.me } ?: people.sortedWith(compareByDescending<Person> { it.direct }.thenByDescending { it.bookings }.thenBy { it.name }).firstOrNull()

/** The people as Profile lists them: most often named first. */
fun peopleInOrder(people: List<Person>): List<Person> = people.sortedWith(compareByDescending<Person> { it.bookings }.thenBy { it.name })
