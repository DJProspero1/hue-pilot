package pt.prospero.huepilot.ui.accessories

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.OpenInNew
import androidx.compose.material.icons.rounded.BatteryAlert
import androidx.compose.material.icons.rounded.BatteryStd
import androidx.compose.material.icons.rounded.DirectionsRun
import androidx.compose.material.icons.rounded.Lightbulb
import androidx.compose.material.icons.rounded.Router
import androidx.compose.material.icons.rounded.Sensors
import androidx.compose.material.icons.rounded.Thermostat
import androidx.compose.material.icons.rounded.ToggleOn
import androidx.compose.material.icons.rounded.Videocam
import androidx.compose.material.icons.rounded.VideocamOff
import androidx.compose.material.icons.rounded.WbSunny
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import pt.prospero.huepilot.data.hue.AccessoryUi
import pt.prospero.huepilot.data.hue.LightUi
import pt.prospero.huepilot.ui.HueViewModel
import pt.prospero.huepilot.ui.components.AmbientCard
import pt.prospero.huepilot.ui.components.EmptyState
import pt.prospero.huepilot.ui.components.FillSlider
import pt.prospero.huepilot.ui.components.GlowIcon
import pt.prospero.huepilot.ui.components.HueSwitch
import pt.prospero.huepilot.ui.components.ScreenHeader
import pt.prospero.huepilot.ui.components.SectionTitle
import pt.prospero.huepilot.ui.components.StatusPill
import pt.prospero.huepilot.ui.components.hexColor
import pt.prospero.huepilot.ui.components.pluralize
import pt.prospero.huepilot.ui.components.prettyName
import pt.prospero.huepilot.ui.components.relativeTime
import pt.prospero.huepilot.ui.theme.HuePalette
import pt.prospero.huepilot.ui.theme.hueTokens
import kotlin.math.roundToInt
import pt.prospero.huepilot.data.hue.MotionAutomationUi
import androidx.compose.material.icons.rounded.Bolt
import androidx.compose.foundation.layout.size

private const val HUE_APP_PACKAGE = "com.philips.lighting.hue2"

@Composable
fun AccessoriesScreen(vm: HueViewModel) {
    val snapshot by vm.snapshot.collectAsStateWithLifecycle()
    val cameras = snapshot.cameras
    val sensors = snapshot.motionSensors
    val switches = snapshot.switches
    val others = snapshot.accessories.filter { it.kind == "other" }
    val bridge = snapshot.accessories.filter { it.isBridge }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 110.dp)) {
        item {
            val parts = buildList {
                if (cameras.isNotEmpty()) add(pluralize(cameras.size, "camera"))
                if (sensors.isNotEmpty()) add(pluralize(sensors.size, "motion sensor"))
                if (switches.isNotEmpty()) add(pluralize(switches.size, "switch", "switches"))
            }
            ScreenHeader("Sensors", subtitle = parts.joinToString(" · ").ifBlank { null })
        }
        if (snapshot.accessories.isEmpty()) {
            item { EmptyState("No accessories", "Cameras, motion sensors, switches and the bridge show up here.", icon = Icons.Rounded.Sensors) }
            return@LazyColumn
        }
        if (cameras.isNotEmpty()) {
            item { SectionTitle("Cameras", count = cameras.size) }
            items(cameras, key = { it.deviceId }) { c ->
                CameraCard(c, floodlight = c.floodlightLightId?.let { snapshot.light(it) }, vm)
                snapshot.motionAutomations.firstOrNull { it.sourceDeviceId == c.deviceId }?.let { m ->
                    AutomationRow(m, onEnabled = { vm.setMotionAutomationEnabled(m.id, it) }, onDelete = { vm.deleteMotionAutomation(m.id) })
                }
            }
            item { CameraNote() }
        }
        if (sensors.isNotEmpty()) {
            item { SectionTitle("Motion sensors", count = sensors.size, modifier = Modifier.padding(top = 8.dp)) }
            items(sensors, key = { it.deviceId }) { a ->
                SensorCard(a, onMotionEnabled = { vm.setMotionEnabled(a, it) })
                snapshot.motionAutomations.firstOrNull { it.sourceDeviceId == a.deviceId }?.let { m ->
                    AutomationRow(m, onEnabled = { vm.setMotionAutomationEnabled(m.id, it) }, onDelete = { vm.deleteMotionAutomation(m.id) })
                }
            }
        }
        if (switches.isNotEmpty()) {
            item { SectionTitle("Switches", count = switches.size, modifier = Modifier.padding(top = 8.dp)) }
            items(switches, key = { it.deviceId }) { a -> SwitchCard(a) }
        }
        if (others.isNotEmpty()) {
            item { SectionTitle("Other devices", count = others.size, modifier = Modifier.padding(top = 8.dp)) }
            items(others, key = { it.deviceId }) { a -> SwitchCard(a) }
        }
        if (bridge.isNotEmpty()) {
            item { SectionTitle("Bridge", modifier = Modifier.padding(top = 8.dp)) }
            items(bridge, key = { it.deviceId }) { a -> BridgeCard(a, snapshot.bridge?.bridgeId, snapshot.bridge?.timeZone) }
        }
    }
}

/** The bridge rule behind a sensor or camera: which room it drives and what happens on motion. */
@Composable
private fun AutomationRow(a: MotionAutomationUi, onEnabled: (Boolean) -> Unit, onDelete: () -> Unit) {
    Row(
        Modifier
            .padding(horizontal = 28.dp)
            .padding(bottom = 8.dp)
            .fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Rounded.Bolt, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            Text(a.whereNames.joinToString(", "), style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(a.summary, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        TextButton(onClick = onDelete) { Text("Remove") }
        HueSwitch(checked = a.enabled, onCheckedChange = onEnabled)
    }
}

private fun deviceLine(a: AccessoryUi) =
    listOfNotNull(a.productName, a.modelId, a.softwareVersion?.let { "v$it" }, a.connectivity?.let { prettyName(it) }).joinToString(" · ")

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CameraCard(c: AccessoryUi, floodlight: LightUi?, vm: HueViewModel) {
    val motion = c.motion == true
    val paused = c.motionEnabled == false
    AmbientCard(hexes = listOf("#ff6b6b"), on = motion, modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp), contentPadding = 16.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            GlowIcon(if (paused) Icons.Rounded.VideocamOff else Icons.Rounded.Videocam, color = HuePalette.Danger, on = motion, size = 46.dp, iconSize = 23.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(c.name, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(deviceLine(c), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            Spacer(Modifier.width(8.dp))
            StatusPill(
                text = when { paused -> "Paused"; motion -> "Motion"; else -> "Clear" },
                color = when { paused -> MaterialTheme.colorScheme.onSurfaceVariant; motion -> Color.White; else -> HuePalette.Success },
                container = when { paused -> MaterialTheme.colorScheme.surfaceContainerHigh; motion -> HuePalette.Danger; else -> HuePalette.Success.copy(alpha = 0.15f) },
            )
        }
        Spacer(Modifier.height(12.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            StatusPill(if (motion) "Motion ${relativeTime(c.motionUpdated)}" else "Last motion ${relativeTime(c.motionUpdated)}", icon = Icons.Rounded.DirectionsRun)
            c.lux?.let { StatusPill("${it.roundToInt()} lux", icon = Icons.Rounded.WbSunny) }
            c.batteryLevel?.let { BatteryPill(it, c.batteryState) }
        }
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("Motion detection", style = MaterialTheme.typography.titleSmall)
                Text(if (paused) "Paused — the camera won't report motion" else "Reports motion to the bridge and automations", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            HueSwitch(checked = !paused, onCheckedChange = { vm.setMotionEnabled(c, it) }, enabled = c.motionId != null)
        }
        if (floodlight != null) {
            Spacer(Modifier.height(12.dp))
            val tint = hexColor(floodlight.swatchHex)
            Column(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(hueTokens.tileRadius))
                    .background(MaterialTheme.colorScheme.surfaceContainerLow.copy(alpha = 0.6f))
                    .padding(12.dp),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    GlowIcon(Icons.Rounded.Lightbulb, color = tint, on = floodlight.on, size = 36.dp, iconSize = 18.dp)
                    Spacer(Modifier.width(10.dp))
                    Column(Modifier.weight(1f)) {
                        Text("Floodlight", style = MaterialTheme.typography.titleSmall)
                        Text(if (floodlight.on) "On · ${floodlight.brightness.roundToInt()}%" else "Off", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    HueSwitch(checked = floodlight.on, onCheckedChange = { vm.setLightOn(floodlight, it) })
                }
                AnimatedVisibility(visible = floodlight.on && floodlight.supportsDimming, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
                    Column {
                        Spacer(Modifier.height(8.dp))
                        FillSlider(value = floodlight.brightness, tint = tint, height = 30.dp, showLabel = false, onCommit = { vm.setLightBrightness(floodlight, it) })
                    }
                }
            }
        }
    }
}

@Composable
private fun CameraNote() {
    val context = LocalContext.current
    Column(
        Modifier
            .padding(horizontal = 20.dp, vertical = 6.dp)
            .fillMaxWidth()
            .clip(RoundedCornerShape(hueTokens.tileRadius))
            .background(MaterialTheme.colorScheme.surfaceContainerLow)
            .padding(14.dp),
    ) {
        Text("Watching live video", style = MaterialTheme.typography.titleSmall)
        Text(
            "The bridge shares each camera's motion, ambient light and battery, but never its video: Hue Secure streams only leave Signify's cloud to the Philips Hue app, or to Google Home (Nest Hub) and Amazon Alexa (Echo Show, Fire TV) once you link Hue there. There is no local stream to show here.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        TextButton(
            onClick = {
                val launch = context.packageManager.getLaunchIntentForPackage(HUE_APP_PACKAGE)
                context.startActivity(launch ?: Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=$HUE_APP_PACKAGE")))
            },
            modifier = Modifier.align(Alignment.End),
        ) {
            Text("Open the Hue app")
            Spacer(Modifier.width(4.dp))
            Icon(Icons.AutoMirrored.Rounded.OpenInNew, contentDescription = null, modifier = Modifier.width(14.dp))
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SensorCard(a: AccessoryUi, onMotionEnabled: (Boolean) -> Unit) {
    val motion = a.motion == true
    AmbientCard(hexes = listOf("#8fd3c4"), on = motion, modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp), contentPadding = 16.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            GlowIcon(Icons.Rounded.DirectionsRun, color = MaterialTheme.colorScheme.tertiary, on = motion, size = 46.dp, iconSize = 23.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(a.name, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(deviceLine(a), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
            if (a.motionEnabled != null) {
                Spacer(Modifier.width(8.dp))
                HueSwitch(checked = a.motionEnabled, onCheckedChange = onMotionEnabled)
            }
        }
        Spacer(Modifier.height(12.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            StatusPill(
                if (motion) "Motion · ${relativeTime(a.motionUpdated)}" else "No motion · ${relativeTime(a.motionUpdated)}",
                icon = Icons.Rounded.DirectionsRun,
                color = if (motion) Color.White else MaterialTheme.colorScheme.onSurfaceVariant,
                container = if (motion) MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.surfaceContainerHigh,
            )
            a.temperatureC?.let { StatusPill("${(it * 10).roundToInt() / 10.0} °C", icon = Icons.Rounded.Thermostat) }
            a.lux?.let { StatusPill("${it.roundToInt()} lux", icon = Icons.Rounded.WbSunny) }
            a.batteryLevel?.let { BatteryPill(it, a.batteryState) }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SwitchCard(a: AccessoryUi) {
    AmbientCard(hexes = emptyList(), on = false, modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp), contentPadding = 16.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            GlowIcon(if (a.buttons.isNotEmpty()) Icons.Rounded.ToggleOn else Icons.Rounded.Sensors, color = MaterialTheme.colorScheme.primary, on = false, size = 46.dp, iconSize = 23.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(a.name, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(deviceLine(a), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2, overflow = TextOverflow.Ellipsis)
            }
        }
        if (a.buttons.isNotEmpty() || a.batteryLevel != null) {
            Spacer(Modifier.height(12.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                a.batteryLevel?.let { BatteryPill(it, a.batteryState) }
                a.buttons.forEach { b ->
                    StatusPill("Button ${b.controlId ?: ""}: ${b.lastEvent?.let { prettyName(it) } ?: "—"}${b.updated?.let { " · ${relativeTime(it)}" } ?: ""}")
                }
            }
        }
    }
}

@Composable
private fun BridgeCard(a: AccessoryUi, bridgeId: String?, timeZone: String?) {
    AmbientCard(hexes = emptyList(), on = false, modifier = Modifier.padding(horizontal = 20.dp, vertical = 6.dp), contentPadding = 16.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            GlowIcon(Icons.Rounded.Router, color = MaterialTheme.colorScheme.primary, on = false, size = 46.dp, iconSize = 23.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(a.name, style = MaterialTheme.typography.titleMedium)
                Text(deviceLine(a), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (bridgeId != null) Text("Bridge id $bridgeId${timeZone?.let { " · $it" } ?: ""}", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

@Composable
private fun BatteryPill(level: Int, state: String?) {
    val low = level < 20 || (state != null && state != "normal")
    StatusPill(
        "$level%",
        icon = if (low) Icons.Rounded.BatteryAlert else Icons.Rounded.BatteryStd,
        color = if (low) HuePalette.Danger else MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Suppress("unused")
private fun iconFor(kind: String): ImageVector = when (kind) {
    "camera" -> Icons.Rounded.Videocam
    "motion" -> Icons.Rounded.DirectionsRun
    "switch" -> Icons.Rounded.ToggleOn
    "bridge" -> Icons.Rounded.Router
    else -> Icons.Rounded.Sensors
}
