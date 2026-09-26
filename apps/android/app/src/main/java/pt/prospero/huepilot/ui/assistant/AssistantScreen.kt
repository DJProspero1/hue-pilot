package pt.prospero.huepilot.ui.assistant

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.DeleteSweep
import androidx.compose.material.icons.rounded.ErrorOutline
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.Mic
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.VolumeOff
import androidx.compose.material.icons.rounded.VolumeUp
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import pt.prospero.huepilot.assistant.AssistantProvider
import pt.prospero.huepilot.ui.components.CircleIconButton
import pt.prospero.huepilot.ui.components.GlowIcon
import pt.prospero.huepilot.ui.theme.hueTokens
import java.util.Locale

@Composable
fun AssistantScreen(vm: AssistantViewModel, onOpenSettings: () -> Unit, autoListen: Boolean = false, onAutoListenHandled: () -> Unit = {}) {
    val state by vm.state.collectAsStateWithLifecycle()
    val settings by vm.settings.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val listState = rememberLazyListState()
    val provider = settings.assistantProvider
    val config = settings.activeConfig
    var providerMenu by remember { mutableStateOf(false) }

    LaunchedEffect(state.items.size, state.busy) {
        if (state.items.isNotEmpty()) listState.animateScrollToItem(state.items.size)
    }

    // --- Speech recognition -------------------------------------------------
    val recognizer = remember { if (SpeechRecognizer.isRecognitionAvailable(context)) SpeechRecognizer.createSpeechRecognizer(context) else null }
    DisposableEffect(recognizer) {
        recognizer?.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) { vm.setListening(true) }
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() { vm.setListening(false) }
            override fun onError(error: Int) { vm.setListening(false) }
            override fun onResults(results: Bundle?) {
                vm.setListening(false)
                val text = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
                if (!text.isNullOrBlank()) vm.send(text)
            }
            override fun onPartialResults(partialResults: Bundle?) {
                partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()?.let { vm.setInput(it) }
            }
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        onDispose { recognizer?.destroy() }
    }
    fun startListening() {
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault().toLanguageTag())
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_PROMPT, "Tell Hue Pilot what to do")
        }
        recognizer?.startListening(intent)
    }
    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) startListening()
    }
    fun onMic() {
        if (recognizer == null) return
        if (state.listening) { recognizer.stopListening(); vm.setListening(false); return }
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        if (granted) startListening() else permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
    }
    // Opened from a widget / huepilot://assistant?listen=1: start listening right away.
    LaunchedEffect(autoListen) {
        if (autoListen) { onAutoListenHandled(); if (!state.listening) onMic() }
    }

    Column(Modifier.fillMaxSize().imePadding()) {
        // Header --------------------------------------------------------------
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Assistant", style = MaterialTheme.typography.headlineLarge)
                Box {
                    Row(
                        Modifier.clip(CircleShape).clickable { providerMenu = true }.padding(end = 6.dp, top = 2.dp, bottom = 2.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text("${provider.label} · ${config.model}", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                        Icon(Icons.Rounded.ExpandMore, contentDescription = "Switch provider", tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(18.dp))
                    }
                    DropdownMenu(expanded = providerMenu, onDismissRequest = { providerMenu = false }) {
                        AssistantProvider.entries.forEach { p ->
                            val cfg = settings.provider(p)
                            DropdownMenuItem(
                                text = {
                                    Column {
                                        Text(p.label, fontWeight = if (p == provider) FontWeight.Bold else FontWeight.Normal)
                                        Text(if (cfg.hasKey) cfg.model else "${cfg.model} · no key", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    }
                                },
                                leadingIcon = { if (p == provider) Icon(Icons.Rounded.Check, contentDescription = null) },
                                onClick = { providerMenu = false; if (p != provider) vm.switchProvider(p) },
                            )
                        }
                    }
                }
            }
            CircleIconButton(if (settings.speakReplies) Icons.Rounded.VolumeUp else Icons.Rounded.VolumeOff, "Speak replies", onClick = { vm.setSpeakReplies(!settings.speakReplies) }, tint = if (settings.speakReplies) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
            Spacer(Modifier.width(8.dp))
            CircleIconButton(Icons.Rounded.DeleteSweep, "Clear chat", onClick = vm::clear, tint = if (state.items.isEmpty()) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface)
            Spacer(Modifier.width(8.dp))
            CircleIconButton(Icons.Rounded.Settings, "Settings", onClick = onOpenSettings)
        }

        if (!config.hasKey) SetupBanner(provider, onOpenSettings)

        // Conversation ---------------------------------------------------------
        LazyColumn(
            state = listState,
            modifier = Modifier.weight(1f).fillMaxWidth(),
            contentPadding = PaddingValues(horizontal = 20.dp, vertical = 8.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (state.items.isEmpty()) {
                item { EmptyConversation(provider.label, vm.suggestions, enabled = !state.busy, onPick = { vm.send(it) }) }
            }
            items(state.items, key = { it.id }) { item ->
                when (item) {
                    is ChatItem.User -> Bubble(item.text, user = true)
                    is ChatItem.Assistant -> Bubble(item.text, user = false)
                    is ChatItem.Error -> ErrorCard(item.text)
                    is ChatItem.Tool -> ToolCard(item)
                }
            }
            if (state.busy) {
                item {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 4.dp)) {
                        CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.width(8.dp))
                        Text("Thinking…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
        }

        // Suggestions (compact) + input --------------------------------------
        if (state.items.isNotEmpty()) {
            LazyRow(contentPadding = PaddingValues(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(vm.suggestions) { s -> SuggestionPill(s, enabled = !state.busy) { vm.send(s) } }
            }
        }
        InputBar(
            value = state.input,
            onValueChange = vm::setInput,
            listening = state.listening,
            micAvailable = recognizer != null,
            canSend = state.input.isNotBlank() && !state.busy,
            onMic = { onMic() },
            onSend = { vm.send() },
        )
    }
}

@Composable
private fun EmptyConversation(providerLabel: String, suggestions: List<String>, enabled: Boolean, onPick: (String) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(top = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        GlowIcon(Icons.Rounded.AutoAwesome, color = MaterialTheme.colorScheme.primary, on = true, size = 84.dp, iconSize = 40.dp)
        Spacer(Modifier.height(20.dp))
        Text("What should the lights do?", style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
        Spacer(Modifier.height(6.dp))
        Text(
            "Powered by $providerLabel. I can switch rooms and lights, set colours and scenes, start effects, read sensors and cameras, and create schedules.",
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 12.dp),
        )
        Spacer(Modifier.height(24.dp))
        Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            suggestions.chunked(2).forEach { pair ->
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    pair.forEach { s ->
                        Box(
                            Modifier
                                .weight(1f)
                                .heightIn(min = 64.dp)
                                .clip(RoundedCornerShape(hueTokens.tileRadius))
                                .background(MaterialTheme.colorScheme.surfaceContainer)
                                .clickable(enabled = enabled) { onPick(s) }
                                .padding(14.dp),
                            contentAlignment = Alignment.CenterStart,
                        ) {
                            Text("“$s”", style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                    if (pair.size == 1) Spacer(Modifier.weight(1f))
                }
            }
        }
    }
}

@Composable
private fun SuggestionPill(text: String, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .clip(CircleShape)
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
    ) { Text(text, style = MaterialTheme.typography.labelLarge, maxLines = 1) }
}

@Composable
private fun InputBar(value: String, onValueChange: (String) -> Unit, listening: Boolean, micAvailable: Boolean, canSend: Boolean, onMic: () -> Unit, onSend: () -> Unit) {
    val pulse = rememberInfiniteTransition(label = "mic")
    val scale by pulse.animateFloat(1f, 1.12f, infiniteRepeatable(tween(700), RepeatMode.Reverse), label = "micScale")
    val micBg by animateColorAsState(if (listening) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceContainerHigh, label = "micBg")
    val sendBg by animateColorAsState(if (canSend) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceContainerHigh, label = "sendBg")
    Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 10.dp, bottom = 14.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier
                .weight(1f)
                .heightIn(min = 50.dp)
                .clip(RoundedCornerShape(25.dp))
                .background(MaterialTheme.colorScheme.surfaceContainer)
                .padding(horizontal = 18.dp, vertical = 14.dp),
            contentAlignment = Alignment.CenterStart,
        ) {
            if (value.isEmpty()) Text(if (listening) "Listening…" else "Message Hue Pilot", style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            BasicTextField(
                value = value,
                onValueChange = onValueChange,
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                maxLines = 4,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(onSend = { if (canSend) onSend() }),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        Spacer(Modifier.width(8.dp))
        Box(
            Modifier
                .size(50.dp)
                .scale(if (listening) scale else 1f)
                .clip(CircleShape)
                .background(micBg)
                .clickable(enabled = micAvailable, onClick = onMic),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.Rounded.Mic, contentDescription = "Voice input", tint = if (listening) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface.copy(alpha = if (micAvailable) 1f else 0.4f))
        }
        Spacer(Modifier.width(8.dp))
        Box(
            Modifier
                .size(50.dp)
                .clip(CircleShape)
                .background(sendBg)
                .clickable(enabled = canSend, onClick = onSend),
            contentAlignment = Alignment.Center,
        ) {
            Icon(Icons.AutoMirrored.Rounded.Send, contentDescription = "Send", tint = if (canSend) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun SetupBanner(provider: AssistantProvider, onOpenSettings: () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 20.dp, vertical = 4.dp)
            .clip(RoundedCornerShape(hueTokens.cardRadius))
            .background(MaterialTheme.colorScheme.primaryContainer)
            .padding(16.dp),
    ) {
        Text("Add your ${provider.label} key", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onPrimaryContainer)
        Text(
            "The assistant is set to ${provider.label} but no API key is stored yet. Add one in Settings, or switch provider above.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onPrimaryContainer,
        )
        TextButton(onClick = onOpenSettings, modifier = Modifier.align(Alignment.End)) { Text("Open Settings", color = MaterialTheme.colorScheme.onPrimaryContainer) }
    }
}

@Composable
private fun Bubble(text: String, user: Boolean) {
    Box(Modifier.fillMaxWidth(), contentAlignment = if (user) Alignment.CenterEnd else Alignment.CenterStart) {
        Text(
            text,
            modifier = Modifier
                .widthIn(max = 320.dp)
                .background(
                    if (user) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainer,
                    RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp, bottomStart = if (user) 20.dp else 6.dp, bottomEnd = if (user) 6.dp else 20.dp),
                )
                .padding(horizontal = 16.dp, vertical = 12.dp),
            color = if (user) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface,
            style = MaterialTheme.typography.bodyLarge,
        )
    }
}

@Composable
private fun ToolCard(item: ChatItem.Tool) {
    Row(
        Modifier
            .padding(start = 4.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(if (item.ok) MaterialTheme.colorScheme.surfaceContainerLow else MaterialTheme.colorScheme.errorContainer)
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(24.dp).background(if (item.ok) MaterialTheme.colorScheme.primary.copy(alpha = 0.2f) else MaterialTheme.colorScheme.error.copy(alpha = 0.2f), CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Icon(if (item.ok) Icons.Rounded.Check else Icons.Rounded.ErrorOutline, contentDescription = null, modifier = Modifier.size(14.dp), tint = if (item.ok) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error)
        }
        Spacer(Modifier.width(8.dp))
        Column {
            Text(item.label, style = MaterialTheme.typography.labelLarge)
            Text(item.name.replace('_', ' '), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun ErrorCard(text: String) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(MaterialTheme.colorScheme.errorContainer).padding(12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Rounded.ErrorOutline, contentDescription = null, tint = MaterialTheme.colorScheme.onErrorContainer)
        Spacer(Modifier.width(8.dp))
        Text(text, color = MaterialTheme.colorScheme.onErrorContainer, style = MaterialTheme.typography.bodySmall)
    }
}

@Suppress("unused")
private val transparent = Color.Transparent
