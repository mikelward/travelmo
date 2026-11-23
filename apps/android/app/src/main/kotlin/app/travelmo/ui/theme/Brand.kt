package app.travelmo.ui.theme

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import app.travelmo.R
import app.travelmo.shared.Res
import app.travelmo.shared.app_name
import org.jetbrains.compose.resources.stringResource

/**
 * The logo and the "Travelmo" wordmark side by side, as in the web app's
 * header. The logo is decorative: the wordmark already says the name.
 */
@Composable
fun Brand(modifier: Modifier = Modifier, logoSize: Dp = 28.dp, style: TextStyle = LocalTextStyle.current) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(logoSize / 3), verticalAlignment = Alignment.CenterVertically) {
        Image(painterResource(R.drawable.logo), contentDescription = null, modifier = Modifier.size(logoSize))
        Text(stringResource(Res.string.app_name), style = style, fontFamily = Wordmark)
    }
}

/**
 * A text button's own start padding (ButtonDefaults.TextButtonContentPadding),
 * to shift one left so its label lines up with the text above it.
 */
val TextButtonInset: Dp = 12.dp
