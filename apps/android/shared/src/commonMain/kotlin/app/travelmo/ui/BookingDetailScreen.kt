package app.travelmo.ui

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.travelmo.core.Place
import app.travelmo.core.ProfileEntry
import app.travelmo.core.Segment
import app.travelmo.core.SegmentType
import app.travelmo.core.SenderList
import app.travelmo.core.SourceRef
import app.travelmo.core.allLoyalty
import app.travelmo.core.bookingHeading
import app.travelmo.core.effectiveDecision
import app.travelmo.core.emailLinkFor
import app.travelmo.core.formatDate
import app.travelmo.core.headedRouteLine
import app.travelmo.core.isCancelled
import app.travelmo.core.localDate
import app.travelmo.core.loyaltyLine
import app.travelmo.core.mapsUrl
import app.travelmo.core.programsFor
import app.travelmo.core.sharedWithAny
import app.travelmo.core.timesLine
import app.travelmo.shared.Res
import app.travelmo.shared.boarding_pass_board
import app.travelmo.shared.boarding_pass_gate
import app.travelmo.shared.boarding_pass_group
import app.travelmo.shared.boarding_pass_offline
import app.travelmo.shared.boarding_pass_seat
import app.travelmo.shared.boarding_passes
import app.travelmo.shared.booking_confirmation_label
import app.travelmo.shared.booking_copy
import app.travelmo.shared.booking_for
import app.travelmo.shared.booking_gone
import app.travelmo.shared.booking_loyalty_label
import app.travelmo.shared.booking_notes_label
import app.travelmo.shared.booking_provider_label
import app.travelmo.shared.booking_reference
import app.travelmo.shared.booking_travelers_label
import app.travelmo.shared.cancelled
import app.travelmo.shared.copy_reference
import app.travelmo.shared.edit
import app.travelmo.shared.google_wallet
import app.travelmo.shared.ref_value
import app.travelmo.shared.show_boarding_pass
import app.travelmo.shared.show_in_maps
import app.travelmo.shared.sources
import app.travelmo.shared.trip_loading
import org.jetbrains.compose.resources.stringResource

/**
 * One booking in full, opened by tapping its row: schedule hero card,
 * boarding passes card (for flights), grouped details card (provider,
 * confirmation with copy, travelers, loyalty, notes, rating), and sources.
 * The ✎ edits it, for those who may. Leaves by [onBack] once the booking is
 * gone from the trip, and by [onTripGone] once the trip is.
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
    val initialTrip = remember(tripId) { viewModel.peekTrip(tripId) }
    val initialSegments = remember(tripId) { viewModel.peekSegments(tripId) }
    val trip by tripFlow.collectAsStateWithLifecycle(initialValue = initialTrip)
    val segments by segmentsFlow.collectAsStateWithLifecycle(initialValue = initialSegments)
    val addresses by viewModel.addresses.collectAsStateWithLifecycle()
    val ownProfile by viewModel.ownProfile.collectAsStateWithLifecycle()
    // The user's people, so every spelling of someone on a loyalty number is one person.
    val people by viewModel.travelers.collectAsStateWithLifecycle()
    val gmailMailboxes by viewModel.gmailMailboxes.collectAsStateWithLifecycle()
    val patterns by viewModel.senderPatterns.collectAsStateWithLifecycle()
    val cleanup by viewModel.senderCleanup.collectAsStateWithLifecycle()
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    val segment = remember(segments, segmentId) { segments?.firstOrNull { it.id == segmentId } }
    val loyalty = remember(ownProfile, people) { ownProfile?.let { allLoyalty(it, people) }.orEmpty() }
    val programs = remember(segment?.provider, loyalty) { segment?.let { programsFor(it.provider, loyalty) }.orEmpty() }
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
            programs = programs,
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
@OptIn(ExperimentalLayoutApi::class)
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
    val outline = MaterialTheme.colorScheme.outlineVariant
    val referenceLabel = stringResource(Res.string.booking_reference)
    val struck = if (segment.isCancelled) TextDecoration.LineThrough else null
    val body = MaterialTheme.typography.bodyLarge
    val cardShape = RoundedCornerShape(12.dp)

    var selectedPass by rememberSaveable(segment.id) { mutableIntStateOf(0) }
    var showPassDialog by rememberSaveable(segment.id) { mutableStateOf(false) }
    var sourcesExpanded by rememberSaveable(segment.id) { mutableStateOf(true) }

    val passes = segment.boardingPasses
    val activePass = passes.getOrElse(selectedPass) { passes.firstOrNull() }
    val reference = segment.confirmation?.trim()?.takeIf { it.isNotEmpty() }
    val hasDetailRows =
        segment.provider != null ||
            reference != null ||
            segment.travelers.isNotEmpty() ||
            programs.isNotEmpty() ||
            segment.notes != null ||
            segment.rating != null ||
            segment.favorite == true

    Column(
        modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 12.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        for (error in errors) Text(error, color = MaterialTheme.colorScheme.error)

        // Hero schedule card
        Column(
            verticalArrangement = Arrangement.spacedBy(4.dp),
            modifier = Modifier.fillMaxWidth().clip(cardShape).border(1.dp, outline, cardShape).padding(16.dp),
        ) {
            if (segment.isCancelled) {
                Text(stringResource(Res.string.cancelled), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
            }
            val heading = remember(segment) { bookingHeading(segment) }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                BookingLogo(segment, heading, 24.dp)
                Text(heading.headline, style = MaterialTheme.typography.titleLarge, textDecoration = struck)
            }
            headedRouteLine(segment, heading)?.let { Text(it, style = body, color = muted) }
            // The trip page's day heading isn't here, so the day the booking starts is.
            Text(formatDate(localDate(segment.start)), style = body, color = muted, textDecoration = struck)
            timesLine(segment)?.let { Text(it, style = body, color = muted) }
            // Both ends, unless they are the same place: a one-way rental's two desks share a name, not an address.
            for (place in listOfNotNull(segment.origin, segment.destination).distinct()) {
                PlaceLink(place) { chrome.openLink(mapsUrl(place), "a booking's place") }
            }
        }

        // Boarding passes card (flights with extracted boarding passes)
        if (segment.type == SegmentType.FLIGHT && !segment.isCancelled && activePass != null) {
            Column(
                verticalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.fillMaxWidth().clip(cardShape).border(1.dp, outline, cardShape).padding(16.dp),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(stringResource(Res.string.boarding_passes), style = MaterialTheme.typography.titleMedium)
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(999.dp))
                            .border(1.dp, outline, RoundedCornerShape(999.dp))
                            .padding(horizontal = 8.dp, vertical = 2.dp),
                    ) {
                        Text(stringResource(Res.string.boarding_pass_offline), style = MaterialTheme.typography.labelSmall, color = muted)
                    }
                }

                if (passes.size > 1) {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        passes.forEachIndexed { idx, p ->
                            FilterChip(
                                selected = idx == selectedPass,
                                onClick = { selectedPass = idx },
                                label = { Text(p.passenger) },
                            )
                        }
                    }
                } else {
                    Text(activePass.passenger, style = body, color = muted)
                }

                Row(
                    horizontalArrangement = Arrangement.SpaceEvenly,
                    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).border(1.dp, outline, RoundedCornerShape(8.dp)).padding(vertical = 8.dp, horizontal = 4.dp),
                ) {
                    StatCell(stringResource(Res.string.boarding_pass_gate), activePass.gate ?: "—", Modifier.weight(1f))
                    StatCell(stringResource(Res.string.boarding_pass_board), activePass.boardingTime ?: "—", Modifier.weight(1f))
                    StatCell(stringResource(Res.string.boarding_pass_group), activePass.boardingGroup ?: "—", Modifier.weight(1f))
                    StatCell(stringResource(Res.string.boarding_pass_seat), activePass.seat ?: "—", Modifier.weight(1f))
                }

                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { showPassDialog = true }) {
                        Text(stringResource(Res.string.show_boarding_pass))
                    }
                    OutlinedButton(onClick = { chrome.openGoogleWallet() }) {
                        Text(stringResource(Res.string.google_wallet))
                    }
                }
            }
        }

        // Grouped Details card
        if (hasDetailRows) {
            Column(
                modifier = Modifier.fillMaxWidth().clip(cardShape).border(1.dp, outline, cardShape),
            ) {
                var needsDivider = false
                @Composable
                fun detailRow(content: @Composable () -> Unit) {
                    if (needsDivider) HorizontalDivider(color = outline)
                    needsDivider = true
                    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)) {
                        content()
                    }
                }

                segment.provider?.let { provider ->
                    detailRow {
                        Text(stringResource(Res.string.booking_provider_label), style = body, color = muted)
                        Text(provider, style = body)
                    }
                }

                reference?.let { ref ->
                    detailRow {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Column(
                                modifier = Modifier
                                    .weight(1f)
                                    .clickable(onClickLabel = stringResource(Res.string.copy_reference), role = Role.Button) {
                                        chrome.copyToClipboard(referenceLabel, ref)
                                    },
                            ) {
                                Text(stringResource(Res.string.booking_confirmation_label), style = body, color = muted)
                                Text(stringResource(Res.string.ref_value, ref), style = body)
                            }
                            OutlinedButton(onClick = { chrome.copyToClipboard(referenceLabel, ref) }) {
                                Text(stringResource(Res.string.booking_copy))
                            }
                        }
                    }
                }

                if (segment.travelers.isNotEmpty()) {
                    detailRow {
                        Text(stringResource(Res.string.booking_travelers_label), style = body, color = muted)
                        Text(stringResource(Res.string.booking_for, segment.travelers.joinToString(", ")), style = body)
                    }
                }

                if (programs.isNotEmpty()) {
                    detailRow {
                        Text(stringResource(Res.string.booking_loyalty_label), style = body, color = muted)
                        // One program a line, so whose each number is stays plain.
                        for (program in programs) Text(loyaltyLine(program), style = body, color = muted)
                    }
                }

                segment.notes?.let { notes ->
                    detailRow {
                        Text(stringResource(Res.string.booking_notes_label), style = body, color = muted)
                        Text(notes, style = body)
                    }
                }

                if (segment.rating != null || segment.favorite == true) {
                    detailRow {
                        Verdict(segment)
                    }
                }
            }
        }

        // Collapsible Sources card (expanded by default)
        if (segment.sources.isNotEmpty() || segment.sender != null) {
            Column(
                modifier = Modifier.fillMaxWidth().clip(cardShape).border(1.dp, outline, cardShape),
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { sourcesExpanded = !sourcesExpanded }
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                ) {
                    Text(stringResource(Res.string.sources), style = MaterialTheme.typography.titleMedium)
                    Text(if (sourcesExpanded) "▾" else "▸", style = MaterialTheme.typography.titleMedium, color = muted)
                }
                if (sourcesExpanded) {
                    HorizontalDivider(color = outline)
                    Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                        SourcesList(segment, emailLink, senderOffers)
                    }
                }
            }
        }
    }

    if (showPassDialog && passes.isNotEmpty()) {
        BoardingPassDialog(
            segment = segment,
            passes = passes,
            initialIndex = selectedPass,
            onDismiss = { showPassDialog = false },
        )
    }
}

@Composable
private fun StatCell(label: String, value: String, modifier: Modifier = Modifier) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = modifier) {
        Text(label, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        Text(value, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
    }
}

/** A booking's place, named with its address (else its town); a tap shows it in Maps. */
@Composable
private fun PlaceLink(place: Place, open: () -> Unit) {
    val body = MaterialTheme.typography.bodyLarge
    Column(
        modifier = Modifier.fillMaxWidth().clickable(onClickLabel = stringResource(Res.string.show_in_maps), role = Role.Button, onClick = open).padding(vertical = 4.dp),
    ) {
        Text(place.name, style = body, textDecoration = TextDecoration.Underline)
        (place.address ?: place.city)?.let { Text(it, style = body, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}
