package pt.prospero.huepilot.ui.settings

import android.os.Build
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.ExpandLess
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.Router
import androidx.compose.material.icons.rounded.Widgets
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import pt.prospero.huepilot.BuildConfig
import pt.prospero.huepilot.assistant.AssistantProvider
import pt.prospero.huepilot.assistant.ProviderConfig
import pt.prospero.huepilot.data.settings.ThemeMode
import pt.prospero.huepilot.ui.components.ConfirmDialog
import pt.prospero.huepilot.ui.components.GlowIcon
import pt.prospero.huepilot.ui.components.HueSwitch
import pt.prospero.huepilot.ui.components.PillTabs
import pt.prospero.huepilot.ui.components.ScreenHeader
import pt.prospero.huepilot.ui.components.SectionTitle
import pt.prospero.huepilot.ui.components.StatusPill
import pt.prospero.huepilot.ui.theme.HuePalette
import pt.prospero.huepilot.ui.theme.hueTokens
import kotlin.math.roundToInt

@Composable
fun SettingsScreen(vm: SettingsViewModel, onBack: () -> Unit, onOpenWidgets: (() -> Unit)? = null) {
    val settings by vm.settings.collectAsStateWithLifecycle()
    val ui by vm.ui.collectAsStateWithLifecycle()
    val status by vm.repoStatus.collectAsStateWithLifecycle()
    val snapshot by vm.snapshot.collectAsStateWithLifecycle()
    var confirmForget by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 40.dp)) {
        ScreenHeader("Settings", onBack = onBack)

        // Bridge -----------------------------------------------------------------
        SectionTitle("Bridge")
        SettingsCard {
            val b = settings.bridge
            if (b == null) {
                Text("No bridge paired.", modifier = Modifier.padding(16.dp))
            } else {
                Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    GlowIcon(Icons.Rounded.Router, color = HuePalette.Success, on = status.connected, size = 46.dp, iconSize = 23.dp)
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(b.bridgeName ?: snapshot.bridge?.name ?: "Hue bridge", style = MaterialTheme.typography.titleMedium)
                        Text(b.baseUrl, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    StatusPill(
                        if (status.connected) "Connected" else status.error ?: "Connecting…",
                        color = if (status.connected) HuePalette.Success else MaterialTheme.colorScheme.onSurfaceVariant,
                        container = if (status.connected) HuePalette.Success.copy(alpha = 0.15f) else MaterialTheme.colorScheme.surfaceContainerHigh,
                    )
                }
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                Column(Modifier.padding(16.dp)) {
                    listOfNotNull(
                        "Bridge id" to b.bridgeId,
                        "Model" to snapshot.bridge?.modelId,
                        "Software" to snapshot.bridge?.softwareVersion,
                        "Time zone" to snapshot.bridge?.timeZone,
                        "App key" to b.appKey?.let { "${it.take(6)}…" },
                        "Devices" to "${snapshot.lights.size} lights · ${snapshot.rooms.size} rooms · ${snapshot.zones.size} zones · ${snapshot.scenes.size} scenes · ${snapshot.cameras.size} cameras",
                    ).forEach { (k, v) -> if (v != null) InfoLine(k, v) }
                    Spacer(Modifier.height(8.dp))
                    OutlinedButton(onClick = { confirmForget = true }) { Text("Forget bridge", color = MaterialTheme.colorScheme.error) }
                }
            }
        }

        // Assistant ----------------------------------------------------------------
        SectionTitle("Assistant", modifier = Modifier.padding(top = 12.dp))
        SettingsCard {
            Text("Provider in use", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(start = 16.dp, top = 14.dp, end = 16.dp))
            AssistantProvider.entries.forEach { p ->
                ProviderRow(
                    provider = p,
                    stored = settings.provider(p),
                    inUse = settings.assistantProvider == p,
                    uiState = ui.provider(p),
                    loaded = settings.loaded,
                    onUse = { vm.setAssistantProvider(p) },
                    onFetchModels = { key -> vm.fetchModels(p, key) },
                    onSave = { key, model -> vm.saveProvider(p, key, model) },
                )
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
            SwitchRow("Speak replies", "Read the assistant's answers aloud", settings.speakReplies, vm::setSpeakReplies)
            Text(
                "Keys are stored only on this phone. Changing the provider or model starts a new conversation.",
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 14.dp),
            )
        }

        // Appearance -----------------------------------------------------------
        SectionTitle("Appearance", modifier = Modifier.padding(top = 12.dp))
        SettingsCard {
            Column(Modifier.padding(16.dp)) {
                PillTabs(listOf("System", "Light", "Dark"), ThemeMode.entries.indexOf(settings.theme), onSelect = { vm.setTheme(ThemeMode.entries[it]) })
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                SwitchRow("Wallpaper colours", "Material You palette instead of the Hue Pilot amber look", settings.wallpaperColors, vm::setWallpaperColors)
            }
        }

        // Widgets --------------------------------------------------------------
        if (onOpenWidgets != null) {
            SectionTitle("Home screen", modifier = Modifier.padding(top = 12.dp))
            SettingsCard {
                Row(
                    Modifier.fillMaxWidth().clickable(onClick = onOpenWidgets).padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Rounded.Widgets, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text("Widgets", style = MaterialTheme.typography.titleSmall)
                        Text("Rooms, scenes, lights, sensors and the assistant on your home screen", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Icon(Icons.Rounded.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }

        // Transitions ----------------------------------------------------------
        SectionTitle("Transitions", modifier = Modifier.padding(top = 12.dp))
        SettingsCard {
            Column(Modifier.padding(16.dp)) {
                var local by remember(settings.transitionMs) { mutableFloatStateOf(settings.transitionMs.toFloat()) }
                Row {
                    Text("Fade time", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                    Text("${(local / 1000f * 10).roundToInt() / 10f} s", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary)
                }
                Slider(
                    value = local, onValueChange = { local = it }, onValueChangeFinished = { vm.setTransitionMs(local.roundToInt()) },
                    valueRange = 0f..5000f, steps = 49,
                    colors = SliderDefaults.colors(inactiveTrackColor = MaterialTheme.colorScheme.surfaceContainerHighest),
                )
                Text("Applied to every on/off, brightness and colour change sent from the app.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }

        // About ----------------------------------------------------------------
        SectionTitle("About", modifier = Modifier.padding(top = 12.dp))
        SettingsCard {
            Column(Modifier.padding(16.dp)) {
                Text("Hue Pilot for Android ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.titleSmall)
                Text(
                    "Native Kotlin + Jetpack Compose client for the Philips Hue CLIP v2 API with an AI assistant (Gemini, OpenAI, Anthropic, DeepSeek or OpenRouter). Part of the Hue Pilot suite (desktop app, MCP server, Android).",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text("Not affiliated with Signify / Philips Hue.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }

    if (confirmForget) {
        ConfirmDialog("Forget bridge", "The app key will be removed from this phone. You will need to press the link button to pair again.", confirmLabel = "Forget", onDismiss = { confirmForget = false }) {
            confirmForget = false; vm.forgetBridge()
        }
    }
}

@Composable
private fun SettingsCard(content: @Composable () -> Unit) {
    Column(
        Modifier
            .padding(horizontal = 20.dp)
            .fillMaxWidth()
            .clip(RoundedCornerShape(hueTokens.cardRadius))
            .background(MaterialTheme.colorScheme.surfaceContainer),
    ) { content() }
}

@Composable
private fun InfoLine(label: String, value: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.width(90.dp))
        Text(value, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
    }
}

@Composable
private fun SwitchRow(title: String, subtitle: String?, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall)
            if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        HueSwitch(checked = checked, onCheckedChange = onChange)
    }
}

/** One provider: a selectable row that expands into the key / model editor. */
@Composable
private fun ProviderRow(
    provider: AssistantProvider,
    stored: ProviderConfig,
    inUse: Boolean,
    uiState: ProviderUiState,
    loaded: Boolean,
    onUse: () -> Unit,
    onFetchModels: (String) -> Unit,
    onSave: (String, String) -> Unit,
) {
    var expanded by rememberSaveable(provider) { mutableStateOf(false) }
    var apiKey by rememberSaveable(provider) { mutableStateOf(stored.apiKey) }
    var model by rememberSaveable(provider) { mutableStateOf(stored.model) }
    var showKey by rememberSaveable(provider) { mutableStateOf(false) }
    var modelMenu by remember { mutableStateOf(false) }
    val uriHandler = LocalUriHandler.current
    LaunchedEffect(loaded, stored) { if (loaded) { apiKey = stored.apiKey; model = stored.model } }
    val dirty = apiKey != stored.apiKey || model != stored.model
    val radio by animateColorAsState(if (inUse) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceContainerHighest, label = "radio")

    Column {
        Row(
            Modifier.fillMaxWidth().clickable { onUse() }.padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(22.dp).background(radio, CircleShape), contentAlignment = Alignment.Center) {
                if (inUse) Icon(Icons.Rounded.Check, contentDescription = "In use", tint = MaterialTheme.colorScheme.onPrimary, modifier = Modifier.size(14.dp))
            }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(provider.label, style = MaterialTheme.typography.titleSmall)
                Text(
                    if (stored.hasKey) stored.model else "${stored.model} · no key yet",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
            }
            TextButton(onClick = { expanded = !expanded }) {
                Text(if (expanded) "Close" else if (stored.hasKey) "Edit" else "Add key")
                Icon(if (expanded) Icons.Rounded.ExpandLess else Icons.Rounded.ExpandMore, contentDescription = null, modifier = Modifier.size(18.dp))
            }
        }
        AnimatedVisibility(visible = expanded) {
            Column(Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp)) {
                OutlinedTextField(
                    value = apiKey, onValueChange = { apiKey = it }, label = { Text("API key") },
                    placeholder = { Text(provider.keyPlaceholder) }, singleLine = true, shape = RoundedCornerShape(14.dp),
                    visualTransformation = if (showKey) VisualTransformation.None else PasswordVisualTransformation(),
                    trailingIcon = { TextButton(onClick = { showKey = !showKey }) { Text(if (showKey) "Hide" else "Show") } },
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(value = model, onValueChange = { model = it }, label = { Text("Model") }, placeholder = { Text(provider.defaultModel) }, singleLine = true, shape = RoundedCornerShape(14.dp), modifier = Modifier.weight(1f))
                    Spacer(Modifier.width(8.dp))
                    Box {
                        OutlinedButton(
                            onClick = { if (uiState.models.isEmpty()) onFetchModels(apiKey) else modelMenu = true },
                            enabled = apiKey.isNotBlank() && !uiState.fetching,
                        ) {
                            if (uiState.fetching) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                            else Text(if (uiState.models.isEmpty()) "Fetch" else "Choose")
                        }
                        DropdownMenu(expanded = modelMenu, onDismissRequest = { modelMenu = false }) {
                            uiState.models.forEach { m ->
                                DropdownMenuItem(
                                    text = {
                                        Column {
                                            Text(m.name, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                            if (m.displayName != m.name) Text(m.displayName, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                        }
                                    },
                                    onClick = { model = m.name; modelMenu = false },
                                )
                            }
                        }
                    }
                }
                if (uiState.models.isNotEmpty()) TextButton(onClick = { onFetchModels(apiKey) }) { Text("Refresh list (${uiState.models.size} models)") }
                uiState.error?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                Text(provider.modelHint, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { onSave(apiKey, model) }, enabled = dirty) { Text("Save") }
                    TextButton(onClick = { uriHandler.openUri(provider.keyUrl) }) {
                        Text("Get a key")
                        Spacer(Modifier.width(4.dp))
                        Icon(Icons.AutoMirrored.Rounded.OpenInNew, contentDescription = null, Modifier.size(14.dp))
                    }
                }
            }
        }
    }
}
