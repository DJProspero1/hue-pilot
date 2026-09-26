package pt.prospero.huepilot.ui.light

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.AutoFixHigh
import androidx.compose.material.icons.rounded.BlurCircular
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Edit
import androidx.compose.material.icons.rounded.Grain
import androidx.compose.material.icons.rounded.Lens
import androidx.compose.material.icons.rounded.LocalFireDepartment
import androidx.compose.material.icons.rounded.NightsStay
import androidx.compose.material.icons.rounded.Stop
import androidx.compose.material.icons.rounded.Visibility
import androidx.compose.material.icons.rounded.Water
import androidx.compose.material.icons.rounded.WbSunny
import androidx.compose.material.icons.rounded.WbTwilight
import androidx.compose.material.icons.rounded.Whatshot
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import pt.prospero.huepilot.data.hue.LightUi
import pt.prospero.huepilot.domain.ColorMath
import pt.prospero.huepilot.domain.ColorNames
import pt.prospero.huepilot.ui.HueViewModel
import pt.prospero.huepilot.ui.components.AmbientCard
import pt.prospero.huepilot.ui.components.CircleIconButton
import pt.prospero.huepilot.ui.components.ColorTemperatureSlider
import pt.prospero.huepilot.ui.components.ColorWheel
import pt.prospero.huepilot.ui.components.FillSlider
import pt.prospero.huepilot.ui.components.GlowIcon
import pt.prospero.huepilot.ui.components.HueSwitch
import pt.prospero.huepilot.ui.components.PillTabs
import pt.prospero.huepilot.ui.components.ScreenHeader
import pt.prospero.huepilot.ui.components.SectionTitle
import pt.prospero.huepilot.ui.components.SwatchRow
import pt.prospero.huepilot.ui.components.TextInputDialog
import pt.prospero.huepilot.ui.components.bleed
import pt.prospero.huepilot.ui.components.hexColor
import pt.prospero.huepilot.ui.components.lightArchetypeIcon
import pt.prospero.huepilot.ui.components.prettyName
import pt.prospero.huepilot.ui.theme.hueTokens
import kotlin.math.roundToInt

@Composable
fun LightDetailScreen(vm: HueViewModel, lightId: String, onBack: () -> Unit) {
    val snapshot by vm.snapshot.collectAsStateWithLifecycle()
    val light = snapshot.light(lightId)
    var rename by remember { mutableStateOf(false) }

    if (light == null) {
        Column(Modifier.fillMaxSize()) {
            ScreenHeader("Light", onBack = onBack)
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("This light no longer exists.") }
        }
        return
    }
    val tint = hexColor(light.swatchHex)

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = 40.dp)) {
        ScreenHeader(
            title = light.name,
            eyebrow = light.roomName ?: "Light",
            subtitle = light.productName,
            onBack = onBack,
            actions = {
                CircleIconButton(Icons.Rounded.Visibility, "Identify (blink)", onClick = { vm.identify(light) })
                CircleIconButton(Icons.Rounded.Edit, "Rename", onClick = { rename = true })
            },
        )

        AmbientCard(hexes = listOf(light.swatchHex), on = light.on, modifier = Modifier.padding(horizontal = 20.dp), contentPadding = 18.dp) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                GlowIcon(lightArchetypeIcon(light.archetype), color = tint, on = light.on, size = 54.dp, iconSize = 27.dp)
                Spacer(Modifier.width(14.dp))
                Column(Modifier.weight(1f)) {
                    Text(if (light.on) "On" else "Off", style = MaterialTheme.typography.headlineSmall)
                    Text(
                        listOfNotNull(
                            if (light.on && light.supportsDimming) "${light.brightness.roundToInt()}%" else null,
                            if (light.on && light.isCtMode) "${light.kelvin} K" else null,
                            light.activeEffect?.let { "${prettyName(it)} effect" },
                            if (!light.on) "Tap the switch to turn on" else null,
                        ).joinToString(" · "),
                        style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                HueSwitch(checked = light.on, onCheckedChange = { vm.setLightOn(light, it) })
            }
            if (light.supportsDimming) {
                Spacer(Modifier.height(18.dp))
                FillSlider(value = light.brightness, tint = tint, height = 48.dp, onCommit = { vm.setLightBrightness(light, it) })
            }
        }

        val tabs = buildList {
            if (light.supportsColor) add("Colour")
            if (light.supportsCt) add("White")
            if (light.supportsEffects) add("Effects")
        }
        if (tabs.isNotEmpty()) {
            var tab by rememberSaveable(light.id) { mutableIntStateOf(0) }
            if (tab >= tabs.size) tab = 0
            Spacer(Modifier.height(20.dp))
            if (tabs.size > 1) {
                PillTabs(tabs, tab, onSelect = { tab = it }, modifier = Modifier.padding(horizontal = 20.dp))
                Spacer(Modifier.height(20.dp))
            }
            when (tabs[tab]) {
                "Colour" -> ColorTab(light, onXy = { vm.setLightColor(light, it) })
                "White" -> WhiteTab(light, onMirek = { vm.setLightMirek(light, it) })
                "Effects" -> EffectsTab(light, onEffect = { vm.setLightEffect(light, it) })
            }
        }

        Spacer(Modifier.height(20.dp))
        SectionTitle("About this light")
        InfoCard(light)
    }
    if (rename) {
        TextInputDialog(title = "Rename light", initial = light.name, onDismiss = { rename = false }) { vm.renameLight(light, it); rename = false }
    }
}

@Composable
private fun ColorTab(light: LightUi, onXy: (pt.prospero.huepilot.domain.XY) -> Unit) {
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        ColorWheel(currentXy = if (light.isCtMode) null else light.xy, gamut = light.gamut, onColorSelected = onXy, modifier = Modifier.padding(horizontal = 40.dp))
        Spacer(Modifier.height(20.dp))
        SwatchRow(
            ColorNames.QUICK_PALETTE.filter { (label, _) -> ColorNames.parseColor(label.lowercase())?.xy != null },
            modifier = Modifier.horizontalScroll(rememberScrollState()), contentPadding = 20.dp,
        ) { label, _ -> ColorNames.parseColor(label.lowercase())?.xy?.let(onXy) }
    }
}

@Composable
private fun WhiteTab(light: LightUi, onMirek: (Int) -> Unit) {
    Column(Modifier.padding(horizontal = 20.dp)) {
        ColorTemperatureSlider(
            mirek = light.mirek ?: ((light.mirekMin + light.mirekMax) / 2),
            mirekMin = light.mirekMin,
            mirekMax = light.mirekMax,
            onCommit = onMirek,
        )
        Spacer(Modifier.height(20.dp))
        val presets = listOf("Candle" to 2000, "Relax" to 2237, "Warm" to 2700, "Read" to 3000, "Neutral" to 3500, "Cool" to 4000, "Daylight" to 6500)
        SwatchRow(
            presets.map { (label, k) -> label to ColorMath.kelvinToRgb(k).toHex() },
            modifier = Modifier.bleed(20.dp).horizontalScroll(rememberScrollState()), contentPadding = 20.dp,
        ) { label, _ ->
            val k = presets.first { it.first == label }.second
            onMirek((1_000_000.0 / k).roundToInt().coerceIn(light.mirekMin, light.mirekMax))
        }
    }
}

private fun effectIcon(effect: String): ImageVector = when (effect) {
    "candle" -> Icons.Rounded.LocalFireDepartment
    "fire" -> Icons.Rounded.Whatshot
    "prism" -> Icons.Rounded.AutoAwesome
    "sparkle" -> Icons.Rounded.AutoFixHigh
    "opal" -> Icons.Rounded.Lens
    "glisten" -> Icons.Rounded.Grain
    "cosmos" -> Icons.Rounded.NightsStay
    "sunbeam" -> Icons.Rounded.WbSunny
    "sunrise", "sunset" -> Icons.Rounded.WbTwilight
    "underwater" -> Icons.Rounded.Water
    else -> Icons.Rounded.BlurCircular
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun EffectsTab(light: LightUi, onEffect: (String) -> Unit) {
    Column(Modifier.padding(horizontal = 20.dp)) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalArrangement = Arrangement.spacedBy(10.dp), maxItemsInEachRow = 3) {
            light.effectValues.filter { it != "no_effect" }.forEach { e ->
                EffectTile(label = prettyName(e), icon = effectIcon(e), selected = light.activeEffect == e, modifier = Modifier.weight(1f)) { onEffect(e) }
            }
        }
        if (light.activeEffect != null) {
            Spacer(Modifier.height(10.dp))
            EffectTile(label = "Stop effect", icon = Icons.Rounded.Stop, selected = false, modifier = Modifier.fillMaxWidth()) { onEffect("no_effect") }
        }
        Text(
            "Effects keep running until you stop them or pick a colour.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 12.dp),
        )
    }
}

@Composable
private fun EffectTile(label: String, icon: ImageVector, selected: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val bg by animateColorAsState(if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainer, label = "effect")
    val fg = if (selected) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface
    Column(
        modifier
            .clip(RoundedCornerShape(hueTokens.tileRadius))
            .background(bg)
            .clickable(onClick = onClick)
            .padding(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(icon, contentDescription = null, tint = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(22.dp))
            Spacer(Modifier.weight(1f))
            if (selected) Icon(Icons.Rounded.Check, contentDescription = "Active", tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(18.dp))
        }
        Spacer(Modifier.height(10.dp))
        Text(label, style = MaterialTheme.typography.labelLarge, color = fg, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun InfoCard(light: LightUi) {
    Column(
        Modifier
            .padding(horizontal = 20.dp)
            .fillMaxWidth()
            .clip(RoundedCornerShape(hueTokens.cardRadius))
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .padding(16.dp),
    ) {
        InfoRow("Product", light.productName)
        InfoRow("Model", light.modelId)
        InfoRow("Software", light.softwareVersion)
        InfoRow("Type", prettyName(light.archetype))
        InfoRow("Connection", prettyName(light.connectivity))
        InfoRow(
            "Capabilities",
            listOfNotNull(
                if (light.supportsDimming) "dimming" else null,
                if (light.supportsColor) "colour (gamut ${light.gamutType ?: "?"})" else null,
                if (light.supportsCt) "white ${1_000_000 / light.mirekMax}–${1_000_000 / light.mirekMin} K" else null,
                if (light.supportsEffects) "effects" else null,
            ).joinToString(", "),
        )
        InfoRow("Legacy id", light.idV1)
    }
}

@Composable
private fun InfoRow(label: String, value: String?) {
    if (value.isNullOrBlank()) return
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.width(110.dp))
        Text(value, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
    }
}
