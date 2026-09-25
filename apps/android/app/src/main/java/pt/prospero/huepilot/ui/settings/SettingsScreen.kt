package pt.prospero.huepilot.ui.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
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
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import pt.prospero.huepilot.assistant.AssistantProvider
import pt.prospero.huepilot.assistant.ProviderConfig
import pt.prospero.huepilot.data.settings.ThemeMode
import pt.prospero.huepilot.ui.components.ConfirmDialog
import kotlin.math.roundToInt

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun SettingsScreen(vm: SettingsViewModel, onBack: () -> Unit) {
    val settings by vm.settings.collectAsStateWithLifecycle()
    val ui by vm.ui.collectAsStateWithLifecycle()
    val status by vm.repoStatus.collectAsStateWithLifecycle()
    val snapshot by vm.snapshot.collectAsStateWithLifecycle()
    var confirmForget by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Settings") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back") } },
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Section("Bridge") {
                val b = settings.bridge
                if (b == null) {
                    Text("No bridge paired.")
                } else {
                    Text(b.bridgeName ?: snapshot.bridge?.name ?: "Hue bridge", style = MaterialTheme.typography.titleMedium)
                    Text("${b.baseUrl}  ·  ${if (status.connected) "connected" else status.error ?: "connecting…"}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    listOfNotNull(
                        b.bridgeId?.let { "Bridge id: $it" },
                        snapshot.bridge?.modelId?.let { "Model: $it" },
                        snapshot.bridge?.softwareVersion?.let { "Software: $it" },
                        snapshot.bridge?.timeZone?.let { "Time zone: $it" },
                        "App key: ${b.appKey?.take(6)}…",
                        "${snapshot.lights.size} lights · ${snapshot.rooms.size} rooms · ${snapshot.zones.size} zones · ${snapshot.scenes.size} scenes",
                    ).forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
                    Spacer(Modifier.height(8.dp))
                    OutlinedButton(onClick = { confirmForget = true }) { Text("Forget bridge") }
                }
            }

            Section("Assistant") {
                Text("Provider in use", style = MaterialTheme.typography.labelLarge)
                Spacer(Modifier.height(4.dp))
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    AssistantProvider.entries.forEach { p ->
                        val selected = settings.assistantProvider == p
                        FilterChip(
                            selected = selected,
                            onClick = { vm.setAssistantProvider(p) },
                            label = { Text(p.label) },
                            leadingIcon = if (selected) ({ Icon(Icons.Outlined.Check, contentDescription = null, Modifier.size(16.dp)) }) else null,
                        )
                    }
                }
                val active = settings.activeConfig
                Text(
                    "${settings.assistantProvider.label} · ${active.model}" + if (active.hasKey) "" else " · no API key yet",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 4.dp),
                )
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Speak replies", modifier = Modifier.weight(1f))
                    Switch(checked = settings.speakReplies, onCheckedChange = vm::setSpeakReplies)
                }
                Text("Keys are stored only on this phone. Changing the provider or model starts a new conversation.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }

            AssistantProvider.entries.forEach { p ->
                ProviderCard(
                    provider = p,
                    stored = settings.provider(p),
                    inUse = settings.assistantProvider == p,
                    uiState = ui.provider(p),
                    loaded = settings.loaded,
                    onFetchModels = { key -> vm.fetchModels(p, key) },
                    onSave = { key, model -> vm.saveProvider(p, key, model) },
                    onUse = { vm.setAssistantProvider(p) },
                )
            }

            Section("Appearance") {
                SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                    ThemeMode.entries.forEachIndexed { i, mode ->
                        SegmentedButton(selected = settings.theme == mode, onClick = { vm.setTheme(mode) }, shape = SegmentedButtonDefaults.itemShape(i, ThemeMode.entries.size)) {
                            Text(mode.name.lowercase().replaceFirstChar { it.uppercase() })
                        }
                    }
                }
                Text("Colours follow your wallpaper on Android 12+ (Material You).", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }

            Section("Transitions") {
                var local by remember(settings.transitionMs) { mutableFloatStateOf(settings.transitionMs.toFloat()) }
                Text("Default transition: ${(local / 1000f * 10).roundToInt() / 10f} s")
                Slider(value = local, onValueChange = { local = it }, onValueChangeFinished = { vm.setTransitionMs(local.roundToInt()) }, valueRange = 0f..5000f, steps = 49)
                Text("Applied to every on/off, brightness and colour change sent from the app.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }

            Section("About") {
                Text("Hue Pilot for Android 1.0.0", style = MaterialTheme.typography.titleSmall)
                Text("Native Kotlin + Jetpack Compose client for the Philips Hue CLIP v2 API, with an AI assistant (Gemini, OpenAI, Anthropic, DeepSeek or OpenRouter). Part of the Hue Pilot suite (desktop app, MCP server, Android).", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text("Not affiliated with Signify / Philips Hue.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.height(24.dp))
        }
    }

    if (confirmForget) {
        ConfirmDialog("Forget bridge", "The app key will be removed from this phone. You will need to press the link button to pair again.", confirmLabel = "Forget", onDismiss = { confirmForget = false }) {
            confirmForget = false; vm.forgetBridge()
        }
    }
}

/** One card per provider: masked key, model + fetch/choose, "Get a key" link, save. */
@Composable
private fun ProviderCard(
    provider: AssistantProvider,
    stored: ProviderConfig,
    inUse: Boolean,
    uiState: ProviderUiState,
    loaded: Boolean,
    onFetchModels: (String) -> Unit,
    onSave: (String, String) -> Unit,
    onUse: () -> Unit,
) {
    var apiKey by rememberSaveable(provider) { mutableStateOf(stored.apiKey) }
    var model by rememberSaveable(provider) { mutableStateOf(stored.model) }
    var showKey by rememberSaveable(provider) { mutableStateOf(false) }
    var modelMenu by remember { mutableStateOf(false) }
    val uriHandler = LocalUriHandler.current
    LaunchedEffect(loaded, stored) { if (loaded) { apiKey = stored.apiKey; model = stored.model } }
    val dirty = apiKey != stored.apiKey || model != stored.model

    Card(
        Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = if (inUse) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.surfaceContainer),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(provider.label, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary)
                    Text(
                        if (inUse) "In use" else if (stored.hasKey) "Ready" else "No key",
                        style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (!inUse) TextButton(onClick = onUse) { Text("Use") }
            }
            Spacer(Modifier.height(8.dp))
            OutlinedTextField(
                value = apiKey, onValueChange = { apiKey = it }, label = { Text("API key") },
                placeholder = { Text(provider.keyPlaceholder) }, singleLine = true,
                visualTransformation = if (showKey) VisualTransformation.None else PasswordVisualTransformation(),
                trailingIcon = { TextButton(onClick = { showKey = !showKey }) { Text(if (showKey) "Hide" else "Show") } },
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(value = model, onValueChange = { model = it }, label = { Text("Model") }, placeholder = { Text(provider.defaultModel) }, singleLine = true, modifier = Modifier.weight(1f))
                Spacer(Modifier.width(8.dp))
                Box {
                    OutlinedButton(
                        onClick = { if (uiState.models.isEmpty()) onFetchModels(apiKey) else modelMenu = true },
                        enabled = apiKey.isNotBlank() && !uiState.fetching,
                    ) {
                        if (uiState.fetching) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
                        else Text(if (uiState.models.isEmpty()) "Fetch models" else "Choose")
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
            Row(verticalAlignment = Alignment.CenterVertically) {
                Button(onClick = { onSave(apiKey, model) }, enabled = dirty) { Text("Save") }
                Spacer(Modifier.width(8.dp))
                TextButton(onClick = { uriHandler.openUri(provider.keyUrl) }) {
                    Text("Get a key")
                    Spacer(Modifier.width(4.dp))
                    Icon(Icons.AutoMirrored.Outlined.OpenInNew, contentDescription = null, Modifier.size(14.dp))
                }
            }
        }
    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    Card(Modifier.fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.padding(16.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary)
            Spacer(Modifier.height(8.dp))
            content()
        }
    }
}
