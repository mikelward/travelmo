package app.travelmo.ui

import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import app.travelmo.core.DocumentInput
import app.travelmo.core.DocumentInputType
import app.travelmo.core.DocumentKind
import app.travelmo.core.FoundLoyalty
import app.travelmo.core.HomePeriod
import app.travelmo.core.LoyaltyGroup
import app.travelmo.core.LoyaltyInput
import app.travelmo.core.MAX_TRUSTED
import app.travelmo.core.ParsedAirports
import app.travelmo.core.ParsedCorrection
import app.travelmo.core.Person
import app.travelmo.core.ProfileEntry
import app.travelmo.core.TravelProfile
import app.travelmo.core.airportCodes
import app.travelmo.core.allLoyalty
import app.travelmo.core.allLoyaltyWithSource
import app.travelmo.core.buildDocumentEntry
import app.travelmo.core.buildLoyaltyEntry
import app.travelmo.core.correctionText
import app.travelmo.core.daysBetween
import app.travelmo.core.defaultDocumentTitle
import app.travelmo.core.findFoundLoyalty
import app.travelmo.core.findPerson
import app.travelmo.core.formatDateWithYear
import app.travelmo.core.guessMe
import app.travelmo.core.homeLine
import app.travelmo.core.homeTownKey
import app.travelmo.core.instantMillis
import app.travelmo.core.localTime
import app.travelmo.core.longStayText
import app.travelmo.core.loyaltyByPerson
import app.travelmo.core.loyaltySummary
import app.travelmo.core.parseAirportCodes
import app.travelmo.core.parseCorrection
import app.travelmo.core.sameMembership
import app.travelmo.core.parseDocumentEntry
import app.travelmo.core.parseLoyaltyEntry
import app.travelmo.core.today
import app.travelmo.core.travelDocuments
import app.travelmo.core.upcomingBoardingFlights
import app.travelmo.shared.Res
import app.travelmo.shared.add_document
import app.travelmo.shared.add_home
import app.travelmo.shared.add_loyalty
import app.travelmo.shared.also_known_as
import app.travelmo.shared.also_me
import app.travelmo.shared.boarding_passes
import app.travelmo.shared.cancel
import app.travelmo.shared.change
import app.travelmo.shared.city
import app.travelmo.shared.copy_number
import app.travelmo.shared.country
import app.travelmo.shared.document_country_label
import app.travelmo.shared.document_expired_on
import app.travelmo.shared.document_expires_on
import app.travelmo.shared.document_expiry_label
import app.travelmo.shared.document_issued_label
import app.travelmo.shared.document_nationality_label
import app.travelmo.shared.document_notes_label
import app.travelmo.shared.document_number_label
import app.travelmo.shared.document_title_label
import app.travelmo.shared.document_type_label
import app.travelmo.shared.documents
import app.travelmo.shared.edit
import app.travelmo.shared.edit_document
import app.travelmo.shared.edit_home_airports
import app.travelmo.shared.edit_loyalty
import app.travelmo.shared.enter_email
import app.travelmo.shared.from_emails_badge
import app.travelmo.shared.from_your_stays
import app.travelmo.shared.google_wallet
import app.travelmo.shared.google_wallet_hint
import app.travelmo.shared.google_wallet_hint_upcoming
import app.travelmo.shared.home
import app.travelmo.shared.home_airports
import app.travelmo.shared.home_airports_label
import app.travelmo.shared.home_airports_none
import app.travelmo.shared.home_from_date
import app.travelmo.shared.home_not_known
import app.travelmo.shared.home_pick_from
import app.travelmo.shared.home_worked_out
import app.travelmo.shared.loading
import app.travelmo.shared.loyalty_balance_label
import app.travelmo.shared.loyalty_mine
import app.travelmo.shared.loyalty_number_label
import app.travelmo.shared.loyalty_person_label
import app.travelmo.shared.loyalty_program_label
import app.travelmo.shared.loyalty_programs
import app.travelmo.shared.loyalty_status_label
import app.travelmo.shared.loyalty_theirs
import app.travelmo.shared.loyalty_you
import app.travelmo.shared.not_home
import app.travelmo.shared.ok
import app.travelmo.shared.only_you
import app.travelmo.shared.open_google_wallet
import app.travelmo.shared.people
import app.travelmo.shared.people_hint
import app.travelmo.shared.profile_all
import app.travelmo.shared.profile_from_imports
import app.travelmo.shared.profile_imported_details
import app.travelmo.shared.profile_no_people
import app.travelmo.shared.remove
import app.travelmo.shared.remove_found_loyalty
import app.travelmo.shared.remove_home
import app.travelmo.shared.same_person_as
import app.travelmo.shared.same_person_as_title
import app.travelmo.shared.save
import app.travelmo.shared.set
import app.travelmo.shared.share
import app.travelmo.shared.share_profile_hint
import app.travelmo.shared.share_with_someone
import app.travelmo.shared.shared_badge
import app.travelmo.shared.shared_by_readonly
import app.travelmo.shared.shared_with
import app.travelmo.shared.shared_with_you
import app.travelmo.shared.show_boarding_pass
import app.travelmo.shared.someone_else
import app.travelmo.shared.someone_else_more
import app.travelmo.shared.someone_who_trusts_you
import app.travelmo.shared.stop_sharing_with
import app.travelmo.shared.trips_unreadable_home
import app.travelmo.shared.wallet
import app.travelmo.shared.wallet_add
import app.travelmo.shared.wallet_documents_empty
import app.travelmo.shared.wallet_documents_shared_empty
import app.travelmo.shared.wallet_loyalty_empty
import app.travelmo.shared.wallet_loyalty_shared_empty
import app.travelmo.shared.wallet_shared_with_you_hint
import app.travelmo.shared.who_are_you
import app.travelmo.shared.whose_is
import app.travelmo.shared.whose_is_this
import app.travelmo.shared.you
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.pluralStringResource
import org.jetbrains.compose.resources.stringResource

private const val WALLET_DOC_TOKEN = "wallet/documents"
private const val WALLET_LOYALTY_TOKEN = "wallet/loyalty"
private const val WALLET_DOC_DIALOG_TOKEN = "wallet/doc-dialog"
private const val WALLET_LOYALTY_DIALOG_TOKEN = "wallet/loyalty-dialog"

private fun findStoredEntryIndex(list: List<ProfileEntry>, target: ProfileEntry?): Int =
    if (target != null) list.indexOfFirst { it.title == target.title && it.fields == target.fields } else -1

/**
 * Person-First Wallet screen, mirroring the web's /wallet:
 * - Optional person switcher pills (You, household people, shared wallets)
 * - Boarding passes card (upcoming flights within 48h + Open Google Wallet)
 * - Documents card (expandable rows, Copy number, Edit, Remove, no-TripIt empty state)
 * - Loyalty programs card (unified found + saved, Copy number, Whose is this?, Edit/Remove, no-TripIt empty state)
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ProfileScreen(
    viewModel: TripsViewModel,
    onOpenSettings: () -> Unit,
    bottomBar: @Composable () -> Unit,
    onOpenTrip: (String) -> Unit = {},
) {
    LaunchedEffect(viewModel) { viewModel.refreshUnconfirmedSegments() }
    val chrome = LocalAppChrome.current
    val profile by viewModel.ownProfile.collectAsStateWithLifecycle()
    val shared by viewModel.sharedProfiles.collectAsStateWithLifecycle()
    val loaded by viewModel.profileLoaded.collectAsStateWithLifecycle()
    val travelers by viewModel.travelers.collectAsStateWithLifecycle()
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    val listState by viewModel.state.collectAsStateWithLifecycle()

    val removals = outcomes.filterKeys { it.startsWith(FOUND_PREFIX) }
    val removalError = removals.values.filterIsInstance<Outcome.Failed>().lastOrNull()?.message
    LaunchedEffect(removals) { for ((token, outcome) in removals) if (outcome is Outcome.Done) viewModel.outcomeSeen(token) }
    val whose = outcomes.filterKeys { it.startsWith(PERSON_PREFIX) }
    val whoseError = whose.values.filterIsInstance<Outcome.Failed>().lastOrNull()?.message
    LaunchedEffect(whose) { for ((token, outcome) in whose) if (outcome is Outcome.Done) viewModel.outcomeSeen(token) }
    val whoIsError = (outcomes[WHO_IS_TOKEN] as? Outcome.Failed)?.message
    LaunchedEffect(outcomes[WHO_IS_TOKEN]) { if (outcomes[WHO_IS_TOKEN] is Outcome.Done) viewModel.outcomeSeen(WHO_IS_TOKEN) }
    val docError = (outcomes[WALLET_DOC_TOKEN] as? Outcome.Failed)?.message
    LaunchedEffect(outcomes[WALLET_DOC_TOKEN]) { if (outcomes[WALLET_DOC_TOKEN] is Outcome.Done) viewModel.outcomeSeen(WALLET_DOC_TOKEN) }
    val loyaltyError = (outcomes[WALLET_LOYALTY_TOKEN] as? Outcome.Failed)?.message
    LaunchedEffect(outcomes[WALLET_LOYALTY_TOKEN]) { if (outcomes[WALLET_LOYALTY_TOKEN] is Outcome.Done) viewModel.outcomeSeen(WALLET_LOYALTY_TOKEN) }

    val own = profile
    val ownResolvedLoyalty = remember(own, travelers) { own?.let { allLoyaltyWithSource(it, travelers) }.orEmpty() }
    val ownLoyalty = remember(ownResolvedLoyalty) { ownResolvedLoyalty.map { it.entry } }
    val savedIndexOf: (ProfileEntry) -> Int = remember(ownResolvedLoyalty) {
        { entry -> ownResolvedLoyalty.firstOrNull { it.entry === entry }?.savedIndex ?: -1 }
    }
    val ownLoyaltyGroups = remember(ownLoyalty) { loyaltyByPerson(ownLoyalty) }
    val householdNames = remember(ownLoyaltyGroups) { ownLoyaltyGroups.mapNotNull { it.person } }
    val others = remember(shared, own?.ownerUid) { shared.filter { it.ownerUid != own?.ownerUid } }
    val showSwitcher = householdNames.isNotEmpty() || others.isNotEmpty()

    // Selected person key: "" = You, "household:<name>", "shared:<uid>".
    var selectedKey by rememberSaveable { mutableStateOf("") }
    val effectiveKey = when {
        selectedKey.startsWith("household:") && selectedKey.removePrefix("household:") in householdNames -> selectedKey
        selectedKey.startsWith("shared:") && others.any { it.ownerUid == selectedKey.removePrefix("shared:") } -> selectedKey
        else -> ""
    }

    val nowIso by viewModel.clockNow.collectAsStateWithLifecycle(initialValue = viewModel.now())
    val todayDate by viewModel.clockToday.collectAsStateWithLifecycle(initialValue = viewModel.today())
    val upcoming = remember(listState.groups, listState.segmentsByTrip, nowIso) {
        val trips = listState.groups?.let { it.current + it.upcoming + it.past }.orEmpty()
        val nowMs = runCatching { instantMillis(nowIso) }.getOrNull() ?: return@remember emptyList()
        upcomingBoardingFlights(trips, listState.segmentsByTrip, nowMs)
    }

    var showAddChoice by rememberSaveable { mutableStateOf(false) }
    var docDialogTarget by remember { mutableStateOf<ProfileEntry?>(null) }
    var docDialogOpen by remember { mutableStateOf(false) }
    var loyaltyDialogTarget by remember { mutableStateOf<ProfileEntry?>(null) }
    var loyaltyDialogDisplayed by remember { mutableStateOf<ProfileEntry?>(null) }
    var loyaltyDialogOpen by remember { mutableStateOf(false) }
    var loyaltyDialogDefaultPerson by remember { mutableStateOf<String?>(null) }

    var editingOwner by rememberSaveable { mutableStateOf<List<String>?>(null) }
    editingOwner?.let { (program, number) ->
        PersonDialog(
            program = program,
            number = number,
            people = householdNames,
            onPick = { person ->
                whose.keys.forEach(viewModel::outcomeSeen)
                viewModel.setLoyaltyPerson("$PERSON_PREFIX$program/$number", program, number, person)
            },
            onDismiss = { editingOwner = null },
        )
    }

    var naming by rememberSaveable { mutableStateOf<String?>(null) }
    naming?.let { name ->
        PeoplePicker(
            stringResource(Res.string.same_person_as_title, name),
            travelers,
            except = null,
            onPick = {
                viewModel.outcomeSeen(WHO_IS_TOKEN)
                viewModel.sayWhoIs(WHO_IS_TOKEN, name, it)
            },
            onDismiss = { naming = null },
        )
    }
    if (showAddChoice) {
        AlertDialog(
            onDismissRequest = { showAddChoice = false },
            title = { Text(stringResource(Res.string.wallet_add)) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        onClick = {
                            showAddChoice = false
                            docDialogTarget = null
                            docDialogOpen = true
                        },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text(stringResource(Res.string.add_document)) }
                    OutlinedButton(
                        onClick = {
                            showAddChoice = false
                            loyaltyDialogTarget = null
                            loyaltyDialogDisplayed = null
                            loyaltyDialogDefaultPerson = null
                            loyaltyDialogOpen = true
                        },
                        modifier = Modifier.fillMaxWidth(),
                    ) { Text(stringResource(Res.string.add_loyalty)) }
                }
            },
            confirmButton = {
                TextButton(onClick = { showAddChoice = false }) { Text(stringResource(Res.string.cancel)) }
            },
        )
    }

    val docDialogOutcome = outcomes[WALLET_DOC_DIALOG_TOKEN]
    LaunchedEffect(docDialogOutcome) {
        if (docDialogOutcome is Outcome.Done) {
            viewModel.outcomeSeen(WALLET_DOC_DIALOG_TOKEN)
            docDialogOpen = false
            docDialogTarget = null
        }
    }
    val loyaltyDialogOutcome = outcomes[WALLET_LOYALTY_DIALOG_TOKEN]
    LaunchedEffect(loyaltyDialogOutcome) {
        if (loyaltyDialogOutcome is Outcome.Done) {
            viewModel.outcomeSeen(WALLET_LOYALTY_DIALOG_TOKEN)
            loyaltyDialogOpen = false
            loyaltyDialogTarget = null
            loyaltyDialogDisplayed = null
            loyaltyDialogDefaultPerson = null
        }
    }

    if (docDialogOpen) {
        WalletDocumentDialog(
            initial = docDialogTarget?.let(::parseDocumentEntry),
            existing = docDialogTarget,
            saving = docDialogOutcome is Outcome.Busy,
            error = (docDialogOutcome as? Outcome.Failed)?.message,
            onSave = { entry ->
                val target = docDialogTarget
                viewModel.outcomeSeen(WALLET_DOC_DIALOG_TOKEN)
                viewModel.saveTravelDocuments(WALLET_DOC_DIALOG_TOKEN) { latest ->
                    if (target == null) {
                        latest + entry
                    } else {
                        val pos = findStoredEntryIndex(latest, target)
                        if (pos >= 0) latest.mapIndexed { i, old -> if (i == pos) entry else old } else latest
                    }
                }
            },
            onDismiss = {
                viewModel.outcomeSeen(WALLET_DOC_DIALOG_TOKEN)
                docDialogOpen = false
                docDialogTarget = null
            },
        )
    }

    if (loyaltyDialogOpen) {
        val existingLoyalty = loyaltyDialogTarget
        val initial = (loyaltyDialogDisplayed ?: existingLoyalty)?.let(::parseLoyaltyEntry)
            ?: loyaltyDialogDefaultPerson?.let { LoyaltyInput(program = "", person = it) }
        WalletLoyaltyDialog(
            initial = initial,
            existing = existingLoyalty,
            editing = existingLoyalty != null,
            saving = loyaltyDialogOutcome is Outcome.Busy,
            error = (loyaltyDialogOutcome as? Outcome.Failed)?.message,
            onSave = { entry ->
                val target = existingLoyalty
                val prevPerson = initial?.person
                val summary = loyaltySummary(entry)
                val account = summary.account
                val hasExistingAttribution = account != null && (
                    findFoundLoyalty(own?.foundLoyalty.orEmpty(), entry) != null ||
                        own?.loyaltyPeople.orEmpty().any { sameMembership(it.program, it.number, entry.title, account) }
                    )
                val reconcilePerson = if (account != null && (hasExistingAttribution || (target != null && summary.person != prevPerson))) {
                    whose.keys.forEach(viewModel::outcomeSeen)
                    Triple(entry.title, account, summary.person)
                } else {
                    null
                }
                viewModel.outcomeSeen(WALLET_LOYALTY_DIALOG_TOKEN)
                viewModel.saveTravelLoyalty(WALLET_LOYALTY_DIALOG_TOKEN, reconcilePerson) { latest ->
                    if (target == null) {
                        latest + entry
                    } else {
                        val pos = findStoredEntryIndex(latest, target)
                        if (pos >= 0) latest.mapIndexed { i, old -> if (i == pos) entry else old } else latest
                    }
                }
            },
            onDismiss = {
                viewModel.outcomeSeen(WALLET_LOYALTY_DIALOG_TOKEN)
                loyaltyDialogOpen = false
                loyaltyDialogTarget = null
                loyaltyDialogDisplayed = null
                loyaltyDialogDefaultPerson = null
            },
        )
    }

    val error = docError ?: loyaltyError ?: whoIsError ?: whoseError ?: removalError

    Scaffold(
        topBar = {
            AppTopBar(
                stringResource(Res.string.wallet),
                onOpenSettings = onOpenSettings,
                actions = {
                    IconButton(onClick = { showAddChoice = true }) {
                        Icon(Icons.Filled.Add, contentDescription = stringResource(Res.string.wallet_add))
                    }
                },
            )
        },
        bottomBar = bottomBar,
    ) { padding ->
        val scroll = rememberScrollState()
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .scrollEdgeCue(scroll, scrollCueColors())
                .verticalScroll(scroll)
                .padding(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            if (showSwitcher) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    FilterChip(
                        selected = effectiveKey == "",
                        onClick = { selectedKey = "" },
                        label = { Text(stringResource(Res.string.loyalty_you)) },
                    )
                    householdNames.forEach { name ->
                        val key = "household:$name"
                        FilterChip(
                            selected = effectiveKey == key,
                            onClick = { selectedKey = key },
                            label = { Text(name) },
                        )
                    }
                    others.forEach { p ->
                        val key = "shared:${p.ownerUid}"
                        val label = p.ownerEmail ?: stringResource(Res.string.someone_who_trusts_you)
                        FilterChip(
                            selected = effectiveKey == key,
                            onClick = { selectedKey = key },
                            label = { Text("$label · ${stringResource(Res.string.shared_badge)}") },
                        )
                    }
                }
            }

            if (!loaded) {
                Text(stringResource(Res.string.loading), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            } else if (effectiveKey == "") {
                // Boarding passes card (upcoming 48h flights + Open Google Wallet).
                var openPassSegment by remember { mutableStateOf<app.travelmo.core.Segment?>(null) }
                Column {
                    Text(
                        stringResource(Res.string.boarding_passes),
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.padding(bottom = 8.dp).semantics { heading() },
                    )
                    val shape = RoundedCornerShape(12.dp)
                    Column(modifier = Modifier.fillMaxWidth().clip(shape).border(1.dp, MaterialTheme.colorScheme.outlineVariant, shape)) {
                        upcoming.forEach { f ->
                            val passes = f.segment.boardingPasses
                            if (passes.isNotEmpty()) {
                                val first = passes.first()
                                val detail = listOfNotNull(
                                    localTime(f.segment.start),
                                    first.gate?.let { "Gate $it" },
                                    first.seat?.let { "Seat $it" },
                                    if (passes.size > 1) "${passes.size} passes" else null,
                                ).joinToString(" · ")
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                                ) {
                                    Column(modifier = Modifier.weight(1f).clickable { onOpenTrip(f.tripId) }) {
                                        Text(f.segment.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                                        Text(detail, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                    androidx.compose.material3.Button(onClick = { openPassSegment = f.segment }) {
                                        Text(stringResource(Res.string.show_boarding_pass))
                                    }
                                }
                            } else {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clickable { onOpenTrip(f.tripId) }
                                        .padding(horizontal = 16.dp, vertical = 12.dp),
                                ) {
                                    Column(modifier = Modifier.weight(1f)) {
                                        Text(f.segment.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                                        val detail = buildString {
                                            append(localTime(f.segment.start))
                                            f.segment.confirmation?.let { append(" · Ref $it") }
                                        }
                                        Text(detail, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                    Text("›", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                        }
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(stringResource(Res.string.google_wallet), style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                                Text(
                                    stringResource(if (upcoming.isNotEmpty()) Res.string.google_wallet_hint_upcoming else Res.string.google_wallet_hint),
                                    style = MaterialTheme.typography.bodyLarge,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                            OutlinedButton(onClick = { chrome.openGoogleWallet() }) {
                                Text(stringResource(Res.string.open_google_wallet))
                            }
                        }
                    }
                }
                openPassSegment?.let { seg ->
                    if (seg.boardingPasses.isNotEmpty()) {
                        BoardingPassDialog(
                            segment = seg,
                            passes = seg.boardingPasses,
                            onDismiss = { openPassSegment = null },
                        )
                    }
                }

                // Documents card
                WalletDocumentsCard(
                    entries = own?.documents.orEmpty(),
                    todayDate = todayDate,
                    canEdit = true,
                    onAdd = {
                        docDialogTarget = null
                        docDialogOpen = true
                    },
                    onEdit = { idx ->
                        val target = own?.documents.orEmpty().getOrNull(idx)
                        if (target != null) {
                            docDialogTarget = target
                            docDialogOpen = true
                        }
                    },
                    onRemove = { idx ->
                        val target = own?.documents.orEmpty().getOrNull(idx)
                        viewModel.outcomeSeen(WALLET_DOC_TOKEN)
                        viewModel.saveTravelDocuments(WALLET_DOC_TOKEN) { latest ->
                            val pos = findStoredEntryIndex(latest, target)
                            if (pos >= 0) latest.filterIndexed { i, _ -> i != pos } else latest
                        }
                    },
                )

                // Loyalty card (You)
                val youEntries = remember(ownLoyaltyGroups) { ownLoyaltyGroups.firstOrNull { it.person == null }?.entries.orEmpty() }
                WalletLoyaltyCard(
                    entries = youEntries,
                    savedIndexOf = savedIndexOf,
                    found = own?.foundLoyalty.orEmpty(),
                    isOwn = true,
                    onAdd = {
                        loyaltyDialogTarget = null
                        loyaltyDialogDisplayed = null
                        loyaltyDialogDefaultPerson = null
                        loyaltyDialogOpen = true
                    },
                    onEditSaved = { idx, displayed ->
                        val target = own?.loyalty.orEmpty().getOrNull(idx)
                        if (target != null) {
                            loyaltyDialogTarget = target
                            loyaltyDialogDisplayed = displayed
                            loyaltyDialogOpen = true
                        }
                    },
                    onRemoveSaved = { idx ->
                        val removed = own?.loyalty.orEmpty().getOrNull(idx)
                        viewModel.outcomeSeen(WALLET_LOYALTY_TOKEN)
                        viewModel.saveTravelLoyalty(WALLET_LOYALTY_TOKEN) { latest ->
                            val pos = findStoredEntryIndex(latest, removed)
                            if (pos >= 0) latest.filterIndexed { i, _ -> i != pos } else latest
                        }
                        val matchingFound = removed?.let { findFoundLoyalty(own?.foundLoyalty.orEmpty(), it) }
                        if (matchingFound != null) {
                            removals.keys.forEach(viewModel::outcomeSeen)
                            viewModel.removeFoundLoyalty("$FOUND_PREFIX${matchingFound.program}/${matchingFound.number}", matchingFound)
                        }
                    },
                    onWhose = { program, number -> editingOwner = listOf(program, number) },
                    onRemoveFound = { found ->
                        removals.keys.forEach(viewModel::outcomeSeen)
                        viewModel.removeFoundLoyalty("$FOUND_PREFIX${found.program}/${found.number}", found)
                    },
                )
            } else if (effectiveKey.startsWith("household:")) {
                val name = effectiveKey.removePrefix("household:")
                val entries = remember(ownLoyaltyGroups, name) { ownLoyaltyGroups.firstOrNull { it.person == name }?.entries.orEmpty() }
                WalletLoyaltyCard(
                    entries = entries,
                    savedIndexOf = savedIndexOf,
                    found = own?.foundLoyalty.orEmpty(),
                    isOwn = true,
                    personHeader = name,
                    onWhoIs = if (travelers.isNotEmpty()) ({ naming = name }) else null,
                    onAdd = {
                        loyaltyDialogTarget = null
                        loyaltyDialogDisplayed = null
                        loyaltyDialogDefaultPerson = name
                        loyaltyDialogOpen = true
                    },
                    onEditSaved = { idx, displayed ->
                        val target = own?.loyalty.orEmpty().getOrNull(idx)
                        if (target != null) {
                            loyaltyDialogTarget = target
                            loyaltyDialogDisplayed = displayed
                            loyaltyDialogOpen = true
                        }
                    },
                    onRemoveSaved = { idx ->
                        val removed = own?.loyalty.orEmpty().getOrNull(idx)
                        viewModel.outcomeSeen(WALLET_LOYALTY_TOKEN)
                        viewModel.saveTravelLoyalty(WALLET_LOYALTY_TOKEN) { latest ->
                            val pos = findStoredEntryIndex(latest, removed)
                            if (pos >= 0) latest.filterIndexed { i, _ -> i != pos } else latest
                        }
                        val matchingFound = removed?.let { findFoundLoyalty(own?.foundLoyalty.orEmpty(), it) }
                        if (matchingFound != null) {
                            removals.keys.forEach(viewModel::outcomeSeen)
                            viewModel.removeFoundLoyalty("$FOUND_PREFIX${matchingFound.program}/${matchingFound.number}", matchingFound)
                        }
                    },
                    onWhose = { program, number -> editingOwner = listOf(program, number) },
                    onRemoveFound = { found ->
                        removals.keys.forEach(viewModel::outcomeSeen)
                        viewModel.removeFoundLoyalty("$FOUND_PREFIX${found.program}/${found.number}", found)
                    },
                )
            } else if (effectiveKey.startsWith("shared:")) {
                val uid = effectiveKey.removePrefix("shared:")
                val sharedProfile = others.firstOrNull { it.ownerUid == uid }
                if (sharedProfile != null) {
                    Text(
                        stringResource(Res.string.shared_by_readonly, sharedProfile.ownerEmail ?: stringResource(Res.string.someone_who_trusts_you)),
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    WalletDocumentsCard(entries = sharedProfile.documents, todayDate = todayDate, canEdit = false)
                    val sharedLoyalty = remember(sharedProfile) { allLoyalty(sharedProfile, emptyList()) }
                    WalletLoyaltyCard(entries = sharedLoyalty, savedIndexOf = { -1 }, found = emptyList(), isOwn = false)
                }
            }

            error?.let { msg ->
                Text(msg, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.error)
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WalletDocumentsCard(
    entries: List<ProfileEntry>,
    todayDate: String,
    canEdit: Boolean,
    onAdd: (() -> Unit)? = null,
    onEdit: ((Int) -> Unit)? = null,
    onRemove: ((Int) -> Unit)? = null,
) {
    val chrome = LocalAppChrome.current
    Column {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
            Text(
                stringResource(Res.string.documents),
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.weight(1f).semantics { heading() },
            )
            if (canEdit && onAdd != null) {
                TextButton(onClick = onAdd) { Text(stringResource(Res.string.add_document)) }
            }
        }
        val shape = RoundedCornerShape(12.dp)
        if (entries.isEmpty()) {
            Column(modifier = Modifier.fillMaxWidth().clip(shape).border(1.dp, MaterialTheme.colorScheme.outlineVariant, shape).padding(16.dp)) {
                Text(
                    stringResource(if (canEdit) Res.string.wallet_documents_empty else Res.string.wallet_documents_shared_empty),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (canEdit && onAdd != null) {
                    OutlinedButton(onClick = onAdd, modifier = Modifier.padding(top = 12.dp)) {
                        Text(stringResource(Res.string.add_document))
                    }
                }
            }
        } else {
            Column(modifier = Modifier.fillMaxWidth().clip(shape).border(1.dp, MaterialTheme.colorScheme.outlineVariant, shape)) {
                entries.forEachIndexed { idx, entry ->
                    if (idx > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    var open by rememberSaveable(entry.title, idx) { mutableStateOf(false) }
                    val parsed = remember(entry) { parseDocumentEntry(entry) }
                    val docMeta = remember(entry) { travelDocuments(listOf(entry)).firstOrNull() }
                    val expired = docMeta != null && docMeta.expires < todayDate
                    val warnSoon = docMeta != null && !expired && docMeta.kind == DocumentKind.PASSPORT && daysBetween(todayDate, docMeta.expires) < 183
                    Column(modifier = Modifier.fillMaxWidth()) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.fillMaxWidth().clickable { open = !open }.padding(horizontal = 16.dp, vertical = 12.dp),
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Text(entry.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                                if (docMeta != null) {
                                    val dateText = formatDateWithYear(docMeta.expires)
                                    Text(
                                        stringResource(if (expired) Res.string.document_expired_on else Res.string.document_expires_on, dateText),
                                        style = MaterialTheme.typography.bodyLarge,
                                        color = if (expired || warnSoon) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                            Text(if (open) "⌄" else "›", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                        if (open) {
                            Column(modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 12.dp)) {
                                HorizontalDivider(modifier = Modifier.padding(bottom = 8.dp), color = MaterialTheme.colorScheme.outlineVariant)
                                entry.fields.forEach { field ->
                                    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
                                        Text(field.label, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                                        Text(field.value, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1.2f))
                                    }
                                }
                                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                                    parsed.number?.let { num ->
                                        OutlinedButton(onClick = { chrome.copyToClipboard(entry.title, num) }) {
                                            Text(stringResource(Res.string.copy_number))
                                        }
                                    }
                                    if (canEdit && onEdit != null) {
                                        OutlinedButton(onClick = { onEdit(idx) }) { Text(stringResource(Res.string.edit)) }
                                    }
                                    if (canEdit && onRemove != null) {
                                        OutlinedButton(onClick = { onRemove(idx) }) { Text(stringResource(Res.string.remove)) }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WalletLoyaltyCard(
    entries: List<ProfileEntry>,
    savedIndexOf: (ProfileEntry) -> Int,
    found: List<FoundLoyalty>,
    isOwn: Boolean,
    personHeader: String? = null,
    onWhoIs: (() -> Unit)? = null,
    onAdd: (() -> Unit)? = null,
    onEditSaved: ((Int, ProfileEntry) -> Unit)? = null,
    onRemoveSaved: ((Int) -> Unit)? = null,
    onWhose: ((program: String, number: String) -> Unit)? = null,
    onRemoveFound: ((FoundLoyalty) -> Unit)? = null,
) {
    val chrome = LocalAppChrome.current
    Column {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(bottom = 8.dp)) {
            Text(
                stringResource(Res.string.loyalty_programs),
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.weight(1f).semantics { heading() },
            )
            if (personHeader != null && onWhoIs != null) {
                TextButton(onClick = onWhoIs) { Text(stringResource(Res.string.same_person_as)) }
            }
            if (isOwn && onAdd != null) {
                TextButton(onClick = onAdd) { Text(stringResource(Res.string.add_loyalty)) }
            }
        }
        val shape = RoundedCornerShape(12.dp)
        if (entries.isEmpty()) {
            Column(modifier = Modifier.fillMaxWidth().clip(shape).border(1.dp, MaterialTheme.colorScheme.outlineVariant, shape).padding(16.dp)) {
                Text(
                    stringResource(if (isOwn) Res.string.wallet_loyalty_empty else Res.string.wallet_loyalty_shared_empty),
                    style = MaterialTheme.typography.bodyLarge,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (isOwn && onAdd != null) {
                    OutlinedButton(onClick = onAdd, modifier = Modifier.padding(top = 12.dp)) {
                        Text(stringResource(Res.string.add_loyalty))
                    }
                }
            }
        } else {
            Column(modifier = Modifier.fillMaxWidth().clip(shape).border(1.dp, MaterialTheme.colorScheme.outlineVariant, shape)) {
                entries.forEachIndexed { idx, entry ->
                    if (idx > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    val summary = remember(entry) { loyaltySummary(entry) }
                    val foundMatch = remember(found, entry, isOwn) { if (isOwn) findFoundLoyalty(found, entry) else null }
                    val savedIdx = remember(savedIndexOf, entry, isOwn) { if (!isOwn) -1 else savedIndexOf(entry) }
                    var open by rememberSaveable(summary.title, summary.account, idx) { mutableStateOf(false) }
                    val statusText = if (summary.nextStatus != null && summary.status != null) "${summary.status} (next: ${summary.nextStatus})" else summary.status
                    val details = remember(entry) { entry.fields.filter { it.label != "Person" } }
                    Column(modifier = Modifier.fillMaxWidth()) {
                        Row(
                            verticalAlignment = Alignment.Top,
                            horizontalArrangement = Arrangement.spacedBy(12.dp),
                            modifier = Modifier.fillMaxWidth().clickable { open = !open }.padding(horizontal = 16.dp, vertical = 12.dp),
                        ) {
                            Column(modifier = Modifier.weight(1f)) {
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Text(summary.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                                    if (foundMatch != null && savedIdx < 0) {
                                        Text(
                                            stringResource(Res.string.from_emails_badge),
                                            style = MaterialTheme.typography.labelSmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                }
                                summary.account?.let {
                                    Text(it, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                            }
                            Column(horizontalAlignment = Alignment.End) {
                                summary.balance?.let { Text(it, style = MaterialTheme.typography.bodyLarge) }
                                statusText?.let { Text(it, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                            }
                        }
                        if (open) {
                            Column(modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, bottom = 12.dp)) {
                                HorizontalDivider(modifier = Modifier.padding(bottom = 8.dp), color = MaterialTheme.colorScheme.outlineVariant)
                                details.forEach { field ->
                                    Row(modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
                                        Text(field.label, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                                        Text(field.value, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1.2f))
                                    }
                                }
                                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                                    summary.account?.let { num ->
                                        OutlinedButton(onClick = { chrome.copyToClipboard(summary.title, num) }) {
                                            Text(stringResource(Res.string.copy_number))
                                        }
                                    }
                                    if (isOwn && summary.account != null && onWhose != null) {
                                        val whoseLabel = stringResource(Res.string.whose_is, summary.title, summary.account!!)
                                        OutlinedButton(
                                            onClick = { onWhose(summary.title, summary.account!!) },
                                            modifier = Modifier.semantics { contentDescription = whoseLabel },
                                        ) { Text(stringResource(Res.string.whose_is_this)) }
                                    }
                                    if (isOwn && savedIdx >= 0 && onEditSaved != null) {
                                        OutlinedButton(onClick = { onEditSaved(savedIdx, entry) }) { Text(stringResource(Res.string.edit)) }
                                    }
                                    if (isOwn && savedIdx >= 0 && onRemoveSaved != null) {
                                        OutlinedButton(onClick = { onRemoveSaved(savedIdx) }) { Text(stringResource(Res.string.remove)) }
                                    }
                                    if (isOwn && savedIdx < 0 && foundMatch != null && onRemoveFound != null) {
                                        val removeLabel = stringResource(Res.string.remove_found_loyalty, foundMatch.program)
                                        OutlinedButton(
                                            onClick = { onRemoveFound(foundMatch) },
                                            modifier = Modifier.semantics { contentDescription = removeLabel },
                                        ) { Text(stringResource(Res.string.remove)) }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WalletDocumentDialog(
    initial: DocumentInput?,
    existing: ProfileEntry? = null,
    saving: Boolean = false,
    error: String? = null,
    onSave: (ProfileEntry) -> Unit,
    onDismiss: () -> Unit,
) {
    var type by remember { mutableStateOf(initial?.type ?: DocumentInputType.PASSPORT) }
    var title by remember { mutableStateOf(initial?.title.orEmpty()) }
    var country by remember { mutableStateOf(initial?.country.orEmpty()) }
    var number by remember { mutableStateOf(initial?.number.orEmpty()) }
    var expires by remember { mutableStateOf(initial?.expires.orEmpty()) }
    var issued by remember { mutableStateOf(initial?.issued.orEmpty()) }
    var notes by remember { mutableStateOf(initial?.notes.orEmpty()) }

    AlertDialog(
        onDismissRequest = { if (!saving) onDismiss() },
        title = { Text(stringResource(if (initial != null) Res.string.edit_document else Res.string.add_document)) },
        text = {
            Column(
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.verticalScroll(rememberScrollState()),
            ) {
                if (error != null) {
                    Text(error, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.error)
                }
                Text(stringResource(Res.string.document_type_label), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    DocumentInputType.entries.forEach { t ->
                        FilterChip(selected = type == t, onClick = { type = t }, label = { Text(t.label) })
                    }
                }
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    label = { Text(stringResource(Res.string.document_title_label)) },
                    placeholder = { Text(defaultDocumentTitle(type, country.ifBlank { null })) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = country,
                    onValueChange = { country = it },
                    label = { Text(stringResource(if (type == DocumentInputType.PASSPORT) Res.string.document_nationality_label else Res.string.document_country_label)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = number,
                    onValueChange = { number = it },
                    label = { Text(stringResource(Res.string.document_number_label)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = expires,
                    onValueChange = { expires = it },
                    label = { Text(stringResource(Res.string.document_expiry_label)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = issued,
                    onValueChange = { issued = it },
                    label = { Text(stringResource(Res.string.document_issued_label)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = notes,
                    onValueChange = { notes = it },
                    label = { Text(stringResource(Res.string.document_notes_label)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            Button(
                enabled = !saving,
                onClick = {
                    onSave(
                        buildDocumentEntry(
                            DocumentInput(
                                type = type,
                                title = title.trim().ifEmpty { defaultDocumentTitle(type, country.ifBlank { null }) },
                                country = country.trim().ifEmpty { null },
                                number = number.trim().ifEmpty { null },
                                expires = expires.trim().ifEmpty { null },
                                issued = issued.trim().ifEmpty { null },
                                notes = notes.trim().ifEmpty { null },
                            ),
                            existing = existing,
                        ),
                    )
                },
            ) { Text(stringResource(Res.string.save)) }
        },
        dismissButton = {
            TextButton(enabled = !saving, onClick = onDismiss) { Text(stringResource(Res.string.cancel)) }
        },
    )
}

@Composable
private fun WalletLoyaltyDialog(
    initial: LoyaltyInput?,
    existing: ProfileEntry? = null,
    editing: Boolean,
    saving: Boolean = false,
    error: String? = null,
    onSave: (ProfileEntry) -> Unit,
    onDismiss: () -> Unit,
) {
    var program by remember { mutableStateOf(initial?.program.orEmpty()) }
    var number by remember { mutableStateOf(initial?.number.orEmpty()) }
    var status by remember { mutableStateOf(initial?.status.orEmpty()) }
    var balance by remember { mutableStateOf(initial?.balance.orEmpty()) }
    var person by remember { mutableStateOf(initial?.person.orEmpty()) }

    AlertDialog(
        onDismissRequest = { if (!saving) onDismiss() },
        title = { Text(stringResource(if (editing) Res.string.edit_loyalty else Res.string.add_loyalty)) },
        text = {
            Column(
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier.verticalScroll(rememberScrollState()),
            ) {
                if (error != null) {
                    Text(error, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.error)
                }
                OutlinedTextField(
                    value = program,
                    onValueChange = { program = it },
                    label = { Text(stringResource(Res.string.loyalty_program_label)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = number,
                    onValueChange = { number = it },
                    label = { Text(stringResource(Res.string.loyalty_number_label)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = status,
                    onValueChange = { status = it },
                    label = { Text(stringResource(Res.string.loyalty_status_label)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = balance,
                    onValueChange = { balance = it },
                    label = { Text(stringResource(Res.string.loyalty_balance_label)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = person,
                    onValueChange = { person = it },
                    label = { Text(stringResource(Res.string.loyalty_person_label)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        },
        confirmButton = {
            Button(
                enabled = !saving && program.isNotBlank(),
                onClick = {
                    onSave(
                        buildLoyaltyEntry(
                            LoyaltyInput(
                                program = program.trim(),
                                number = number.trim().ifEmpty { null },
                                status = status.trim().ifEmpty { null },
                                balance = balance.trim().ifEmpty { null },
                                person = person.trim().ifEmpty { null },
                            ),
                            existing = existing,
                            updatedAt = kotlin.time.Clock.System.now().toString(),
                        ),
                    )
                },
            ) { Text(stringResource(Res.string.save)) }
        },
        dismissButton = {
            TextButton(enabled = !saving, onClick = onDismiss) { Text(stringResource(Res.string.cancel)) }
        },
    )
}

/** Home sub-page rendered inside SettingsSectionScreen. */
@Composable
internal fun HomeSettingsContent(viewModel: TripsViewModel) {
    LaunchedEffect(viewModel) { viewModel.refreshUnconfirmedSegments() }
    HomeSection(viewModel)
}

/** People sub-page rendered inside SettingsSectionScreen. */
@Composable
internal fun PeopleSettingsContent(viewModel: TripsViewModel) {
    val profile by viewModel.ownProfile.collectAsStateWithLifecycle()
    val travelers by viewModel.travelers.collectAsStateWithLifecycle()
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    val me = remember(travelers) { guessMe(travelers) }
    var changingMe by rememberSaveable { mutableStateOf(false) }
    var merging by rememberSaveable { mutableStateOf<String?>(null) }

    if (changingMe) {
        me?.let { currentMe ->
            PeoplePicker(
                stringResource(Res.string.who_are_you),
                travelers,
                except = currentMe.id,
                onPick = { viewModel.setMe(PEOPLE_TOKEN, it) },
                onDismiss = { changingMe = false },
            )
        }
    }

    merging?.let { id ->
        travelers.firstOrNull { it.id == id }?.let { person ->
            PeoplePicker(
                stringResource(Res.string.same_person_as_title, person.name),
                travelers,
                except = id,
                onPick = { viewModel.mergePeople(PEOPLE_TOKEN, id, it) },
                onDismiss = { merging = null },
            )
        }
    }

    val imported = profile?.travelers.orEmpty()
    val detailsByPerson = remember(travelers, imported) {
        val byPerson = mutableMapOf<String, MutableList<ProfileEntry>>()
        for (entry in imported) {
            val matched = if (travelers.isNotEmpty()) findPerson(travelers, entry.title) else null
            if (matched != null) byPerson.getOrPut(matched.id) { mutableListOf() } += entry
        }
        byPerson
    }
    val unmatched = remember(travelers, imported) {
        imported.filter { entry -> travelers.isEmpty() || findPerson(travelers, entry.title) == null }
    }

    Text(stringResource(Res.string.people_hint), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 8.dp))
    if (travelers.isEmpty() && unmatched.isEmpty()) {
        Text(stringResource(Res.string.profile_no_people), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
    } else {
        me?.let { currentMe ->
            val shape = RoundedCornerShape(12.dp)
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 8.dp)
                    .clip(shape)
                    .border(1.dp, MaterialTheme.colorScheme.outlineVariant, shape)
                    .padding(horizontal = 16.dp, vertical = 12.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(stringResource(Res.string.you).uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(currentMe.name, style = MaterialTheme.typography.bodyLarge)
                        }
                        if (currentMe.aliases.isNotEmpty()) {
                            Text(
                                stringResource(Res.string.also_known_as, currentMe.aliases.joinToString(", ")),
                                style = MaterialTheme.typography.bodyLarge,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(top = 2.dp),
                            )
                        }
                    }
                    if (travelers.size > 1) {
                        TextButton(onClick = { changingMe = true }) { Text(stringResource(Res.string.change)) }
                    }
                }
                for (extra in detailsByPerson[currentMe.id].orEmpty()) {
                    FoldingEntry(extra, titleOverride = stringResource(Res.string.profile_imported_details))
                }
            }
        }
        val others = if (me != null) travelers.filter { it.id != me.id } else travelers
        others.forEach { person ->
            val extra = detailsByPerson[person.id].orEmpty()
            Column(modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                    Column(modifier = Modifier.weight(1f).padding(vertical = 4.dp)) {
                        Text(person.name, style = MaterialTheme.typography.bodyLarge)
                        if (person.aliases.isNotEmpty()) {
                            Text(
                                stringResource(Res.string.also_known_as, person.aliases.joinToString(", ")),
                                style = MaterialTheme.typography.bodyLarge,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    if (me != null) {
                        TextButton(onClick = { viewModel.mergePeople(PEOPLE_TOKEN, person.id, me.id) }) { Text(stringResource(Res.string.also_me)) }
                    }
                    if (others.size > 1) {
                        TextButton(onClick = { merging = person.id }) { Text(stringResource(Res.string.same_person_as)) }
                    }
                }
                extra.forEach { entry ->
                    FoldingEntry(entry, titleOverride = stringResource(Res.string.profile_imported_details))
                }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }
        if (unmatched.isNotEmpty()) {
            if (travelers.isNotEmpty()) SectionTitle(stringResource(Res.string.profile_from_imports))
            unmatched.forEach { entry -> FoldingEntry(entry) }
        }
    }
    (outcomes[PEOPLE_TOKEN] as? Outcome.Failed)?.let {
        Text(it.message, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(top = 8.dp))
    }
}

/** Wallet sharing sub-page rendered inside SettingsSectionScreen. */
@Composable
internal fun WalletSharingSettingsContent(viewModel: TripsViewModel) {
    val profile by viewModel.ownProfile.collectAsStateWithLifecycle()
    val shared by viewModel.sharedProfiles.collectAsStateWithLifecycle()
    val loaded by viewModel.profileLoaded.collectAsStateWithLifecycle()
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    LaunchedEffect(outcomes[SHARE_TOKEN]) { if (outcomes[SHARE_TOKEN] is Outcome.Done) viewModel.outcomeSeen(SHARE_TOKEN) }

    val own = profile
    val others = remember(shared, own?.ownerUid) { shared.filter { it.ownerUid != own?.ownerUid } }
    Sharing(
        trusted = own?.trustedEmails.orEmpty(),
        busy = !loaded || outcomes[SHARE_TOKEN] is Outcome.Busy,
        error = (outcomes[SHARE_TOKEN] as? Outcome.Failed)?.message,
        onSave = { viewModel.saveTrusted(SHARE_TOKEN, it) },
    )
    if (others.isNotEmpty()) {
        SectionTitle(stringResource(Res.string.shared_with_you))
        Text(
            stringResource(Res.string.wallet_shared_with_you_hint),
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(bottom = 8.dp),
        )
        val shape = RoundedCornerShape(12.dp)
        Column(modifier = Modifier.fillMaxWidth().clip(shape).border(1.dp, MaterialTheme.colorScheme.outlineVariant, shape)) {
            others.forEachIndexed { index, p ->
                if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Text(
                    p.ownerEmail ?: stringResource(Res.string.someone_who_trusts_you),
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                )
            }
        }
    }
}

private fun LazyListScope.peopleSectionBody(
    travelers: List<Person>,
    me: Person?,
    imported: List<ProfileEntry>,
    error: String?,
    onChangeMe: () -> Unit,
    onAlsoMe: (String) -> Unit,
    onMerge: (String) -> Unit,
) {
    val detailsByPerson = mutableMapOf<String, MutableList<ProfileEntry>>()
    val unmatched = mutableListOf<ProfileEntry>()
    for (entry in imported) {
        val matched = if (travelers.isNotEmpty()) findPerson(travelers, entry.title) else null
        if (matched != null) {
            detailsByPerson.getOrPut(matched.id) { mutableListOf() }.add(entry)
        } else {
            unmatched.add(entry)
        }
    }

    item(key = "people-hint") {
        Text(stringResource(Res.string.people_hint), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(bottom = 8.dp))
    }
    if (travelers.isEmpty() && unmatched.isEmpty()) {
        item(key = "people-empty") {
            Text(stringResource(Res.string.profile_no_people), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        return
    }
    me?.let { currentMe ->
        item(key = "person-you") {
            val shape = RoundedCornerShape(12.dp)
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(bottom = 8.dp)
                    .clip(shape)
                    .border(1.dp, MaterialTheme.colorScheme.outlineVariant, shape)
                    .padding(horizontal = 16.dp, vertical = 12.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                    Column(modifier = Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(stringResource(Res.string.you).uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Text(currentMe.name, style = MaterialTheme.typography.bodyLarge)
                        }
                        if (currentMe.aliases.isNotEmpty()) {
                            Text(
                                stringResource(Res.string.also_known_as, currentMe.aliases.joinToString(", ")),
                                style = MaterialTheme.typography.bodyLarge,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(top = 2.dp),
                            )
                        }
                    }
                    if (travelers.size > 1) {
                        TextButton(onClick = onChangeMe) { Text(stringResource(Res.string.change)) }
                    }
                }
                for (extra in detailsByPerson[currentMe.id].orEmpty()) {
                    FoldingEntry(extra, titleOverride = stringResource(Res.string.profile_imported_details))
                }
            }
        }
    }
    val others = if (me != null) travelers.filter { it.id != me.id } else travelers
    items(others, key = { "person-${it.id}" }) { person ->
        Column(modifier = Modifier.fillMaxWidth()) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                Column(modifier = Modifier.weight(1f).padding(vertical = 4.dp)) {
                    Text(person.name, style = MaterialTheme.typography.bodyLarge)
                    if (person.aliases.isNotEmpty()) {
                        Text(
                            stringResource(Res.string.also_known_as, person.aliases.joinToString(", ")),
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
                if (me != null) {
                    TextButton(onClick = { onAlsoMe(person.id) }) { Text(stringResource(Res.string.also_me)) }
                }
                if (others.size > 1) {
                    TextButton(onClick = { onMerge(person.id) }) { Text(stringResource(Res.string.same_person_as)) }
                }
            }
            for (extra in detailsByPerson[person.id].orEmpty()) {
                FoldingEntry(extra, titleOverride = stringResource(Res.string.profile_imported_details))
            }
        }
    }
    if (unmatched.isNotEmpty()) {
        if (travelers.isNotEmpty()) {
            item(key = "people-imports-title") { SectionTitle(stringResource(Res.string.profile_from_imports)) }
        }
        for ((i, entry) in unmatched.withIndex()) {
            item(key = "people-import-$i") { FoldingEntry(entry) }
        }
    }
    error?.let { message ->
        item(key = "people-error") { Text(message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(top = 8.dp)) }
    }
}

/**
 * Unified loyalty list: replaces the cramped 4-column table, the separate
 * "Found in your emails" list, and the separate "Loyalty program details" list
 * with expandable rows and person filter chips.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LoyaltyList(
    groups: List<LoyaltyGroup>,
    found: List<FoundLoyalty>,
    isOwn: Boolean,
    onWhose: ((program: String, number: String) -> Unit)? = null,
    onRemoveFound: ((FoundLoyalty) -> Unit)? = null,
    onWhoIs: ((name: String) -> Unit)? = null,
    error: String? = null,
) {
    var filter by rememberSaveable { mutableStateOf<String?>(null) } // null = All, "" = You/Theirs, else person name
    val showFilter = groups.size > 1
    val activeFilter = if (showFilter && (filter == null || groups.any { (it.person ?: "") == filter })) filter else null
    val visibleGroups = if (activeFilter == null) groups else groups.filter { (it.person ?: "") == activeFilter }

    Column(modifier = Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (showFilter) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                FilterChip(
                    selected = activeFilter == null,
                    onClick = { filter = null },
                    label = { Text(stringResource(Res.string.profile_all)) },
                )
                for (g in groups) {
                    val key = g.person ?: ""
                    val label = g.person ?: stringResource(if (isOwn) Res.string.loyalty_you else Res.string.loyalty_theirs)
                    FilterChip(
                        selected = activeFilter == key,
                        onClick = { filter = key },
                        label = { Text(label) },
                    )
                }
            }
        }
        for (group in visibleGroups) {
            val named = groups.size > 1 || group.person != null
            if (named) {
                val name = group.person ?: stringResource(if (isOwn) Res.string.loyalty_you else Res.string.loyalty_theirs)
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
                    Text(
                        name,
                        style = MaterialTheme.typography.titleMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.weight(1f).semantics { heading() },
                    )
                    val person = group.person
                    if (person != null && onWhoIs != null) {
                        TextButton(onClick = { onWhoIs(person) }) { Text(stringResource(Res.string.same_person_as)) }
                    }
                }
            }
            for ((index, entry) in group.entries.withIndex()) {
                val foundMatch = if (isOwn && onRemoveFound != null) findFoundLoyalty(found, entry) else null
                LoyaltyCard(
                    entry = entry,
                    key = "${group.person.orEmpty()}-${entry.title}-$index",
                    foundMatch = foundMatch,
                    onWhose = onWhose,
                    onRemoveFound = onRemoveFound,
                )
            }
        }
        error?.let { message ->
            Text(message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(top = 4.dp))
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun LoyaltyCard(
    entry: ProfileEntry,
    key: String,
    foundMatch: FoundLoyalty?,
    onWhose: ((program: String, number: String) -> Unit)?,
    onRemoveFound: ((FoundLoyalty) -> Unit)?,
) {
    val s = remember(entry) { loyaltySummary(entry) }
    val statusText = if (s.status != null && s.nextStatus != null) "${s.status} (next: ${s.nextStatus})" else s.status
    val details = remember(entry) { entry.fields.filterNot { it.label == "Person" } }
    var open by rememberSaveable(key) { mutableStateOf(false) }
    val shape = RoundedCornerShape(8.dp)

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(shape)
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, shape)
            .clickable { open = !open }
            .padding(horizontal = 12.dp, vertical = 10.dp),
    ) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
            Column(modifier = Modifier.weight(1f)) {
                Text(s.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
                s.account?.let {
                    Text(it, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Column(horizontalAlignment = Alignment.End) {
                s.balance?.let { Text(it, style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.End) }
                statusText?.let { Text(it, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.End) }
            }
        }
        if (open) {
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant, modifier = Modifier.padding(vertical = 8.dp))
            for (field in details) {
                Row(modifier = Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Text(field.label, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                    Text(field.value, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1.4f))
                }
            }
            val account = s.account
            if ((onWhose != null && account != null) || (onRemoveFound != null && foundMatch != null)) {
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                    modifier = Modifier.padding(top = 10.dp),
                ) {
                    if (onWhose != null && account != null) {
                        val whoseDesc = stringResource(Res.string.whose_is, s.title, account)
                        OutlinedButton(
                            onClick = { onWhose(s.title, account) },
                            modifier = Modifier.semantics { contentDescription = whoseDesc },
                        ) {
                            Text(stringResource(Res.string.whose_is_this))
                        }
                    }
                    if (onRemoveFound != null && foundMatch != null) {
                        val removeDesc = stringResource(Res.string.remove_found_loyalty, foundMatch.program)
                        OutlinedButton(
                            onClick = { onRemoveFound(foundMatch) },
                            modifier = Modifier.semantics { contentDescription = removeDesc },
                        ) {
                            Text(stringResource(Res.string.remove))
                        }
                    }
                }
            }
        }
    }
}

private const val SHARE_TOKEN = "profile/share"
private const val FOUND_PREFIX = "profile/found/"
private const val PERSON_PREFIX = "profile/person/"
private const val HOME_TOKEN = "profile/home"

/**
 * Who a membership belongs to: the owner, someone already named, or, as a
 * second step, someone new by name.
 */
@Composable
private fun PersonDialog(program: String, number: String, people: List<String>, onPick: (String?) -> Unit, onDismiss: () -> Unit) {
    var naming by rememberSaveable { mutableStateOf(false) }
    var name by rememberSaveable { mutableStateOf("") }
    val pick = { person: String? ->
        onPick(person)
        onDismiss()
    }
    AppAlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(Res.string.whose_is, program, number)) },
        text = {
            if (naming) {
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it.take(80) },
                    label = { Text(stringResource(Res.string.someone_else)) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            } else {
                // Scrolls, so every person stays reachable however many there are.
                Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
                    for ((label, person) in listOf(stringResource(Res.string.loyalty_mine) to null) + people.map { it to it }) {
                        TextButton(onClick = { pick(person) }, modifier = Modifier.fillMaxWidth()) {
                            Text(label, modifier = Modifier.fillMaxWidth())
                        }
                    }
                    TextButton(onClick = { naming = true }, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(Res.string.someone_else_more), modifier = Modifier.fillMaxWidth())
                    }
                }
            }
        },
        confirmButton = {
            if (naming) TextButton(onClick = { pick(name.trim()) }, enabled = name.isNotBlank()) { Text(stringResource(Res.string.save)) }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(Res.string.cancel)) } },
    )
}

/**
 * Which of the user's people someone is ("Same person as…"):
 * the user first, then as People lists them, less [except].
 */
@Composable
private fun PeoplePicker(title: String, people: List<Person>, except: String?, onPick: (String) -> Unit, onDismiss: () -> Unit) {
    val me = guessMe(people)
    val listed = (people.filter { it.id == me?.id } + people.filter { it.id != me?.id }).filter { it.id != except }
    AppAlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            // Scrolls, so every person stays reachable however many there are.
            Column(modifier = Modifier.verticalScroll(rememberScrollState())) {
                for (person in listed) {
                    TextButton(
                        onClick = {
                            onPick(person.id)
                            onDismiss()
                        },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(person.name, modifier = Modifier.weight(1f))
                        if (person.id == me?.id) {
                            Text(stringResource(Res.string.you).uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text(stringResource(Res.string.cancel)) } },
    )
}

/**
 * Who the profile is shared with, as the web's page has it: each address
 * removable, an on-demand form to add one, and what sharing means.
 */
@Composable
private fun Sharing(trusted: List<String>, busy: Boolean, error: String?, onSave: (List<String>) -> Unit) {
    var adding by rememberSaveable { mutableStateOf(false) }
    var address by rememberSaveable { mutableStateOf("") }
    // An address the form itself refuses, kept in the field to be corrected; a refusal from the write comes from the caller.
    var formError by rememberSaveable { mutableStateOf<String?>(null) }
    val notAnAddress = stringResource(Res.string.enter_email)
    Column(modifier = Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(Res.string.shared_with), style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f).semantics { heading() })
            if (trusted.size < MAX_TRUSTED) {
                TextButton(
                    onClick = {
                        adding = !adding
                        formError = null
                    },
                    enabled = !busy,
                ) {
                    Text(stringResource(if (adding) Res.string.cancel else Res.string.share_with_someone))
                }
            }
        }
        Text(stringResource(Res.string.share_profile_hint), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (adding) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                OutlinedTextField(
                    value = address,
                    onValueChange = { address = it },
                    placeholder = { Text("name@example.com") },
                    singleLine = true,
                    modifier = Modifier.weight(1f),
                )
                Button(
                    onClick = {
                        if (address.contains("@")) {
                            formError = null
                            onSave(trusted + address)
                            address = ""
                            adding = false
                        } else {
                            formError = notAnAddress
                        }
                    },
                    enabled = !busy && address.isNotBlank() && trusted.size < MAX_TRUSTED,
                ) { Text(stringResource(Res.string.share)) }
            }
        }
        if (trusted.isEmpty()) {
            Text(stringResource(Res.string.only_you), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
        }
        for (email in trusted) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Text(email, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                IconButton(onClick = { onSave(trusted - email) }, enabled = !busy) {
                    Icon(Icons.Filled.Close, contentDescription = stringResource(Res.string.stop_sharing_with, email))
                }
            }
        }
        (formError ?: error)?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(top = 8.dp)) }
    }
}

/**
 * The Profile's home, as on the web: where home has been, worked out from
 * the user's trips with their corrections over it; each correction with
 * Remove; an on-demand "Add home" form; long stays; and home airports.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun HomeSection(viewModel: TripsViewModel) {
    LaunchedEffect(viewModel) { viewModel.refreshUnconfirmedSegments() }
    val homes by viewModel.reportHomes.collectAsStateWithLifecycle()
    val unreadable by viewModel.reportUnreadable.collectAsStateWithLifecycle()
    val settings by viewModel.rideSettings.collectAsStateWithLifecycle()
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    val outcome = outcomes[HOME_TOKEN]
    val busy = outcome is Outcome.Busy
    var showForm by rememberSaveable { mutableStateOf(false) }
    var city by rememberSaveable { mutableStateOf("") }
    var country by rememberSaveable { mutableStateOf("") }
    var from by rememberSaveable { mutableStateOf<String?>(null) }
    var picking by rememberSaveable { mutableStateOf(false) }
    var problem by rememberSaveable { mutableStateOf<String?>(null) }
    // Cleared once an addition is saved; a removal leaves the form alone.
    var adding by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(outcome) {
        if (outcome is Outcome.Done) {
            if (adding) {
                city = ""
                country = ""
                from = null
                adding = false
                showForm = false
            }
            viewModel.outcomeSeen(HOME_TOKEN)
        }
    }
    val periods = homes
    val corrections = settings?.homes
    Column(modifier = Modifier.fillMaxWidth()) {
        if (corrections == null) {
            Text(stringResource(Res.string.loading), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            return@Column
        }
        // Home over time waits for every trip's bookings; the corrections and adding one don't.
        when {
            periods != null -> {
                Text(homeLine(periods) ?: stringResource(Res.string.home_not_known), style = MaterialTheme.typography.bodyLarge)
                Text(stringResource(Res.string.home_worked_out), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            unreadable > 0 -> Unreadable(unreadable, viewModel::retryReports, Res.plurals.trips_unreadable_home)
            else -> Text(stringResource(Res.string.loading), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Row(modifier = Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.End) {
            OutlinedButton(
                onClick = {
                    showForm = !showForm
                    problem = null
                },
                enabled = !busy,
            ) {
                Text(stringResource(if (showForm) Res.string.cancel else Res.string.add_home))
            }
        }
        if (showForm) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
                OutlinedTextField(value = city, onValueChange = { city = it; problem = null }, label = { Text(stringResource(Res.string.city)) }, singleLine = true, enabled = !busy, modifier = Modifier.weight(1f))
                OutlinedTextField(value = country, onValueChange = { country = it; problem = null }, label = { Text(stringResource(Res.string.country)) }, placeholder = { Text("GB") }, singleLine = true, enabled = !busy, modifier = Modifier.weight(1f))
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
                OutlinedButton(onClick = { picking = true }, enabled = !busy) {
                    Text(from?.let { stringResource(Res.string.home_from_date, formatDateWithYear(it)) } ?: stringResource(Res.string.home_pick_from))
                }
                Button(
                    onClick = {
                        when (val parsed = parseCorrection(city, country, from.orEmpty())) {
                            is ParsedCorrection.Problem -> problem = parsed.text
                            is ParsedCorrection.Correction -> {
                                problem = null
                                adding = true
                                viewModel.addHomeCorrection(HOME_TOKEN, parsed.correction)
                            }
                        }
                    },
                    enabled = !busy && city.isNotBlank() && from != null,
                ) { Text(stringResource(Res.string.set)) }
            }
        }
        val sortedCorrections = remember(corrections) { corrections.sortedBy { it.from } }
        for (c in sortedCorrections) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                Text(correctionText(c), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                IconButton(onClick = { adding = false; viewModel.removeHomeCorrection(HOME_TOKEN, c.from) }, enabled = !busy) {
                    Icon(Icons.Filled.Close, contentDescription = stringResource(Res.string.remove_home, correctionText(c)))
                }
            }
        }
        (problem ?: (outcome as? Outcome.Failed)?.message)?.let {
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(top = 8.dp))
        }
        if (periods != null) LongStays(viewModel, periods)
        if (periods != null) HomeAirports(viewModel, periods)
    }
    if (picking) {
        // Opens on the date chosen, else today.
        val initial = pickerMillis(from ?: today())
        val state = rememberDatePickerState(initialSelectedDateMillis = initial)
        DatePickerDialog(
            onDismissRequest = { picking = false },
            confirmButton = {
                TextButton(onClick = {
                    // The picker answers in UTC midnights.
                    from = state.selectedDateMillis?.let { pickerDate(it) } ?: from
                    problem = null
                    picking = false
                }) { Text(stringResource(Res.string.ok)) }
            },
            dismissButton = { TextButton(onClick = { picking = false }) { Text(stringResource(Res.string.cancel)) } },
        ) { DatePicker(state = state) }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Text(text, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 20.dp, bottom = 8.dp).semantics { heading() })
}

@Composable
private fun FoldingEntry(entry: ProfileEntry, titleOverride: String? = null) {
    val label = titleOverride ?: entry.title
    var open by rememberSaveable("${entry.title}-$label") { mutableStateOf(false) }
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(bottom = 8.dp)
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(8.dp))
            .clickable { open = !open }
            .padding(horizontal = 12.dp, vertical = 8.dp),
    ) {
        Text((if (open) "▾ " else "▸ ") + label, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.Medium)
        if (open) {
            for (field in entry.fields) {
                Row(modifier = Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Text(field.label, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                    Text(field.value, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1.4f))
                }
            }
        }
    }
}

private const val NOT_HOME_TOKEN = "profile/not-home"

/**
 * Four weeks or more staying in one town count as living there: listed under home, newest first, as the web's Profile
 * lists them, each with Not home for a holiday, which regroups it as a trip.
 */
@Composable
private fun LongStays(viewModel: TripsViewModel, periods: List<HomePeriod>) {
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    val outcome = outcomes[NOT_HOME_TOKEN]
    val busy = outcome is Outcome.Busy
    LaunchedEffect(outcome) { if (outcome is Outcome.Done) viewModel.outcomeSeen(NOT_HOME_TOKEN) }
    val stays = remember(periods) { periods.filter { it.stay && it.from != null }.reversed() }
    for (stay in stays) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
            Text(
                buildAnnotatedString {
                    append(longStayText(stay))
                    withStyle(SpanStyle(color = MaterialTheme.colorScheme.onSurfaceVariant)) { append(" · " + stringResource(Res.string.from_your_stays)) }
                },
                style = MaterialTheme.typography.bodyLarge,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = { viewModel.markNotHome(NOT_HOME_TOKEN, stay) }, enabled = !busy) { Text(stringResource(Res.string.not_home)) }
        }
    }
    (outcome as? Outcome.Failed)?.message?.let {
        Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(top = 8.dp))
    }
}

private const val HOME_AIRPORTS_TOKEN = "profile/home-airports"

/**
 * Each home's airports and stations, as the web's Profile lists them: a
 * journey back into one ends a trip. Worked out from the trips that leave
 * from them unless chosen here; Edit takes their codes.
 */
@Composable
private fun HomeAirports(viewModel: TripsViewModel, periods: List<HomePeriod>) {
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    val outcome = outcomes[HOME_AIRPORTS_TOKEN]
    val busy = outcome is Outcome.Busy
    var editing by rememberSaveable { mutableStateOf<String?>(null) }
    var codes by rememberSaveable { mutableStateOf("") }
    var problem by rememberSaveable { mutableStateOf<String?>(null) }
    LaunchedEffect(outcome) {
        if (outcome is Outcome.Done) {
            editing = null
            viewModel.outcomeSeen(HOME_AIRPORTS_TOKEN)
        }
    }
    // One row per home town, its latest period's airports.
    // A long stay takes the airports of the home it is in, else those found.
    val towns = remember(periods) { periods.filterNot { it.stay }.associateBy { homeTownKey(it.city, it.country) } }
    for ((key, period) in towns) {
        val shown = airportCodes(period)
        if (editing == key) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
                OutlinedTextField(
                    value = codes,
                    onValueChange = { codes = it; problem = null },
                    label = { Text(stringResource(Res.string.home_airports_label, period.city)) },
                    placeholder = { Text("SFO, SJC") },
                    singleLine = true,
                    enabled = !busy,
                    modifier = Modifier.weight(1f),
                )
                Button(
                    onClick = {
                        when (val parsed = parseAirportCodes(codes)) {
                            is ParsedAirports.Problem -> problem = parsed.text
                            is ParsedAirports.Codes -> viewModel.setHomeAirports(HOME_AIRPORTS_TOKEN, period.city, period.country, parsed.codes)
                        }
                    },
                    enabled = !busy,
                ) { Text(stringResource(Res.string.save)) }
            }
        } else {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().padding(top = 8.dp)) {
                Text(
                    stringResource(Res.string.home_airports, period.city, if (shown.isEmpty()) stringResource(Res.string.home_airports_none) else shown.joinToString(", ")),
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.weight(1f),
                )
                val editLabel = stringResource(Res.string.edit_home_airports, period.city)
                TextButton(
                    onClick = { editing = key; codes = shown.joinToString(", "); problem = null },
                    modifier = Modifier.semantics { contentDescription = editLabel },
                ) { Text(stringResource(Res.string.edit)) }
            }
        }
    }
    (problem ?: (outcome as? Outcome.Failed)?.message)?.let {
        Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.padding(top = 8.dp))
    }
}

/** The token of People's "Change", "Also me", and merges. */
private const val PEOPLE_TOKEN = "profile/people/me"

/** The token of Loyalty's "Same person as…" write. */
private const val WHO_IS_TOKEN = "profile/loyalty/who-is"
