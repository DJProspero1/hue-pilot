package pt.prospero.huepilot.ui.accessories

import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.BatteryStd
import androidx.compose.material.icons.outlined.DirectionsRun
import androidx.compose.material.icons.outlined.Router
import androidx.compose.material.icons.outlined.Sensors
import androidx.compose.material.icons.outlined.Thermostat
import androidx.compose.material.icons.outlined.ToggleOn
import androidx.compose.material.icons.outlined.WbSunny
import androidx.compose.material3.AssistChip
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import pt.prospero.huepilot.data.hue.AccessoryUi
import pt.prospero.huepilot.ui.HueViewModel
import pt.prospero.huepilot.ui.components.EmptyState
import pt.prospero.huepilot.ui.components.prettyName
import java.time.Duration
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.math.roundToInt

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccessoriesScreen(vm: HueViewModel) {
    val snapshot by vm.snapshot.collectAsStateWithLifecycle()
    Scaffold(topBar = { TopAppBar(title = { Text("Accessories") }) }) { padding ->
        if (snapshot.accessories.isEmpty()) {
            EmptyState("No accessories", "Motion sensors, switches and the bridge show up here.", Modifier.padding(padding))
            return@Scaffold
        }
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(top = 8.dp, bottom = 96.dp)) {
            items(snapshot.accessories, key = { it.deviceId }) { a ->
                AccessoryCard(a, snapshot.bridge?.bridgeId, onMotionEnabled = { id, en -> vm.setMotionEnabled(id, en) })
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AccessoryCard(a: AccessoryUi, bridgeId: String?, onMotionEnabled: (String, Boolean) -> Unit) {
    val icon = when (a.kind) {
        "bridge" -> Icons.Outlined.Router
        "motion" -> Icons.Outlined.DirectionsRun
        "switch" -> Icons.Outlined.ToggleOn
        else -> Icons.Outlined.Sensors
    }
    Card(Modifier.padding(horizontal = 16.dp, vertical = 6.dp).fillMaxWidth(), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer)) {
        Column(Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(28.dp))
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(a.name, style = MaterialTheme.typography.titleMedium)
                    Text(
                        listOfNotNull(a.productName, a.modelId, a.softwareVersion?.let { "v$it" }, a.connectivity?.let { prettyName(it) }).joinToString(" · "),
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (a.motionId != null && a.motionEnabled != null) {
                    Switch(checked = a.motionEnabled, onCheckedChange = { onMotionEnabled(a.motionId, it) })
                }
            }
            if (a.isBridge && bridgeId != null) {
                Spacer(Modifier.height(8.dp))
                Text("Bridge id $bridgeId", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.height(8.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (a.motionId != null) {
                    Reading(Icons.Outlined.DirectionsRun, if (a.motion == true) "Motion detected" else "No motion", a.motionUpdated)
                }
                a.temperatureC?.let { Reading(Icons.Outlined.Thermostat, "${((it * 10).roundToInt() / 10.0)} °C", a.temperatureUpdated) }
                a.lux?.let { Reading(Icons.Outlined.WbSunny, "${it.roundToInt()} lux", a.lightLevelUpdated) }
                a.batteryLevel?.let { Reading(Icons.Outlined.BatteryStd, "$it%" + (a.batteryState?.takeIf { s -> s != "normal" }?.let { s -> " ($s)" } ?: ""), null) }
                a.buttons.forEach { b ->
                    Reading(Icons.Outlined.ToggleOn, "Button ${b.controlId ?: ""}: ${b.lastEvent?.let { prettyName(it) } ?: "—"}", b.updated)
                }
            }
        }
    }
}

@Composable
private fun Reading(icon: androidx.compose.ui.graphics.vector.ImageVector, text: String, updated: String?) {
    AssistChip(
        onClick = {},
        label = {
            Column {
                Text(text)
                updated?.let { Text(relativeTime(it), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            }
        },
        leadingIcon = { Icon(icon, contentDescription = null, Modifier.size(16.dp)) },
    )
}

private val fmt = DateTimeFormatter.ofPattern("d MMM HH:mm")

fun relativeTime(iso: String): String = runCatching {
    val instant = runCatching { OffsetDateTime.parse(iso).toInstant() }
        .getOrElse { Instant.parse(if (iso.endsWith("Z")) iso else iso + "Z") }
    val d = Duration.between(instant, Instant.now())
    when {
        d.toMinutes() < 1 -> "just now"
        d.toMinutes() < 60 -> "${d.toMinutes()} min ago"
        d.toHours() < 24 -> "${d.toHours()} h ago"
        else -> fmt.format(instant.atZone(ZoneId.systemDefault()))
    }
}.getOrDefault(iso)
