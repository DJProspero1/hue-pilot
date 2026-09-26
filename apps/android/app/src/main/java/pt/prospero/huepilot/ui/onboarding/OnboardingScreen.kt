package pt.prospero.huepilot.ui.onboarding

import androidx.compose.animation.core.LinearEasing
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Lightbulb
import androidx.compose.material.icons.rounded.Router
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import pt.prospero.huepilot.data.hue.DiscoveredBridge
import pt.prospero.huepilot.ui.components.PillTabs
import pt.prospero.huepilot.ui.theme.HuePalette
import pt.prospero.huepilot.ui.theme.hueTokens

@Composable
fun OnboardingScreen(vm: OnboardingViewModel) {
    val state by vm.state.collectAsStateWithLifecycle()
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background, contentColor = MaterialTheme.colorScheme.onBackground) {
        Box(Modifier.fillMaxSize().safeDrawingPadding()) {
            when (val p = state.pairing) {
                is PairingState.InProgress -> PairingView(p, onCancel = vm::cancelPairing)
                is PairingState.Failed -> FailedView(p.message, onRetry = vm::cancelPairing)
                PairingState.Success -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
                PairingState.Idle -> DiscoveryView(state, vm)
            }
        }
    }
}

@Composable
private fun Orb(size: androidx.compose.ui.unit.Dp, content: @Composable () -> Unit) {
    Box(
        Modifier
            .size(size)
            .drawBehind { drawCircle(Brush.radialGradient(listOf(HuePalette.Amber.copy(alpha = 0.45f), Color.Transparent)), radius = this.size.minDimension * 0.95f) }
            .background(Brush.linearGradient(listOf(Color(0xFFFFC46B), HuePalette.AmberDeep, Color(0xFFC7376A))), CircleShape),
        contentAlignment = Alignment.Center,
    ) { content() }
}

@Composable
private fun DiscoveryView(state: OnboardingState, vm: OnboardingViewModel) {
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(24.dp))
        Orb(104.dp) { Icon(Icons.Rounded.Lightbulb, contentDescription = null, tint = Color.White, modifier = Modifier.size(54.dp)) }
        Spacer(Modifier.height(24.dp))
        Text("Welcome to Hue Pilot", style = MaterialTheme.typography.headlineLarge, textAlign = TextAlign.Center)
        Spacer(Modifier.height(8.dp))
        Text(
            "Let's connect to your Hue bridge. Make sure this phone is on the same Wi-Fi network.",
            style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(32.dp))

        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceBetween) {
            Text("Bridges found", style = MaterialTheme.typography.titleMedium)
            if (state.discovering) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
            else TextButton(onClick = vm::discover) { Text("Search again") }
        }
        Spacer(Modifier.height(8.dp))
        if (state.bridges.isEmpty() && !state.discovering) {
            Text(
                "No bridge discovered yet. You can enter its IP address below.",
                style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.fillMaxWidth(),
            )
        }
        state.bridges.forEach { b -> BridgeCard(b, onConnect = { vm.startPairing(b) }) }

        Spacer(Modifier.height(32.dp))
        Text("Manual connection", style = MaterialTheme.typography.titleMedium, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(10.dp))
        OutlinedTextField(
            value = state.manualHost,
            onValueChange = vm::setManualHost,
            label = { Text("Bridge IP address") },
            placeholder = { Text("192.168.1.74") },
            singleLine = true,
            shape = RoundedCornerShape(16.dp),
            modifier = Modifier.fillMaxWidth(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
        )
        TextButton(onClick = vm::toggleAdvanced, modifier = Modifier.align(Alignment.End)) {
            Text(if (state.showAdvanced) "Hide advanced" else "Advanced (port / http)")
        }
        if (state.showAdvanced) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                PillTabs(listOf("https", "http"), if (state.manualHttps) 0 else 1, onSelect = { vm.setManualHttps(it == 0) }, modifier = Modifier.weight(1f))
                Spacer(Modifier.width(12.dp))
                OutlinedTextField(
                    value = state.manualPort,
                    onValueChange = vm::setManualPort,
                    label = { Text("Port") },
                    singleLine = true,
                    shape = RoundedCornerShape(16.dp),
                    modifier = Modifier.width(110.dp),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                )
            }
        }
        state.error?.let {
            Spacer(Modifier.height(8.dp))
            Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall, modifier = Modifier.fillMaxWidth())
        }
        Spacer(Modifier.height(16.dp))
        Button(onClick = vm::connectManual, enabled = !state.probing, modifier = Modifier.fillMaxWidth().height(52.dp), shape = CircleShape) {
            if (state.probing) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = MaterialTheme.colorScheme.onPrimary)
            else Text("Connect", style = MaterialTheme.typography.titleSmall)
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
private fun BridgeCard(b: DiscoveredBridge, onConnect: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .padding(vertical = 5.dp)
            .clip(RoundedCornerShape(hueTokens.cardRadius))
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .clickable(onClick = onConnect)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(44.dp).background(MaterialTheme.colorScheme.primaryContainer, CircleShape), contentAlignment = Alignment.Center) {
            Icon(Icons.Rounded.Router, contentDescription = null, tint = MaterialTheme.colorScheme.onPrimaryContainer)
        }
        Spacer(Modifier.width(14.dp))
        Column(Modifier.weight(1f)) {
            Text(b.name ?: "Hue bridge", style = MaterialTheme.typography.titleMedium)
            Text(
                listOfNotNull(b.host + (if (b.port != 443 && b.port != 80) ":${b.port}" else ""), b.modelId, b.swVersion?.let { "v$it" }).joinToString(" · "),
                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        FilledTonalButton(onClick = onConnect, shape = CircleShape) { Text("Connect") }
    }
}

@Composable
private fun PairingView(p: PairingState.InProgress, onCancel: () -> Unit) {
    val transition = rememberInfiniteTransition(label = "pulse")
    val scale by transition.animateFloat(0.9f, 1.1f, infiniteRepeatable(tween(900, easing = LinearEasing), RepeatMode.Reverse), label = "scale")
    val glow by transition.animateFloat(0.25f, 0.6f, infiniteRepeatable(tween(900, easing = LinearEasing), RepeatMode.Reverse), label = "glow")
    Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Box(contentAlignment = Alignment.Center) {
            Box(Modifier.size(220.dp).scale(scale).background(MaterialTheme.colorScheme.primary.copy(alpha = glow * 0.35f), CircleShape))
            Box(Modifier.size(150.dp).background(MaterialTheme.colorScheme.surfaceContainerHigh, CircleShape), contentAlignment = Alignment.Center) {
                Box(Modifier.size(60.dp).scale(scale).background(MaterialTheme.colorScheme.primary, CircleShape))
            }
        }
        Spacer(Modifier.height(36.dp))
        Text("Press the button on your Hue bridge", style = MaterialTheme.typography.headlineSmall, textAlign = TextAlign.Center)
        Spacer(Modifier.height(8.dp))
        Text(
            "Connecting to ${p.bridge.name ?: p.bridge.host}. Press the round link button in the middle of the bridge.",
            style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(28.dp))
        LinearProgressIndicator(progress = { p.secondsLeft / 60f }, modifier = Modifier.fillMaxWidth().clip(CircleShape), trackColor = MaterialTheme.colorScheme.surfaceContainerHighest)
        Spacer(Modifier.height(8.dp))
        Text("${p.secondsLeft} s left", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(28.dp))
        OutlinedButton(onClick = onCancel, shape = CircleShape) { Text("Cancel") }
    }
}

@Composable
private fun FailedView(message: String, onRetry: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Text("Pairing failed", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(8.dp))
        Text(message, style = MaterialTheme.typography.bodyLarge, textAlign = TextAlign.Center, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(24.dp))
        Button(onClick = onRetry, shape = CircleShape) { Text("Back") }
    }
}
