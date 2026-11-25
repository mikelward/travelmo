package app.travelmo.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.travelmo.core.Place
import app.travelmo.core.ProfileEntry
import app.travelmo.core.Segment
import app.travelmo.core.SenderList
import app.travelmo.core.SourceRef
import app.travelmo.core.allLoyalty
import app.travelmo.core.effectiveDecision
import app.travelmo.core.emailLinkFor
import app.travelmo.core.formatDate
import app.travelmo.core.localDate
import app.travelmo.core.isCancelled
import app.travelmo.core.loyaltyLine
import app.travelmo.core.mapsUrl
import app.travelmo.core.programsFor
import app.travelmo.core.routeLine
import app.travelmo.core.sharedWithAny
import app.travelmo.core.timesLine
import app.travelmo.shared.Res
import app.travelmo.shared.booking_for
import app.travelmo.shared.booking_gone
import app.travelmo.shared.booking_reference
import app.travelmo.shared.cancelled
import app.travelmo.shared.copy_reference
import app.travelmo.shared.edit
import app.travelmo.shared.ref_value
import app.travelmo.shared.show_in_maps
import app.travelmo.shared.sources
import app.travelmo.shared.trip_loading
import org.jetbrains.compose.resources.stringResource

/**
 * One booking in full, opened by tapping its row: what the row shows, then
 * its places (a tap shows one in Maps), provider, reference (a tap copies
 * it), travelers, the viewer's loyalty programs, notes and sources. The ✎
 * edits it, for those who may. Leaves by [onBack] once the booking is gone
 * from the trip, and by [onTripGone] once the trip is.
 */
@Composable
fun BookingDetailScreen(
    viewModel: TripsViewModel,
    tripId: String,
    segmentId: String,
    uid: String,
    onBack: () -> Unit,
    onEdit: () -> Unit,
    onTripGone: () -> Unit,
) {
    val tripFlow = remember(tripId) { viewModel.trip(tripId) }
    val segmentsFlow = remember(tripId) { viewModel.segments(tripId) }
    val trip by tripFlow.collectAsStateWithLifecycle(initialValue = null)
    val segments by segmentsFlow.collectAsStateWithLifecycle(initialValue = null)
    val addresses by viewModel.addresses.collectAsStateWithLifecycle()
    val ownProfile by viewModel.ownProfile.collectAsStateWithLifecycle()
    val gmailMailboxes by viewModel.gmailMailboxes.collectAsStateWithLifecycle()
    val patterns by viewModel.senderPatterns.collectAsStateWithLifecycle()
    val cleanup by viewModel.senderCleanup.collectAsStateWithLifecycle()
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    val segment = segments?.firstOrNull { it.id == segmentId }
    val current = trip
    val isOwner = current != null && current.ownerUid == uid
    val canEdit = current != null && !current.deleting && (isOwner || sharedWithAny(current.sharedWith, addresses))

    val prefix = "booking/$tripId/$segmentId/"
    val mine = outcomes.filterKeys { it.startsWith(prefix) }
    // A sender cleanup started here says itself where to go once done: deleting a whole trip
    // takes its bookings first, so the booking going is no sign the trip is staying.
    // Waits until its outcome is read below, as well as while it runs.
    val cleaningUp = mine.any { (token, outcome) -> outcome !is Outcome.Failed && token.startsWith("${prefix}sender-cleanup/") }

    // Once seen, a booking deleted, moved or cleaned up meanwhile takes the page back to its trip; a trip gone takes it further.
    var seen by rememberSaveable(segmentId) { mutableStateOf(false) }
    // Left once only, however many of the signals below arrive.
    var left by remember { mutableStateOf(false) }
    val leave = { away: () -> Unit -> if (!left) { left = true; away() } }
    LaunchedEffect(segment != null, current != null, segments != null, cleaningUp) {
        when {
            segment != null -> seen = true
            !seen || segments == null || cleaningUp -> Unit
            current == null -> leave(onTripGone)
            else -> leave(onBack)
        }
    }

    LaunchedEffect(mine) {
        for ((token, outcome) in mine) {
            if (outcome !is Outcome.Done) continue
            viewModel.outcomeSeen(token)
            if (token.removePrefix(prefix) == "sender-cleanup/leave") leave(onTripGone)
        }
    }
    Scaffold(
        topBar = {
            AppTopBar(
                segment?.type?.label ?: "",
                navigation = TopBarNavigation.Back(onBack),
                actions = {
                    if (canEdit && segment != null) {
                        IconButton(onClick = onEdit) { Icon(Icons.Filled.Edit, contentDescription = stringResource(Res.string.edit)) }
                    }
                },
            )
        },
    ) { padding ->
        SenderCleanupDialog(viewModel, cleanup) { plan ->
            val leave = if (plan.trips.any { it.id == tripId }) "leave" else "stay"
            viewModel.removeSenderBookings("${prefix}sender-cleanup/$leave")
        }
        if (segment == null) {
            val text = if (segments == null) Res.string.trip_loading else Res.string.booking_gone
            Text(stringResource(text), color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(padding).padding(16.dp))
            return@Scaffold
        }
        BookingDetails(
            segment,
            programs = programsFor(segment.provider, ownProfile?.let(::allLoyalty).orEmpty()),
            emailLink = { source -> emailLinkFor(source, uid, ownsTrip = isOwner, mailboxes = gmailMailboxes) },
            errors = mine.values.mapNotNull { (it as? Outcome.Failed)?.message },
            // Sender rules are the viewer's own, so the offers stand for the owner only: the import ran against their mailbox.
            senderOffers = segment.sender?.takeIf { isOwner }?.let { domain ->
                val decision = effectiveDecision(patterns, domain)
                SenderOffers(
                    always = if (decision != SenderList.ALLOW) { { viewModel.alwaysImportSender("${prefix}sender/always", domain) } } else null,
                    never = if (decision != SenderList.DENY) { { viewModel.neverImportSender("${prefix}sender/never", domain) } } else null,
                )
            },
            modifier = Modifier.padding(padding),
        )
    }
}

/** The body of [BookingDetailScreen], for [segment] as it stands. */
@Composable
fun BookingDetails(
    segment: Segment,
    programs: List<ProfileEntry> = emptyList(),
    emailLink: (SourceRef) -> String? = { null },
    senderOffers: SenderOffers? = null,
    errors: List<String> = emptyList(),
    modifier: Modifier = Modifier,
) {
    val chrome = LocalAppChrome.current
    val muted = MaterialTheme.colorScheme.onSurfaceVariant
    val referenceLabel = stringResource(Res.string.booking_reference)
    val struck = if (segment.isCancelled) TextDecoration.LineThrough else null
    // One size for everything but the title and the Sources heading.
    val body = MaterialTheme.typography.bodyLarge
    Column(
        modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        for (error in errors) Text(error, color = MaterialTheme.colorScheme.error)
        if (segment.isCancelled) {
            Text(stringResource(Res.string.cancelled), style = body, color = MaterialTheme.colorScheme.error)
        }
        Text(segment.title, style = MaterialTheme.typography.titleLarge, textDecoration = struck)
        routeLine(segment)?.let { Text(it, style = body, color = muted) }
        // The trip page's day heading isn't here, so the day the booking starts is.
        Text(formatDate(localDate(segment.start)), style = body, color = muted, textDecoration = struck)
        timesLine(segment)?.let { Text(it, style = body, color = muted) }
        // Both ends, unless they are the same place: a one-way rental's two desks share a name, not an address.
        for (place in listOfNotNull(segment.origin, segment.destination).distinct()) {
            PlaceLink(place) { chrome.openLink(mapsUrl(place), "a booking's place") }
        }
        segment.provider?.let { Text(it, style = body, modifier = Modifier.padding(top = 8.dp)) }
        segment.confirmation?.trim()?.takeIf { it.isNotEmpty() }?.let { ref ->
            Text(
                stringResource(Res.string.ref_value, ref),
                style = body,
                modifier = Modifier.fillMaxWidth()
                    .clickable(onClickLabel = stringResource(Res.string.copy_reference), role = Role.Button) { chrome.copyToClipboard(referenceLabel, ref) }
                    .padding(vertical = 8.dp),
            )
        }
        if (segment.travelers.isNotEmpty()) {
            Text(stringResource(Res.string.booking_for, segment.travelers.joinToString(", ")), style = body)
        }
        // One program a line, so whose each number is stays plain.
        for (program in programs) Text(loyaltyLine(program), style = body, color = muted)
        segment.notes?.let { Text(it, style = body, modifier = Modifier.padding(top = 8.dp)) }
        Verdict(segment)
        if (segment.sources.isNotEmpty() || segment.sender != null) {
            Text(stringResource(Res.string.sources), style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 16.dp))
            SourcesList(segment, emailLink, senderOffers)
        }
    }
}

/** A booking's place, named with its address (else its town); a tap shows it in Maps. */
@Composable
private fun PlaceLink(place: Place, open: () -> Unit) {
    val body = MaterialTheme.typography.bodyLarge
    Column(
        modifier = Modifier.fillMaxWidth().clickable(onClickLabel = stringResource(Res.string.show_in_maps), role = Role.Button, onClick = open).padding(vertical = 8.dp),
    ) {
        Text(place.name, style = body, textDecoration = TextDecoration.Underline)
        (place.address ?: place.city)?.let { Text(it, style = body, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}
