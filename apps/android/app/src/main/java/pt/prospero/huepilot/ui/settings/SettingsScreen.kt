package pt.prospero.huepilot.ui.settings

import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
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
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import pt.prospero.huepilot.data.settings.ThemeMode
import pt.prospero.huepilot.ui.components.ConfirmDialog
import kotlin.math.roundToInt

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(vm: SettingsViewModel, onBack: () -> Unit) {
    val settings by vm.settings.collectAsStateWithLifecycle()
    val ui by vm.ui.collectAsStateWithLifecycle()
    val status by vm.repoStatus.collectAsStateWithLifecycle()
    val snapshot by vm.snapshot.collectAsStateWithLifecycle()

    var apiKey by rememberSaveable { mutableStateOf(settings.geminiApiKey) }
    var model by rememberSaveable { mutableStateOf(settings.geminiModel) }
    var showKey by rememberSaveable { mutableStateOf(false) }
    var modelMenu by remember { mutableStateOf(false) }
    var confirmForget by remember { mutableStateOf(false) }
    LaunchedEffect(settings.loaded) { if (settings.loaded) { apiKey = settings.geminiApiKey; model = settings.geminiModel } }

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

            Section("Assistant (Google Gemini)") {
                OutlinedTextField(
                    value = apiKey, onValueChange = { apiKey = it }, label = { Text("Gemini API key") }, singleLine = true,
                    visualTransformation = if (showKey) VisualTransformation.None else PasswordVisualTransformation(),
                    trailingIcon = { TextButton(onClick = { showKey = !showKey }) { Text(if (showKey) "Hide" else "Show") } },
                    modifier = Modifier.fillMaxWidth(),
                )
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    OutlinedTextField(value = model, onValueChange = { model = it }, label = { Text("Model") }, singleLine = true, modifier = Modifier.weight(1f))
                    Spacer(Modifier.width(8.dp))
                    Column {
                        OutlinedButton(onClick = { if (ui.models.isEmpty()) vm.fetchModels(apiKey) else modelMenu = true }, enabled = apiKey.isNotBlank() && !ui.fetchingModels) {
                            if (ui.fetchingModels) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp) else Text(if (ui.models.isEmpty()) "Fetch models" else "Choose")
                        }
                        DropdownMenu(expanded = modelMenu, onDismissRequest = { modelMenu = false }) {
                            ui.models.forEach { m ->
                                DropdownMenuItem(text = { Text(m.name) }, onClick = { model = m.name; modelMenu = false })
                            }
                        }
                    }
                }
                if (ui.models.isNotEmpty()) TextButton(onClick = { vm.fetchModels(apiKey) }) { Text("Refresh list (${ui.models.size} models)") }
                ui.modelsError?.let { Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall) }
                Spacer(Modifier.height(8.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Speak replies", modifier = Modifier.weight(1f))
                    Switch(checked = settings.speakReplies, onCheckedChange = vm::setSpeakReplies)
                }
                Spacer(Modifier.height(8.dp))
                Button(onClick = { vm.saveGemini(apiKey, model) }, enabled = apiKey != settings.geminiApiKey || model != settings.geminiModel) { Text("Save assistant settings") }
                Text("Get a key at aistudio.google.com. The key is stored only on this phone.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
                Text("Native Kotlin + Jetpack Compose client for the Philips Hue CLIP v2 API, with a Gemini-powered assistant. Part of the Hue Pilot suite (desktop app, MCP server, Android).", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
