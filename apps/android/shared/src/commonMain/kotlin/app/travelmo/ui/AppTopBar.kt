package app.travelmo.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.travelmo.shared.Res
import app.travelmo.shared.back
import app.travelmo.shared.cancel
import app.travelmo.shared.logo
import app.travelmo.ui.theme.Wordmark
import org.jetbrains.compose.resources.painterResource
import org.jetbrains.compose.resources.stringResource

/** What a top bar's leading button does, if it has one. */
sealed interface TopBarNavigation {
    /** A back arrow, on a page opened over the tabs. */
    data class Back(val onClick: () -> Unit) : TopBarNavigation

    /** An X that drops a form's changes, labeled Cancel. */
    data class Close(val onClick: () -> Unit) : TopBarNavigation
}

/**
 * Every page's top bar, so they all look alike: the back arrow or X
 * ([navigation]), the logo, [title] in Fira Sans Medium as the web's header
 * has it, then the page's own [actions], the Settings gear on a tab
 * ([onOpenSettings]) and the ⋮ menu, led by the page's own [menuItems]. The
 * logo is decorative.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppTopBar(
    title: String,
    navigation: TopBarNavigation? = null,
    onOpenSettings: (() -> Unit)? = null,
    menuItems: @Composable (close: () -> Unit) -> Unit = {},
    actions: @Composable RowScope.() -> Unit = {},
) {
    TopAppBar(
        title = {
            Row(horizontalArrangement = Arrangement.spacedBy(LogoSize / 3), verticalAlignment = Alignment.CenterVertically) {
                Image(painterResource(Res.drawable.logo), contentDescription = null, modifier = Modifier.size(LogoSize))
                Text(title, fontFamily = Wordmark, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        },
        navigationIcon = {
            when (navigation) {
                is TopBarNavigation.Back -> IconButton(onClick = navigation.onClick) {
                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(Res.string.back))
                }
                is TopBarNavigation.Close -> IconButton(onClick = navigation.onClick) {
                    Icon(Icons.Filled.Close, contentDescription = stringResource(Res.string.cancel))
                }
                null -> {}
            }
        },
        actions = {
            actions()
            onOpenSettings?.let { SettingsButton(onClick = it) }
            AppMenu(items = menuItems)
        },
    )
}

private val LogoSize = 28.dp
