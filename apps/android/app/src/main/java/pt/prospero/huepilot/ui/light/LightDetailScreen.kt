package pt.prospero.huepilot.ui.light

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import pt.prospero.huepilot.data.hue.LightUi
import pt.prospero.huepilot.domain.ColorNames
import pt.prospero.huepilot.ui.HueViewModel
import pt.prospero.huepilot.ui.components.BrightnessSlider
import pt.prospero.huepilot.ui.components.ColorTemperatureSlider
import pt.prospero.huepilot.ui.components.ColorWheel
import pt.prospero.huepilot.ui.components.TextInputDialog
import pt.prospero.huepilot.ui.components.hexColor
import pt.prospero.huepilot.ui.components.lightArchetypeIcon
import pt.prospero.huepilot.ui.components.prettyName
import kotlin.math.roundToInt

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun LightDetailScreen(vm: HueViewModel, lightId: String, onBack: () -> Unit) {
    val snapshot by vm.snapshot.collectAsStateWithLifecycle()
    val light = snapshot.light(lightId)
    var rename by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(light?.name ?: "Light", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back") } },
                actions = {
                    if (light != null) {
                        IconButton(onClick = { vm.identify(light) }) { Icon(Icons.Outlined.Visibility, contentDescription = "Identify (blink)") }
                        IconButton(onClick = { rename = true }) { Icon(Icons.Outlined.Edit, contentDescription = "Rename") }
                    }
                },
            )
        },
    ) { padding ->
        if (light == null) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) { Text("This light no longer exists.") }
            return@Scaffold
        }
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()).padding(bottom = 32.dp)) {
            HeaderCard(light, onToggle = { vm.setLightOn(light, it) }, onBrightness = { vm.setLightBrightness(light, it) })

            val tabs = buildList {
                if (light.supportsColor) add("Colour")
                if (light.supportsCt) add("White")
                if (light.supportsEffects) add("Effects")
            }
            if (tabs.isNotEmpty()) {
                var tab by rememberSaveable(light.id) { mutableIntStateOf(0) }
                if (tab >= tabs.size) tab = 0
                TabRow(selectedTabIndex = tab, modifier = Modifier.padding(horizontal = 16.dp)) {
                    tabs.forEachIndexed { i, t -> Tab(selected = tab == i, onClick = { tab = i }, text = { Text(t) }) }
                }
                Spacer(Modifier.height(16.dp))
                when (tabs[tab]) {
                    "Colour" -> ColorTab(light, onXy = { vm.setLightColor(light, it) })
                    "White" -> WhiteTab(light, onMirek = { vm.setLightMirek(light, it) })
                    "Effects" -> EffectsTab(light, onEffect = { vm.setLightEffect(light, it) })
                }
            }

            if (light.supportsColor || light.supportsCt) {
                Text("Quick palette", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 24.dp, bottom = 8.dp))
                LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(ColorNames.QUICK_PALETTE.filter { (label, _) ->
                        val p = ColorNames.parseColor(label.lowercase())
                        (p?.xy != null && light.supportsColor) || (p?.mirek != null && light.supportsCt)
                    }) { (label, hex) ->
                        val p = ColorNames.parseColor(label.lowercase())
                        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.clickable {
                            p?.xy?.let { vm.setLightColor(light, it) }
                            p?.mirek?.let { vm.setLightMirek(light, it) }
                        }) {
                            Box(Modifier.size(40.dp).background(hexColor(hex), CircleShape).border(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.3f), CircleShape))
                            Text(label, style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
            }

            Row(Modifier.padding(16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedButton(onClick = { vm.identify(light) }) { Text("Identify (blink)") }
                OutlinedButton(onClick = { rename = true }) { Text("Rename") }
            }

            InfoCard(light)
        }
    }
    if (rename && light != null) {
        TextInputDialog(title = "Rename light", initial = light.name, onDismiss = { rename = false }) { vm.renameLight(light, it); rename = false }
    }
}

@Composable
private fun HeaderCard(light: LightUi, onToggle: (Boolean) -> Unit, onBrightness: (Double) -> Unit) {
    Card(
        Modifier.padding(16.dp).fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
    ) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(48.dp).background(if (light.on) hexColor(light.swatchHex) else MaterialTheme.colorScheme.surface, CircleShape)
                        .border(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.3f), CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(lightArchetypeIcon(light.archetype), contentDescription = null, tint = if (light.on) androidx.compose.ui.graphics.Color.Black.copy(alpha = 0.55f) else MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Spacer(Modifier.width(16.dp))
                Column(Modifier.weight(1f)) {
                    Text(if (light.on) "On" else "Off", style = MaterialTheme.typography.titleLarge)
                    Text(
                        listOfNotNull(
                            light.roomName,
                            if (light.on && light.supportsDimming) "${light.brightness.roundToInt()}%" else null,
                            if (light.on && light.isCtMode) "${light.kelvin} K" else null,
                            light.activeEffect?.let { prettyName(it) },
                        ).joinToString(" · "),
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Switch(checked = light.on, onCheckedChange = onToggle)
            }
            if (light.supportsDimming) {
                Spacer(Modifier.height(4.dp))
                BrightnessSlider(value = light.brightness, onCommit = onBrightness)
            }
        }
    }
}

@Composable
private fun ColorTab(light: LightUi, onXy: (pt.prospero.huepilot.domain.XY) -> Unit) {
    Column(Modifier.padding(horizontal = 32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        ColorWheel(currentXy = if (light.isCtMode) null else light.xy, gamut = light.gamut, onColorSelected = onXy)
        Spacer(Modifier.height(8.dp))
        Text(
            "Drag anywhere on the wheel. Colours are clipped to this light's gamut${light.gamutType?.let { " ($it)" } ?: ""}.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun WhiteTab(light: LightUi, onMirek: (Int) -> Unit) {
    Column(Modifier.padding(horizontal = 16.dp)) {
        ColorTemperatureSlider(
            mirek = light.mirek ?: ((light.mirekMin + light.mirekMax) / 2),
            mirekMin = light.mirekMin,
            mirekMax = light.mirekMax,
            onCommit = onMirek,
        )
        Spacer(Modifier.height(12.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
            listOf("Candle" to 2000, "Relax" to 2237, "Warm" to 2700, "Read" to 3000, "Cool" to 4000, "Daylight" to 6500).forEach { (label, k) ->
                val m = (1_000_000.0 / k).roundToInt().coerceIn(light.mirekMin, light.mirekMax)
                FilterChip(selected = light.isCtMode && light.mirek == m, onClick = { onMirek(m) }, label = { Text(label) })
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun EffectsTab(light: LightUi, onEffect: (String) -> Unit) {
    Column(Modifier.padding(horizontal = 16.dp)) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            (light.effectValues.filter { it != "no_effect" } + "no_effect").forEach { e ->
                val selected = if (e == "no_effect") light.activeEffect == null else light.activeEffect == e
                FilterChip(selected = selected, onClick = { onEffect(e) }, label = { Text(if (e == "no_effect") "None" else prettyName(e)) })
            }
        }
        Text(
            "Effects run on the light until you stop them or set a new colour.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp),
        )
    }
}

@Composable
private fun InfoCard(light: LightUi) {
    Card(Modifier.padding(horizontal = 16.dp).fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(Icons.Outlined.Info, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(8.dp))
                Text("About this light", style = MaterialTheme.typography.titleSmall)
            }
            Spacer(Modifier.height(8.dp))
            InfoRow("Product", light.productName)
            InfoRow("Model", light.modelId)
            InfoRow("Software", light.softwareVersion)
            InfoRow("Archetype", prettyName(light.archetype))
            InfoRow("Connectivity", prettyName(light.connectivity))
            InfoRow("Capabilities", listOfNotNull(
                if (light.supportsDimming) "dimming" else null,
                if (light.supportsColor) "colour" else null,
                if (light.supportsCt) "white ${ (1_000_000 / light.mirekMax)}–${1_000_000 / light.mirekMin} K" else null,
                if (light.supportsEffects) "effects" else null,
            ).joinToString(", "))
            InfoRow("v1 id", light.idV1)
        }
    }
}

@Composable
private fun InfoRow(label: String, value: String?) {
    if (value.isNullOrBlank()) return
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.width(110.dp))
        Text(value, style = MaterialTheme.typography.bodySmall)
    }
}
