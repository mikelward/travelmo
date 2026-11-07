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
) {
    val hasDetails: Boolean get() = documents.isNotEmpty() || loyalty.isNotEmpty() || travelers.isNotEmpty()
}
