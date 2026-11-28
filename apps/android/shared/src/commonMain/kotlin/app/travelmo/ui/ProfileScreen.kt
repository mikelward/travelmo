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
import androidx.compose.material.icons.filled.Close
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
import app.travelmo.core.AccessBadge
import app.travelmo.core.FoundLoyalty
import app.travelmo.core.HomePeriod
import app.travelmo.core.LoyaltyGroup
import app.travelmo.core.MAX_TRUSTED
import app.travelmo.core.ParsedAirports
import app.travelmo.core.ParsedCorrection
import app.travelmo.core.Person
import app.travelmo.core.ProfileEntry
import app.travelmo.core.TravelProfile
import app.travelmo.core.accessBadge
import app.travelmo.core.airportCodes
import app.travelmo.core.allLoyalty
import app.travelmo.core.correctionText
import app.travelmo.core.findFoundLoyalty
import app.travelmo.core.findPerson
import app.travelmo.core.formatDateWithYear
import app.travelmo.core.guessMe
import app.travelmo.core.homeLine
import app.travelmo.core.homeTownKey
import app.travelmo.core.longStayText
import app.travelmo.core.loyaltyByPerson
import app.travelmo.core.loyaltySummary
import app.travelmo.core.parseAirportCodes
import app.travelmo.core.parseCorrection
import app.travelmo.core.today
import app.travelmo.shared.Res
import app.travelmo.shared.add_home
import app.travelmo.shared.badge_admin
import app.travelmo.shared.badge_invited
import app.travelmo.shared.cancel
import app.travelmo.shared.city
import app.travelmo.shared.country
import app.travelmo.shared.documents
import app.travelmo.shared.edit
import app.travelmo.shared.edit_home_airports
import app.travelmo.shared.enter_email
import app.travelmo.shared.from_sender
import app.travelmo.shared.from_your_stays
import app.travelmo.shared.home
import app.travelmo.shared.home_airports
import app.travelmo.shared.home_airports_label
import app.travelmo.shared.home_airports_none
import app.travelmo.shared.home_cant_read_all
import app.travelmo.shared.home_from_date
import app.travelmo.shared.home_not_known
import app.travelmo.shared.home_pick_from
import app.travelmo.shared.home_worked_out
import app.travelmo.shared.loading
import app.travelmo.shared.loyalty_mine
import app.travelmo.shared.loyalty_programs
import app.travelmo.shared.loyalty_theirs
import app.travelmo.shared.loyalty_you
import app.travelmo.shared.not_home
import app.travelmo.shared.ok
import app.travelmo.shared.only_you
import app.travelmo.shared.people
import app.travelmo.shared.people_hint
import app.travelmo.shared.profile
import app.travelmo.shared.profile_all
import app.travelmo.shared.profile_documents_count
import app.travelmo.shared.profile_empty
import app.travelmo.shared.profile_from_imports
import app.travelmo.shared.profile_imported_details
import app.travelmo.shared.profile_no_people
import app.travelmo.shared.profile_none_yet
import app.travelmo.shared.profile_nothing_yet
import app.travelmo.shared.profile_people_count
import app.travelmo.shared.profile_programs_count
import app.travelmo.shared.profile_shared_with_count
import app.travelmo.shared.profile_shared_with_you_count
import app.travelmo.shared.profile_sharing
import app.travelmo.shared.profile_you_name
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
import app.travelmo.shared.shared_with
import app.travelmo.shared.shared_with_you
import app.travelmo.shared.signed_in_as
import app.travelmo.shared.someone_else
import app.travelmo.shared.someone_else_more
import app.travelmo.shared.someone_who_trusts_you
import app.travelmo.shared.stop_sharing_with
import app.travelmo.shared.this_is_me
import app.travelmo.shared.travelers
import app.travelmo.shared.trips_unreadable_home
import app.travelmo.shared.whose_is
import app.travelmo.shared.whose_is_this
import app.travelmo.shared.you
import kotlinx.serialization.Serializable
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.pluralStringResource
import org.jetbrains.compose.resources.stringResource

/** The five sections of the travel profile hub, as on the web's /profile. */
@Serializable
enum class ProfileSection {
    DOCUMENTS,
    LOYALTY,
    PEOPLE,
    HOME,
    SHARING,
}

/**
 * The travel profile hub, mirroring the web's /profile: signed-in account,
 * then five summary rows split into Travel wallet (Documents, Loyalty) and
 * Trip setup & sharing (People, Home, Sharing).
 *
 * When [onOpenSection] is provided, tapping a row delegates to the caller's
 * navigation stack; otherwise local state handles drill-in so tests and
 * standalone previews can navigate directly.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileScreen(
    viewModel: TripsViewModel,
    onOpenSettings: () -> Unit,
    bottomBar: @Composable () -> Unit,
    onOpenSection: ((ProfileSection) -> Unit)? = null,
) {
    var localSection by rememberSaveable { mutableStateOf<ProfileSection?>(null) }
    var localSharedUid by rememberSaveable { mutableStateOf<String?>(null) }

    val activeSection = if (onOpenSection == null) localSection else null
    if (activeSection != null) {
        ProfileSectionScreen(
            viewModel = viewModel,
            section = activeSection,
            sharedUid = localSharedUid,
            onBack = {
                if (localSharedUid != null) localSharedUid = null else localSection = null
            },
            onOpenShared = { localSharedUid = it },
        )
        return
    }

    LaunchedEffect(viewModel) { viewModel.refreshUnconfirmedSegments() }
    val profile by viewModel.ownProfile.collectAsStateWithLifecycle()
    val shared by viewModel.sharedProfiles.collectAsStateWithLifecycle()
    val loaded by viewModel.profileLoaded.collectAsStateWithLifecycle()
    val travelers by viewModel.travelers.collectAsStateWithLifecycle()
    val access by viewModel.access.collectAsStateWithLifecycle()
    val homes by viewModel.reportHomes.collectAsStateWithLifecycle()
    val unreadable by viewModel.reportUnreadable.collectAsStateWithLifecycle()

    val own = profile
    val ownLoyalty = remember(own, travelers) { own?.let { allLoyalty(it, travelers) }.orEmpty() }
    val ownLoyaltyGroups = remember(ownLoyalty) { loyaltyByPerson(ownLoyalty) }
    val me = remember(travelers) { guessMe(travelers) }
    val others = remember(shared, own?.ownerUid) { shared.filter { it.ownerUid != own?.ownerUid } }

    val docsCount = own?.documents?.size ?: 0
    val docsMeta = when {
        !loaded -> stringResource(Res.string.loading)
        docsCount > 0 -> pluralStringResource(Res.plurals.profile_documents_count, docsCount, docsCount)
        else -> stringResource(Res.string.profile_none_yet)
    }

    val loyaltyMeta = when {
        !loaded -> stringResource(Res.string.loading)
        ownLoyalty.isEmpty() -> stringResource(Res.string.profile_none_yet)
        ownLoyaltyGroups.size > 1 ->
            pluralStringResource(Res.plurals.profile_programs_count, ownLoyalty.size, ownLoyalty.size) +
                " · " +
                pluralStringResource(Res.plurals.profile_people_count, ownLoyaltyGroups.size, ownLoyaltyGroups.size)
        else -> pluralStringResource(Res.plurals.profile_programs_count, ownLoyalty.size, ownLoyalty.size)
    }

    val peopleCount = if (travelers.isNotEmpty()) travelers.size else (own?.travelers?.size ?: 0)
    val peopleMeta = when {
        peopleCount == 0 -> stringResource(Res.string.profile_none_yet)
        me != null ->
            pluralStringResource(Res.plurals.profile_people_count, peopleCount, peopleCount) +
                " · " +
                stringResource(Res.string.profile_you_name, me.name)
        else -> pluralStringResource(Res.plurals.profile_people_count, peopleCount, peopleCount)
    }

    val homeMeta = when {
        homes != null -> homeLine(homes!!) ?: stringResource(Res.string.home_not_known)
        unreadable > 0 -> stringResource(Res.string.home_cant_read_all)
        else -> stringResource(Res.string.loading)
    }

    val trustedCount = own?.trustedEmails?.size ?: 0
    val sharingParts = buildList {
        if (trustedCount > 0) add(stringResource(Res.string.profile_shared_with_count, trustedCount))
        if (others.isNotEmpty()) add(stringResource(Res.string.profile_shared_with_you_count, others.size))
    }
    val sharingMeta = if (sharingParts.isEmpty()) stringResource(Res.string.only_you) else sharingParts.joinToString(" · ")

    val open: (ProfileSection) -> Unit = { section ->
        if (onOpenSection != null) onOpenSection(section) else localSection = section
    }

    Scaffold(topBar = { AppTopBar(stringResource(Res.string.profile), onOpenSettings = onOpenSettings) }, bottomBar = bottomBar) { padding ->
        val list = rememberLazyListState()
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).scrollEdgeCue(list, scrollCueColors()),
            state = list,
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            viewModel.verifiedEmail?.let { email ->
                item(key = "account") {
                    val badge = (access as? AccessState.Known)?.let { accessBadge(it.admin, email, it.record) }
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(Res.string.signed_in_as, email), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        badge?.let {
                            Text(
                                stringResource(if (it == AccessBadge.ADMIN) Res.string.badge_admin else Res.string.badge_invited).uppercase(),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(start = 8.dp),
                            )
                        }
                    }
                }
            }

            item(key = "hub") {
                HubGroup(
                    rows = listOf(
                        HubRow(stringResource(Res.string.documents), docsMeta) { open(ProfileSection.DOCUMENTS) },
                        HubRow(stringResource(Res.string.loyalty_programs), loyaltyMeta) { open(ProfileSection.LOYALTY) },
                        HubRow(stringResource(Res.string.people), peopleMeta) { open(ProfileSection.PEOPLE) },
                        HubRow(stringResource(Res.string.home), homeMeta) { open(ProfileSection.HOME) },
                        HubRow(stringResource(Res.string.profile_sharing), sharingMeta) { open(ProfileSection.SHARING) },
                    ),
                )
            }
        }
    }
}

/** A single section drilled into from the Profile hub (or a shared profile opened from Sharing). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileSectionScreen(
    viewModel: TripsViewModel,
    section: ProfileSection,
    sharedUid: String? = null,
    onBack: () -> Unit,
    onOpenShared: (String) -> Unit = {},
) {
    val profile by viewModel.ownProfile.collectAsStateWithLifecycle()
    val shared by viewModel.sharedProfiles.collectAsStateWithLifecycle()
    val outcomes by viewModel.outcomes.collectAsStateWithLifecycle()
    val loaded by viewModel.profileLoaded.collectAsStateWithLifecycle()
    val travelers by viewModel.travelers.collectAsStateWithLifecycle()

    LaunchedEffect(outcomes[SHARE_TOKEN]) { if (outcomes[SHARE_TOKEN] is Outcome.Done) viewModel.outcomeSeen(SHARE_TOKEN) }
    val removals = outcomes.filterKeys { it.startsWith(FOUND_PREFIX) }
    val removalError = removals.values.filterIsInstance<Outcome.Failed>().lastOrNull()?.message
    LaunchedEffect(removals) { for ((token, outcome) in removals) if (outcome is Outcome.Done) viewModel.outcomeSeen(token) }
    val whose = outcomes.filterKeys { it.startsWith(PERSON_PREFIX) }
    val whoseError = whose.values.filterIsInstance<Outcome.Failed>().lastOrNull()?.message
    LaunchedEffect(whose) { for ((token, outcome) in whose) if (outcome is Outcome.Done) viewModel.outcomeSeen(token) }
    val whoIsError = (outcomes[WHO_IS_TOKEN] as? Outcome.Failed)?.message
    LaunchedEffect(outcomes[WHO_IS_TOKEN]) { if (outcomes[WHO_IS_TOKEN] is Outcome.Done) viewModel.outcomeSeen(WHO_IS_TOKEN) }

    val own = profile
    val ownLoyalty = remember(own, travelers) { own?.let { allLoyalty(it, travelers) }.orEmpty() }
    val ownLoyaltyGroups = remember(ownLoyalty) { loyaltyByPerson(ownLoyalty) }
    val me = remember(travelers) { guessMe(travelers) }
    val others = remember(shared, own?.ownerUid) { shared.filter { it.ownerUid != own?.ownerUid } }
    val viewingShared = remember(others, sharedUid) { sharedUid?.let { uid -> others.firstOrNull { it.ownerUid == uid } } }

    var editing by rememberSaveable { mutableStateOf<List<String>?>(null) }
    editing?.let { (program, number) ->
        PersonDialog(
            program = program,
            number = number,
            people = remember(ownLoyaltyGroups) { ownLoyaltyGroups.mapNotNull { it.person } },
            onPick = { person ->
                whose.keys.forEach(viewModel::outcomeSeen)
                viewModel.setLoyaltyPerson("$PERSON_PREFIX$program/$number", program, number, person)
            },
            onDismiss = { editing = null },
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
    var merging by rememberSaveable { mutableStateOf<String?>(null) }
    merging?.let { id ->
        travelers.firstOrNull { it.id == id }?.let { person ->
            PeoplePicker(stringResource(Res.string.same_person_as_title, person.name), travelers, except = id, onPick = { viewModel.mergePeople(PEOPLE_TOKEN, id, it) }, onDismiss = { merging = null })
        }
    }

    val title = when {
        viewingShared != null -> stringResource(Res.string.from_sender, viewingShared.ownerEmail ?: stringResource(Res.string.someone_who_trusts_you))
        section == ProfileSection.DOCUMENTS -> stringResource(Res.string.documents)
        section == ProfileSection.LOYALTY -> stringResource(Res.string.loyalty_programs)
        section == ProfileSection.PEOPLE -> stringResource(Res.string.people)
        section == ProfileSection.HOME -> stringResource(Res.string.home)
        else -> stringResource(Res.string.profile_sharing)
    }

    Scaffold(topBar = { AppTopBar(title, navigation = TopBarNavigation.Back(onBack)) }) { padding ->
        val list = rememberLazyListState()
        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(padding).scrollEdgeCue(list, scrollCueColors()),
            state = list,
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
        ) {
            when {
                viewingShared != null -> sharedProfileBody(viewingShared)
                section == ProfileSection.DOCUMENTS -> {
                    val docs = own?.documents.orEmpty()
                    if (!loaded) {
                        item(key = "docs-loading") { Text(stringResource(Res.string.loading), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    } else if (docs.isEmpty()) {
                        item(key = "docs-empty") { Text(stringResource(Res.string.profile_empty), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    } else {
                        for ((i, entry) in docs.withIndex()) {
                            item(key = "doc-$i") { FoldingEntry(entry) }
                        }
                    }
                }
                section == ProfileSection.LOYALTY -> {
                    if (!loaded) {
                        item(key = "loyalty-loading") { Text(stringResource(Res.string.loading), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    } else if (ownLoyalty.isEmpty()) {
                        item(key = "loyalty-empty") { Text(stringResource(Res.string.profile_empty), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                    } else {
                        item(key = "loyalty-body") {
                            LoyaltyList(
                                groups = ownLoyaltyGroups,
                                found = own?.foundLoyalty.orEmpty(),
                                isOwn = true,
                                onWhose = { program, number -> editing = listOf(program, number) },
                                onRemoveFound = { found ->
                                    removals.keys.forEach(viewModel::outcomeSeen)
                                    viewModel.removeFoundLoyalty("$FOUND_PREFIX${found.program}/${found.number}", found)
                                },
                                onWhoIs = if (travelers.isNotEmpty()) ({ name -> naming = name }) else null,
                                error = whoIsError ?: whoseError ?: removalError,
                            )
                        }
                    }
                }
                section == ProfileSection.PEOPLE -> {
                    peopleSectionBody(
                        travelers = travelers,
                        me = me,
                        imported = own?.travelers.orEmpty(),
                        error = (outcomes[PEOPLE_TOKEN] as? Outcome.Failed)?.message,
                        onSetMe = { viewModel.setMe(PEOPLE_TOKEN, it) },
                        onMerge = { merging = it },
                    )
                }
                section == ProfileSection.HOME -> {
                    item(key = "home") { HomeSection(viewModel) }
                }
                section == ProfileSection.SHARING -> {
                    item(key = "sharing") {
                        Sharing(
                            trusted = own?.trustedEmails.orEmpty(),
                            busy = !loaded || outcomes[SHARE_TOKEN] is Outcome.Busy,
                            error = (outcomes[SHARE_TOKEN] as? Outcome.Failed)?.message,
                            onSave = { viewModel.saveTrusted(SHARE_TOKEN, it) },
                        )
                    }
                    if (others.isNotEmpty()) {
                        item(key = "shared-with-you-title") { SectionTitle(stringResource(Res.string.shared_with_you)) }
                        item(key = "shared-with-you-list") {
                            val shape = RoundedCornerShape(12.dp)
                            Column(modifier = Modifier.fillMaxWidth().clip(shape).border(1.dp, MaterialTheme.colorScheme.outlineVariant, shape)) {
                                others.forEachIndexed { index, p ->
                                    if (index > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                                    val pLoyalty = remember(p) { allLoyalty(p, emptyList()) }
                                    val parts = buildList {
                                        if (p.documents.isNotEmpty()) add(pluralStringResource(Res.plurals.profile_documents_count, p.documents.size, p.documents.size))
                                        if (pLoyalty.isNotEmpty()) add(pluralStringResource(Res.plurals.profile_programs_count, pLoyalty.size, pLoyalty.size))
                                    }
                                    val summary = if (parts.isEmpty()) stringResource(Res.string.profile_nothing_yet) else parts.joinToString(" · ")
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .heightIn(min = 56.dp)
                                            .clickable { onOpenShared(p.ownerUid) }
                                            .padding(horizontal = 16.dp, vertical = 12.dp),
                                    ) {
                                        Column(modifier = Modifier.weight(1f)) {
                                            Text(
                                                stringResource(Res.string.from_sender, p.ownerEmail ?: stringResource(Res.string.someone_who_trusts_you)),
                                                style = MaterialTheme.typography.bodyLarge,
                                                fontWeight = FontWeight.Medium,
                                            )
                                            Text(summary, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        }
                                        Text("›", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 12.dp))
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

private fun LazyListScope.sharedProfileBody(profile: TravelProfile) {
    val loyalty = allLoyalty(profile, emptyList())
    val groups = loyaltyByPerson(loyalty)
    if (profile.documents.isEmpty() && loyalty.isEmpty() && profile.travelers.isEmpty()) {
        item(key = "shared-empty") {
            Text(stringResource(Res.string.profile_nothing_yet), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        return
    }
    if (profile.documents.isNotEmpty()) {
        item(key = "shared-docs-title") { SectionTitle(stringResource(Res.string.documents)) }
        for ((i, entry) in profile.documents.withIndex()) {
            item(key = "shared-doc-$i") { FoldingEntry(entry) }
        }
    }
    if (loyalty.isNotEmpty()) {
        item(key = "shared-loyalty-title") { SectionTitle(stringResource(Res.string.loyalty_programs)) }
        item(key = "shared-loyalty-list") {
            LoyaltyList(groups = groups, found = emptyList(), isOwn = false)
        }
    }
    if (profile.travelers.isNotEmpty()) {
        item(key = "shared-travelers-title") { SectionTitle(stringResource(Res.string.travelers)) }
        for ((i, entry) in profile.travelers.withIndex()) {
            item(key = "shared-trav-$i") { FoldingEntry(entry) }
        }
    }
}

private fun LazyListScope.peopleSectionBody(
    travelers: List<Person>,
    me: Person?,
    imported: List<ProfileEntry>,
    error: String?,
    onSetMe: (String) -> Unit,
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
    items(travelers, key = { "person-${it.id}" }) { person ->
        Column(modifier = Modifier.fillMaxWidth()) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                Text(person.name, style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f))
                if (person.id == me?.id) {
                    Text(stringResource(Res.string.you).uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                } else {
                    TextButton(onClick = { onSetMe(person.id) }) { Text(stringResource(Res.string.this_is_me)) }
                }
                if (travelers.size > 1) {
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

/** The token of "This is me" and People merges. */
private const val PEOPLE_TOKEN = "profile/people/me"

/** The token of Loyalty's "Same person as…" write. */
private const val WHO_IS_TOKEN = "profile/loyalty/who-is"
