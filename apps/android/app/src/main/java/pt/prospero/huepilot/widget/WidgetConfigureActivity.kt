package pt.prospero.huepilot.widget

import android.appwidget.AppWidgetManager
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import pt.prospero.huepilot.appContainer
import pt.prospero.huepilot.data.hue.GroupUi
import pt.prospero.huepilot.data.hue.LightUi
import pt.prospero.huepilot.ui.theme.HuePilotTheme

/**
 * Widget configuration (launcher `android:configure` target, also opened after a widget is pinned from
 * the in-app gallery). Picks the rooms / room / light for the widget identified by `EXTRA_APPWIDGET_ID`.
 */
class WidgetConfigureActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val appWidgetId = intent?.extras?.getInt(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
            ?: AppWidgetManager.INVALID_APPWIDGET_ID
        setResult(RESULT_CANCELED, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId))
        if (appWidgetId == AppWidgetManager.INVALID_APPWIDGET_ID) { finish(); return }

        val providerClass = AppWidgetManager.getInstance(this).getAppWidgetInfo(appWidgetId)?.provider?.className
        val pinnedId = intent?.action?.takeIf { it.startsWith(ACTION_PINNED) }?.removePrefix(ACTION_PINNED)
        val info = WidgetCatalog.byReceiver(providerClass) ?: WidgetCatalog.byId(pinnedId)
        if (info == null) { finish(); return }
        val reconfigure = !WidgetPrefs.get(this, appWidgetId).isEmpty
        val container = appContainer

        setContent {
            val settings by container.settingsState.collectAsStateWithLifecycle()
            HuePilotTheme(mode = settings.theme, useWallpaperColors = settings.wallpaperColors) {
                Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
                    ConfigureScreen(
                        info = info,
                        initial = WidgetPrefs.get(this, appWidgetId),
                        buttonLabel = if (reconfigure || pinnedId != null) "Save" else "Add widget",
                        onCancel = { finish() },
                        onDone = { config -> save(appWidgetId, info, config) },
                    )
                }
            }
        }
    }

    private fun save(appWidgetId: Int, info: WidgetInfo, config: WidgetConfig) {
        WidgetPrefs.save(this, appWidgetId, config)
        lifecycleScope.launch {
            runCatching {
                val glanceId = GlanceAppWidgetManager(this@WidgetConfigureActivity).getGlanceIdBy(appWidgetId)
                info.widget().update(this@WidgetConfigureActivity, glanceId)
            }
            setResult(RESULT_OK, Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, appWidgetId))
            finish()
        }
    }

    companion object {
        /** Intent action prefix used by [WidgetCatalog.requestPin]'s success callback: `ACTION_PINNED + widgetId`. */
        const val ACTION_PINNED = "pt.prospero.huepilot.widget.PINNED."
    }
}

private sealed class Choice(val key: String, val title: String, val subtitle: String?) {
    class Group(val group: GroupUi) : Choice(
        group.id, group.name,
        when (group.lights.size) { 0 -> "No lights"; 1 -> "1 light"; else -> "${group.lights.size} lights" } + " · ${group.kind.name.lowercase()}",
    )
    class Light(val light: LightUi) : Choice(light.id, light.name, light.roomName ?: "No room")
    object Favourites : Choice("", "Favourite rooms", "Scenes of your starred rooms (all rooms when none are starred)")
}

@Composable
private fun ConfigureScreen(info: WidgetInfo, initial: WidgetConfig, buttonLabel: String, onCancel: () -> Unit, onDone: (WidgetConfig) -> Unit) {
    val context = LocalContext.current
    var state by remember { mutableStateOf<WidgetState?>(null) }
    LaunchedEffect(Unit) { state = WidgetData.load(context) }

    val multi = info.id == WidgetCatalog.ID_ROOMS
    val selected = remember { mutableStateOf<List<String>>(initial.groupIds) }
    val single = remember {
        mutableStateOf(
            when (info.id) {
                WidgetCatalog.ID_LIGHT_CONTROL -> initial.lightId
                else -> initial.groupId
            }
        )
    }

    val snap = state?.snapshot
    val choices: List<Choice> = when {
        snap == null -> emptyList()
        info.id == WidgetCatalog.ID_LIGHT_CONTROL -> snap.lights.map { Choice.Light(it) }
        info.id == WidgetCatalog.ID_SCENES -> listOf(Choice.Favourites) + snap.groups.filter { g -> snap.scenes.any { it.groupId == g.id } }.map { Choice.Group(it) }
        else -> snap.groups.map { Choice.Group(it) }
    }
    val prompt = when (info.id) {
        WidgetCatalog.ID_ROOMS -> "Tap rooms in the order you want them. Leave everything unticked to show your favourite rooms (or all rooms)."
        WidgetCatalog.ID_SCENES -> "Whose scenes should the widget show?"
        WidgetCatalog.ID_LIGHT_CONTROL -> "Which light should the widget control?"
        else -> "Which room should the widget control?"
    }
    val canSave = multi || single.value != null || info.id == WidgetCatalog.ID_SCENES

    Column(modifier = Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
        Column(modifier = Modifier.padding(horizontal = 20.dp).padding(top = 20.dp, bottom = 8.dp)) {
            Text(info.title, style = MaterialTheme.typography.headlineSmall)
            Spacer(Modifier.height(4.dp))
            Text(info.description, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(12.dp))
            Text(prompt, style = MaterialTheme.typography.bodyMedium)
        }
        Box(modifier = Modifier.weight(1f).fillMaxWidth()) {
            when {
                state == null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                !state!!.paired -> Message("Open Hue Pilot and pair a bridge first.")
                choices.isEmpty() -> Message(if (state!!.offline) "Can't reach the bridge." else "Nothing to choose from yet.")
                else -> LazyColumn(contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 16.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(choices, key = { it.key }) { c ->
                        val isSelected = if (multi) c.key in selected.value else single.value == (c.key.ifEmpty { null }) || (c is Choice.Favourites && single.value == null)
                        val order = if (multi) selected.value.indexOf(c.key) else -1
                        ChoiceRow(c, isSelected, order, multi) {
                            if (multi) selected.value = if (c.key in selected.value) selected.value - c.key else selected.value + c.key
                            else single.value = c.key.ifEmpty { null }
                        }
                    }
                }
            }
        }
        Row(modifier = Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onCancel) { Text("Cancel") }
            Spacer(Modifier.width(8.dp))
            Button(
                enabled = state != null && canSave,
                onClick = {
                    onDone(
                        when (info.id) {
                            WidgetCatalog.ID_ROOMS -> WidgetConfig(groupIds = selected.value)
                            WidgetCatalog.ID_LIGHT_CONTROL -> WidgetConfig(lightId = single.value)
                            else -> WidgetConfig(groupId = single.value)
                        }
                    )
                },
            ) { Text(buttonLabel) }
        }
    }
}

@Composable
private fun Message(text: String) {
    Box(Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
        Text(text, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun ChoiceRow(choice: Choice, selected: Boolean, order: Int, multi: Boolean, onClick: () -> Unit) {
    val bg = if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainer
    Row(
        modifier = Modifier.fillMaxWidth().clip(MaterialTheme.shapes.medium).background(bg).clickable(onClick = onClick).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (multi) Checkbox(checked = selected, onCheckedChange = { onClick() })
        else RadioButton(selected = selected, onClick = onClick)
        Spacer(Modifier.width(8.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(choice.title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
            choice.subtitle?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
        if (choice is Choice.Light && choice.light.on) {
            Box(Modifier.size(12.dp).clip(CircleShape).background(Color(WidgetLogic.parseHex(choice.light.swatchHex) ?: WidgetLogic.WARM_WHITE)))
        }
        if (multi && order >= 0) {
            Spacer(Modifier.width(8.dp))
            Box(Modifier.size(26.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primary), contentAlignment = Alignment.Center) {
                Text("${order + 1}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onPrimary)
            }
        }
    }
}
