package pt.prospero.huepilot.ui.widgets

import android.widget.Toast
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Widgets
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.dp
import pt.prospero.huepilot.ui.components.ScreenHeader
import pt.prospero.huepilot.ui.components.StatusPill
import pt.prospero.huepilot.ui.theme.hueTokens
import pt.prospero.huepilot.widget.WidgetCatalog
import pt.prospero.huepilot.widget.WidgetInfo

/** Gallery of every home-screen widget with a real preview and an "Add to home screen" button. */
@Composable
fun WidgetsScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val pinSupported = remember { WidgetCatalog.isPinSupported(context) }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 40.dp)) {
        item {
            ScreenHeader("Widgets", subtitle = "${WidgetCatalog.all.size} widgets for your home screen", onBack = onBack)
        }
        item {
            Row(
                Modifier
                    .padding(horizontal = 20.dp, vertical = 4.dp)
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(hueTokens.tileRadius))
                    .background(MaterialTheme.colorScheme.surfaceContainerLow)
                    .padding(14.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Rounded.Widgets, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.width(12.dp))
                Text(
                    if (pinSupported) "Tap Add on any widget and your launcher will place it. You can also long-press the home screen → Widgets → Hue Pilot. Widgets keep working when the app is closed."
                    else "Your launcher does not allow adding widgets from inside apps: long-press the home screen → Widgets → Hue Pilot.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        items(WidgetCatalog.all, key = { it.id }) { info ->
            WidgetCard(info, pinSupported) {
                val ok = WidgetCatalog.requestPin(context, info)
                if (!ok) Toast.makeText(context, "Could not ask the launcher to add the widget. Use the launcher's widget picker instead.", Toast.LENGTH_LONG).show()
            }
        }
    }
}

@Composable
private fun WidgetCard(info: WidgetInfo, pinSupported: Boolean, onAdd: () -> Unit) {
    Column(
        Modifier
            .padding(horizontal = 20.dp, vertical = 8.dp)
            .fillMaxWidth()
            .clip(RoundedCornerShape(hueTokens.cardRadius))
            .background(MaterialTheme.colorScheme.surfaceContainer),
    ) {
        // Preview on a wallpaper-like gradient so the widget reads the way it will on a launcher.
        Box(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 120.dp)
                .background(Brush.linearGradient(listOf(Color(0xFF2B2F4A), Color(0xFF4A3F6B), Color(0xFF6B4A5A))))
                .padding(18.dp),
            contentAlignment = Alignment.Center,
        ) {
            Image(
                painter = painterResource(info.previewRes),
                contentDescription = "${info.title} preview",
                contentScale = ContentScale.Fit,
                modifier = Modifier.fillMaxWidth().heightIn(max = 200.dp).clip(RoundedCornerShape(16.dp)),
            )
        }
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(info.title, style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                StatusPill(info.sizeHint)
            }
            Spacer(Modifier.height(4.dp))
            Text(info.description, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (info.needsConfig) {
                Spacer(Modifier.height(4.dp))
                Text("You choose the room or light right after adding it.", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
            }
            Spacer(Modifier.height(12.dp))
            Button(onClick = onAdd, enabled = pinSupported, shape = CircleShape) {
                Icon(Icons.Rounded.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(6.dp))
                Text("Add to home screen")
            }
        }
    }
}
