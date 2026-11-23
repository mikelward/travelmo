package app.travelmo.core

// The traveler's profile (users/{uid}/travelProfile/main): what a TripIt
// export said about them, kept as labeled values in whatever order and
// wording the import used (SPEC.md "Data model"). The owner alone chooses
// who else may read it, by verified email.

data class ProfileField(val label: String, val value: String)

data class ProfileEntry(val title: String, val fields: List<ProfileField>)

data class TravelProfile(
    val ownerUid: String,
    val ownerEmail: String? = null,
    val trustedEmails: List<String> = emptyList(),
    val travelers: List<ProfileEntry> = emptyList(),
    val loyalty: List<ProfileEntry> = emptyList(),
    val documents: List<ProfileEntry> = emptyList(),
    /** Loyalty memberships read from the owner's booking emails ([allLoyalty]). */
    val foundLoyalty: List<FoundLoyalty> = emptyList(),
) {
    val hasDetails: Boolean get() = documents.isNotEmpty() || loyalty.isNotEmpty() || foundLoyalty.isNotEmpty() || travelers.isNotEmpty()
}

/** A loyalty membership read from one of the owner's booking emails, and the email it was last seen in. */
data class FoundLoyalty(
    val program: String,
    val number: String,
    val holder: String? = null,
    val status: String? = null,
    val messageId: String,
    val label: String? = null,
    val at: String,
)

/** How many people a profile may be shared with, as the rules allow. */
const val MAX_TRUSTED = 20

/** One address per person, lowercased as the rules compare them; the owner themself is never on their own list. */
fun normalizeTrusted(emails: List<String>, ownEmail: String?): List<String> {
    val own = ownEmail?.lowercase()
    return emails.map { it.trim().lowercase() }.filter { it.contains("@") && it != own }.distinct()
}
