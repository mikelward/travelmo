package app.travelmo.data

import app.travelmo.core.AccessConfig
import app.travelmo.core.AccessRecord
import app.travelmo.core.AccountAccess
import app.travelmo.core.AddressHolder
import app.travelmo.core.ImapMailbox
import app.travelmo.core.accessDecision
import app.travelmo.core.accessSelfApproval
import app.travelmo.core.FlightStatus
import app.travelmo.core.FoundLoyalty
import kotlinx.coroutines.flow.flow
import app.travelmo.core.withLearned
import app.travelmo.core.SenderPatterns
import app.travelmo.core.SenderList
import app.travelmo.core.REVIEW_SEARCH_CAP
import app.travelmo.core.REVIEW_RECENT
import app.travelmo.core.ParsedRecord
import app.travelmo.core.HomeCorrection
import app.travelmo.core.DEFAULT_LEAD
import app.travelmo.core.Reminder
import app.travelmo.core.isReminderId
import app.travelmo.core.reminderOrNull
import app.travelmo.core.MAX_HIDDEN_RIDE_NEEDS
import app.travelmo.core.MAX_RIDE_COMPANIES
import app.travelmo.core.RideCompany
import app.travelmo.core.rideCompanyOrNull
import app.travelmo.core.sameRideCompany
import app.travelmo.core.Segment
import app.travelmo.core.SegmentDraft
import app.travelmo.core.TravelProfile
import app.travelmo.core.Trip
import app.travelmo.logging.SharedLog
import app.travelmo.logging.safe
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.map

/** What the screens read and write; Firestore in the app, a fake in tests. */
interface TripStore {
    /** The user's own trips and those shared with any of their [addresses] (SPEC "Linked email addresses"), live. */
    fun trips(uid: String, addresses: List<String>): Flow<List<Trip>>

    /** One trip's bookings, live; empty while it loads. */
    fun segments(tripId: String): Flow<List<Segment>>

    /** A flight's live gates and carousel by its key (flightStatusKey); null until the parser has looked. */
    fun flightStatus(key: String): Flow<FlightStatus?>

    /** The user's own travel profile, live, from its first answer on: an answer with no profile is one too. A read that fails is logged and keeps the caller waiting. */
    fun ownProfile(uid: String): Flow<OwnProfile>

    /** The profiles shared with any of the user's [addresses], live. */
    fun sharedProfiles(addresses: List<String>): Flow<List<TravelProfile>>

    /**
     * What the user document says of the user's addresses (those confirmed,
     * the connected Gmail, those waiting for confirmation), live; an empty
     * one when there is no document or it cannot be read.
     */
    fun addressHolder(uid: String): Flow<AddressHolder>

    /** The user's Google Calendar connection (`googleCalendar` on their user document), live; [GoogleCalendarShown.connection] null when not connected, the flow's value null while it loads. */
    fun googleCalendar(uid: String): Flow<GoogleCalendarShown?>

    /** The user's calendar export link (`users/{uid}/calendarExport/main`), live; [CalendarExportShown.token] null when they have none, the flow's value null while it loads. */
    fun calendarExport(uid: String): Flow<CalendarExportShown?>

    /** The user's calendar feeds (`users/{uid}/feeds`), oldest first, live; null while they load. */
    fun feeds(uid: String): Flow<List<CalendarFeedShown>?>

    /** The user's forwarding address (`forward.address` on their user document), live; [Forwarding.address] null when they have none, the flow's value null while it loads. */
    fun forwarding(uid: String): Flow<Forwarding?>

    /** Whether the user asked for reminders by email (`reminders.email` on their user document), live; null while it loads. */
    fun reminderEmail(uid: String): Flow<Boolean?>

    /** Turns reminders by email on or off, as the web's Settings does: a merge of `reminders.email` alone. */
    suspend fun setReminderEmail(uid: String, on: Boolean)

    /**
     * What car and ride suggestions need from the user document, live: the
     * user's own companies (`rideCompanies`, edited in Settings), the
     * suggestions they hid (`hiddenRideNeeds`) and their corrections to home
     * (`homes`); null while it loads.
     */
    fun rideSettings(uid: String): Flow<RideSettings?>

    /** Hides one ride suggestion for good, in a transaction over the stored list, as the web does. */
    suspend fun hideRideNeed(uid: String, key: String)

    /** Replaces the user's corrections to home (`homes` on their user document), as the web's Profile saves them. */
    suspend fun setHomeCorrections(uid: String, corrections: List<HomeCorrection>)

    /** Adds one of the user's own car and ride companies to the list as stored now, as the web does. */
    suspend fun addRideCompany(uid: String, company: RideCompany)

    /** Removes one of the user's own car and ride companies from the list as stored now. */
    suspend fun removeRideCompany(uid: String, company: RideCompany)

    /** Removes a loyalty number found in the owner's emails, in a transaction over the stored list, as the web does. */
    suspend fun removeFoundLoyalty(uid: String, found: FoundLoyalty)

    /** The user's reminders before every international trip (`users/{uid}/tripReminders`), in slot order; null while they load. */
    fun standingReminders(uid: String): Flow<List<Reminder>?>

    /** What the user ticked off on a trip and the one-offs they added to it; null while it loads. */
    fun myChecklist(uid: String, tripId: String): Flow<MyChecklist?>

    /**
     * Writes a reminder to its [Reminder.slot], or a new one (blank slot) to
     * the first free one, each read in the transaction before it is taken:
     * a standing one with no [tripId], else a one-off on that trip.
     */
    suspend fun saveReminder(uid: String, tripId: String?, reminder: Reminder)

    suspend fun removeReminder(uid: String, tripId: String?, slot: String)

    /** Ticks a reminder off for a trip, or not, in a transaction over the stored list, as the web does. */
    suspend fun setReminderDone(uid: String, tripId: String, id: String, done: Boolean)

    /**
     * The Gmail mailboxes the user connected (`gmails` on their user
     * document), oldest first, each with how far the last reading of it got,
     * live; empty when none is connected or the document cannot be read. A
     * source email opens in the one it came from, as on the web.
     */
    fun gmailStatuses(uid: String): Flow<List<GmailStatus>>

    /** The Fastmail connection (`fastmail` on the user document) and how far the last reading of it got, live; null when not connected. */
    fun fastmailStatus(uid: String): Flow<FastmailStatus?>

    /** The mailboxes connected over IMAP (`imaps` on the user document), oldest first, each with how far its last reading got, live; empty when none. */
    fun imapStatuses(uid: String): Flow<List<ImapMailbox>>

    /** The [REVIEW_RECENT] import records read last, newest first, live; null while they load. */
    fun latestParsed(uid: String): Flow<List<ParsedRecord>?>

    /**
     * Every import record, newest first, read once in pages for a search, up
     * to [REVIEW_SEARCH_CAP]: each page emits what has been read so far, the
     * last with `done`. A failed page ends it with what was read.
     */
    fun allParsed(uid: String): Flow<SearchedRecords>

    /** The user's sender rules, live; empty when they have none. */
    fun senderPatterns(uid: String): Flow<SenderPatterns>

    /** Teaches the parser a sender ([withLearned]), on the rules as stored now. */
    suspend fun learnSender(uid: String, domain: String, which: SenderList)

    /** Replaces both lists of sender rules, as the web's Settings saves them. */
    suspend fun setSenderPatterns(uid: String, patterns: SenderPatterns)

    /** Says whose a membership is ([person] null: the owner's), as the web's setLoyaltyPerson. */
    suspend fun setLoyaltyPerson(uid: String, program: String, number: String, person: String?)

    /** Whether this phone (`users/{uid}/devices/{id}`) is registered for reminders as notifications, live; null while it loads. */
    fun pushDevice(uid: String, id: String): Flow<Boolean?>

    /** Registers this phone's token under the user and turns `reminders.push` on, as a browser's subscribe does. */
    suspend fun registerDevice(uid: String, id: String, token: String)

    /** Forgets this phone; `reminders.push` goes off with the last phone when no browser is subscribed either. */
    suspend fun unregisterDevice(uid: String, id: String)

    /** A refreshed token: the new registration in, then the old out, so delivery never lapses. */
    suspend fun replaceDevice(uid: String, oldId: String, newId: String, token: String)

    /**
     * Sets who the user's travel profile is shared with, starting the profile
     * if there is none yet ([exists] false), and invites each address not in
     * [before] in the same batch (SPEC "Access", "Sharing invites").
     */
    suspend fun saveTrusted(uid: String, email: String?, exists: Boolean, emails: List<String>, before: List<String> = emptyList())

    /**
     * Whether `users/{uid}` exists (null when it doesn't) and what it says of
     * the user's addresses, live, as access is decided on it (SPEC "Access").
     * A read that fails answers as no document.
     */
    fun userDocument(uid: String): Flow<Seen<AddressHolder?>>

    /** The verified address's `access/{email}`, live; null when there is none or it can't be read. */
    fun accessRecord(email: String): Flow<Seen<AccessRecord?>>

    /** `config/access`, live; null for everyone but admins, whom alone the rules let read it. */
    fun accessConfig(): Flow<Seen<AccessConfig?>>

    /** Every access record, live, for the Access page (admins alone may list them); null while they load. */
    fun accessRecords(): Flow<List<AccessRecord>?>


    /** Records an account from before approvals as approved by itself, so admins see it (accessSelfApproval). */
    suspend fun recordSelf(email: String, uid: String, now: String)

    /** An admin's decision on [email]: approve (or invite an address that never asked), decline or revoke (accessDecision). */
    suspend fun decideAccess(email: String, decision: AccountAccess, adminUid: String, now: String)

    /** Writes a booking, new ([existingId] null) or edited, widening the trip's dates to hold it. */
    suspend fun saveSegment(tripId: String, draft: SegmentDraft, existingId: String?)

    suspend fun deleteSegment(tripId: String, segmentId: String)

    /** Takes back a cancellation an email set, widening the trip to hold the booking again. */
    suspend fun restoreSegment(tripId: String, segmentId: String)

    /** The owner's powers over a trip, as the web's edits.ts has them. */
    suspend fun renameTrip(tripId: String, title: String)

    /** Sets the trip's dates to its bookings' span; false when it has none. Owner only. */
    suspend fun fitTripDates(tripId: String): Boolean

    /**
     * Shares the trip with an address, inviting it in the same batch as
     * [inviterUid] (SPEC "Access", "Sharing invites"), or stops. Owner only.
     */
    suspend fun shareTrip(tripId: String, email: String, inviterUid: String)

    suspend fun unshareTrip(tripId: String, email: String)

    /** Marks the trip deleting, removes its bookings, then the trip; safe to call again if interrupted. Owner only. */
    suspend fun deleteTrip(tripId: String)

    /** Moves a booking to another trip the viewer can edit, keeping its id; the target widens to hold it. */
    suspend fun moveSegment(fromTripId: String, segmentId: String, toTripId: String)

    /** Moves every booking of the source into the target and deletes the source; how many moved. Owner of the source only. */
    suspend fun mergeTrips(sourceId: String, targetId: String): Int
}

class TripGoneException(message: String) : Exception(message)

/**
 * A document's answer, and whether the server gave it rather than this
 * phone's cache: a document missing from the cache may only be missing from
 * the cache, so "not approved" waits for the server's word (as the web's
 * useAccess does).
 */
data class Seen<T>(val value: T, val confirmed: Boolean)

/** One of the connected account's calendars, whether it is read, and what its last read did. */
data class GoogleCalendarChoice(
    val id: String,
    val summary: String,
    val selected: Boolean,
    val lastReadAt: String? = null,
    val lastResult: String? = null,
    val lastError: String? = null,
)

/** The connected Google account and its calendars. */
data class GoogleCalendarConnection(val emailAddress: String, val calendars: List<GoogleCalendarChoice>)

/** The user's Google Calendar connection, when there is one. */
data class GoogleCalendarShown(val connection: GoogleCalendarConnection?)

/** `googleCalendar` on the user document, as the parser writes it; a calendar without an id is left out. */
fun googleCalendarOf(data: Map<String, Any?>?): GoogleCalendarShown {
    val map = data?.get("googleCalendar") as? Map<*, *> ?: return GoogleCalendarShown(null)
    val email = map["emailAddress"] as? String ?: return GoogleCalendarShown(null)
    val calendars = (map["calendars"] as? List<*>).orEmpty().mapNotNull { entry ->
        val c = entry as? Map<*, *> ?: return@mapNotNull null
        val id = (c["id"] as? String)?.takeIf { it.isNotEmpty() } ?: return@mapNotNull null
        GoogleCalendarChoice(id, c["summary"] as? String ?: id, c["selected"] == true, c["lastReadAt"] as? String, c["lastResult"] as? String, c["lastError"] as? String)
    }
    return GoogleCalendarShown(GoogleCalendarConnection(email, calendars))
}

/** The user's calendar export token, when they have one. */
data class CalendarExportShown(val token: String?)

/** `users/{uid}/calendarExport/main` as the parser writes it; a token shorter than the web's schema allows is none. */
fun calendarExportOf(data: Map<String, Any?>?): CalendarExportShown =
    CalendarExportShown((data?.get("token") as? String)?.takeIf { it.length >= 20 })

/** A calendar feed as Settings lists it: the link's label or host, and what its last read did. */
data class CalendarFeedShown(
    val id: String,
    val url: String,
    val label: String? = null,
    val lastFetchedAt: String? = null,
    val lastResult: String? = null,
    val lastError: String? = null,
) {
    /** The feed's own label, else the host of its link. */
    val name: String
        get() = label ?: urlHost(url) ?: url
}

/** The host a link names, "calendar.example" in "https://user@calendar.example:443/x.ics"; null when it names none. */
fun urlHost(url: String): String? =
    Regex("""^[A-Za-z][A-Za-z0-9+.-]*://(?:[^/?#@]*@)?([^/?#:]+)""").find(url)?.groupValues?.get(1)?.takeIf { it.isNotEmpty() }

/** One `users/{uid}/feeds` document as the parser writes it; null without a link. */
fun calendarFeedOf(id: String, data: Map<String, Any?>?): CalendarFeedShown? {
    val url = data?.get("url") as? String ?: return null
    return CalendarFeedShown(id, url, data["label"] as? String, data["lastFetchedAt"] as? String, data["lastResult"] as? String, data["lastError"] as? String)
}

/** The user's forwarding address, when they have one. */
data class Forwarding(val address: String?)

/** `forward.address` on the user document, as the parser writes it. */
fun forwardingOf(data: Map<String, Any?>?): Forwarding =
    Forwarding(((data?.get("forward") as? Map<*, *>)?.get("address") as? String)?.takeIf { it.length >= 3 })

/** The user document's fields for car and ride suggestions (SPEC "Car and ride suggestions"). */
data class RideSettings(
    val companies: List<RideCompany> = emptyList(),
    val hidden: List<String> = emptyList(),
    val homes: List<HomeCorrection> = emptyList(),
)

private fun storedCompany(entry: Any?): RideCompany? {
    val map = entry as? Map<*, *> ?: return null
    return rideCompanyOrNull(map["name"] as? String, map["url"] as? String, map["near"] as? String, map["countries"] as? List<*>)
}

/**
 * The stored `rideCompanies` with [company] added, or null when it is there
 * already. Every other entry stays as stored, even one this app cannot
 * read: the web's schema may take it, and the list is the user's.
 */
fun rideCompaniesAdding(stored: List<*>, company: RideCompany): List<Any?>? {
    val known = stored.mapNotNull(::storedCompany)
    if (known.any { sameRideCompany(it, company) }) return null
    // Every stored entry counts towards the limit, as the rules count them.
    check(stored.size < MAX_RIDE_COMPANIES) { "At most $MAX_RIDE_COMPANIES." }
    val entry = mapOf("name" to company.name, "url" to company.url, "near" to company.near.wire)
    return stored + if (company.countries.isEmpty()) entry else entry + ("countries" to company.countries)
}

/** The stored `rideCompanies` without [company], every other entry as stored; null when it isn't there. */
fun rideCompaniesRemoving(stored: List<*>, company: RideCompany): List<Any?>? {
    val kept = stored.filterNot { entry -> storedCompany(entry)?.let { sameRideCompany(it, company) } == true }
    return if (kept.size == stored.size) null else kept
}

/** The fields as stored; an entry that does not parse is left out, as on the web. */
fun rideSettingsOf(data: Map<String, Any?>?): RideSettings {
    val companies = (data?.get("rideCompanies") as? List<*>).orEmpty().mapNotNull { entry ->
        val map = entry as? Map<*, *> ?: return@mapNotNull null
        rideCompanyOrNull(map["name"] as? String, map["url"] as? String, map["near"] as? String, map["countries"] as? List<*>)
    }
    val hidden = (data?.get("hiddenRideNeeds") as? List<*>).orEmpty().filterIsInstance<String>()
    val homes = (data?.get("homes") as? List<*>).orEmpty().mapNotNull { entry ->
        val map = entry as? Map<*, *> ?: return@mapNotNull null
        val city = (map["city"] as? String)?.trim()?.takeIf { it.isNotEmpty() } ?: return@mapNotNull null
        // A date that isn't one would throw where home is worked out.
        val from = (map["from"] as? String)?.takeIf { isCalendarDate(it) } ?: return@mapNotNull null
        HomeCorrection(city, (map["country"] as? String)?.takeIf { it.length == 2 }, from)
    }
    return RideSettings(companies, hidden, homes)
}

private fun isCalendarDate(text: String): Boolean = try {
    kotlinx.datetime.LocalDate.parse(text)
    true
} catch (e: IllegalArgumentException) {
    // Left out, as the web's schema leaves it out; logged without the value.
    SharedLog.warning("A home correction with a malformed date was left out")
    false
}

/** The hidden list with [key] added, keeping the newest when it is full. */
fun withHidden(hidden: List<String>, key: String): List<String> = (hidden.filter { it != key } + key).takeLast(MAX_HIDDEN_RIDE_NEEDS)

/** The user's own state for a trip's reminders: the ids they ticked off and the one-offs they added. */
data class MyChecklist(val done: List<String> = emptyList(), val added: List<Reminder> = emptyList())

/** A reminder from its slot's document, or null (logged by slot alone) when it does not parse, as the web leaves it out. */
fun reminderOf(slot: String, data: Map<String, Any?>?, dated: Boolean): Reminder? {
    val reminder = reminderOrNull(
        slot,
        data?.get("id") as? String,
        data?.get("text") as? String,
        data?.get("amount") as? Number,
        data?.get("unit") as? String,
        data?.get("date") as? String,
        dated,
    )
    if (reminder == null) SharedLog.warning("A reminder that does not parse was left out: %s", safe(slot))
    return reminder
}

/** A reminder's stored fields, as the rules check them. */
fun reminderFields(reminder: Reminder, now: String): Map<String, Any> =
    mapOf("id" to reminder.id, "text" to reminder.text, "createdAt" to now) +
        (reminder.date?.let { mapOf("date" to it) } ?: reminder.lead.let { lead -> mapOf("amount" to (lead ?: DEFAULT_LEAD).amount, "unit" to (lead ?: DEFAULT_LEAD).unit.wire) })

/** The ticked ids as stored, those that are not ids left out. */
fun doneOf(data: Map<String, Any?>?): List<String> =
    (data?.get("done") as? List<*>).orEmpty().filterIsInstance<String>().filter(::isReminderId)

/** What the profile document answered: the profile, or none yet. Distinct from not having answered at all. */
data class OwnProfile(val profile: TravelProfile?)

/**
 * The same queries the web app makes (SPEC.md "The trip list"), each a
 * snapshot listener, so a change made elsewhere shows up on its own and
 * Firestore's own cache answers them offline.
 */
/** What a search has read so far, and whether it has read them all. */
data class SearchedRecords(val records: List<ParsedRecord>, val done: Boolean)
