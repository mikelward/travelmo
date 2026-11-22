package app.travelmo.ui

import android.content.ActivityNotFoundException
import android.content.Intent
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import app.travelmo.R
import app.travelmo.log.TravelmoLog
import com.mikelward.androidlog.safe
import com.mikepenz.aboutlibraries.Libs
import com.mikepenz.aboutlibraries.entity.Library
import com.mikepenz.aboutlibraries.ui.compose.android.produceLibraries

/**
 * Opens the Licenses screen. [LicensesHost] provides it around the whole
 * app, so About offers the licenses wherever the app's menu is; null (a
 * test, a preview) offers none.
 */
val LocalOpenLicenses = staticCompositionLocalOf<(() -> Unit)?> { null }

/**
 * The app, or the Licenses screen in its place while [open]: from About on
 * any screen, signed in or not, since the sign-in screen is outside the back
 * stack (MainActivity). As in stopdash, a page over the app whose Back
 * closes it. The app's saved state (the back stack, a tab, a scroll) is kept
 * while the licenses cover it, so Back finds it as it was; [appKey] names
 * whose app it is, and a new one (a sign-in, a sign-out) starts afresh.
 */
@Composable
fun LicensesHost(open: Boolean, onOpenChange: (Boolean) -> Unit, appKey: String, app: @Composable () -> Unit) {
    val saved = rememberSaveableStateHolder()
    var shownKey by remember { mutableStateOf(appKey) }
    LaunchedEffect(appKey) {
        if (shownKey != appKey) saved.removeState(shownKey)
        shownKey = appKey
    }
    // One lambda for the composition's life, so the static local never changes.
    val currentOnOpenChange by rememberUpdatedState(onOpenChange)
    val openLicenses: () -> Unit = remember { { currentOnOpenChange(true) } }
    CompositionLocalProvider(LocalOpenLicenses provides openLicenses) {
        if (open) {
            LicensesScreen(onBack = { onOpenChange(false) })
        } else {
            saved.SaveableStateProvider(appKey, app)
        }
    }
}

/**
 * Open-source attribution, reached from About: every third-party component
 * the app bundles and the license each ships under, as in the sibling apps.
 * The list is the committed `res/raw/aboutlibraries.json`, regenerated with
 * `./gradlew :app:exportBundledLicenses` (app/build.gradle.kts), plus the
 * Fira Sans font, which is no Maven dependency (app/aboutlibraries).
 */
@Composable
fun LicensesScreen(onBack: () -> Unit) {
    BackHandler(onBack = onBack)
    val context = LocalContext.current
    val linkFailed = stringResource(R.string.licenses_link_failed)
    // Parsed off the main thread; the title shows at once and the list fills in.
    val libraries by produceLibraries(R.raw.aboutlibraries)
    LicensesContent(
        libraries = libraries,
        onBack = onBack,
        onOpenLicenseUrl = { url ->
            try {
                context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri()))
            } catch (e: ActivityNotFoundException) {
                // No browser on the device: say so rather than let the tap do nothing.
                TravelmoLog.warning("No app to open a license link: %s", safe(e.javaClass.simpleName))
                Toast.makeText(context, linkFailed, Toast.LENGTH_SHORT).show()
            }
        },
    )
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun LicensesContent(libraries: Libs?, onBack: () -> Unit = {}, onOpenLicenseUrl: (String) -> Unit = {}) {
    // The tapped component's id, saved so an open dialog survives a rotation.
    var selectedId by rememberSaveable { mutableStateOf<String?>(null) }
    // By name, the only thing on a row to scan by; case-insensitive so a
    // lowercase name doesn't sort after the Z's.
    val sorted = remember(libraries) {
        libraries?.libraries.orEmpty().sortedWith(compareBy(String.CASE_INSENSITIVE_ORDER, Library::name))
    }
    val selected = remember(sorted, selectedId) { selectedId?.let { id -> sorted.firstOrNull { it.uniqueId == id } } }
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.licenses)) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.back))
                    }
                },
                actions = { AppMenu() },
            )
        },
    ) { padding ->
        // Names only, one row each; the version, authors and license are a tap away.
        LazyColumn(modifier = Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(bottom = 8.dp)) {
            items(items = sorted, key = { it.uniqueId }) { library ->
                Text(
                    text = library.name,
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { selectedId = library.uniqueId }
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                )
            }
        }
    }
    selected?.let { library ->
        LibraryDialog(library = library, onOpenLicenseUrl = onOpenLicenseUrl, onDismiss = { selectedId = null })
    }
}

/**
 * A component's version, authors and licenses. The export carries no
 * license text, so each license with a URL links to it.
 */
@Composable
private fun LibraryDialog(library: Library, onOpenLicenseUrl: (String) -> Unit, onDismiss: () -> Unit) {
    val authors = remember(library) { library.authors() }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(library.name) },
        text = {
            Column(modifier = Modifier.heightIn(max = 360.dp).verticalScroll(rememberScrollState())) {
                library.artifactVersion?.let {
                    Text(stringResource(R.string.version, it), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (authors.isNotEmpty()) {
                    Text(stringResource(R.string.licenses_by, authors), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                library.licenses.forEach { license ->
                    val url = license.url
                    if (!url.isNullOrEmpty()) {
                        Text(
                            text = license.name,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.fillMaxWidth().clickable { onOpenLicenseUrl(url) }.padding(vertical = 8.dp),
                        )
                    } else {
                        Text(license.name, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = onDismiss) { Text(stringResource(R.string.ok)) } },
    )
}

/**
 * Who wrote a component, as its metadata says: the developers, or else the
 * publishing organization; empty when it names neither, and the dialog then
 * leaves the line out. Apache-2.0 §4 asks that attribution travel with the code.
 */
internal fun Library.authors(): String =
    developers
        .mapNotNull { developer -> developer.name?.takeIf(String::isNotBlank) }
        .ifEmpty { listOfNotNull(organization?.name?.takeIf(String::isNotBlank)) }
        .joinToString(", ")
