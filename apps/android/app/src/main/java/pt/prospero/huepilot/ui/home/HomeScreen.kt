package pt.prospero.huepilot.ui.home

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
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.SmartToy
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import pt.prospero.huepilot.data.hue.GroupUi
import pt.prospero.huepilot.data.hue.StreamState
import pt.prospero.huepilot.ui.HueViewModel
import pt.prospero.huepilot.ui.components.BrightnessSlider
import pt.prospero.huepilot.ui.components.ColorDots
import pt.prospero.huepilot.ui.components.EmptyState
import pt.prospero.huepilot.ui.components.archetypeIcon

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(vm: HueViewModel, onOpenGroup: (String) -> Unit, onOpenSettings: () -> Unit, onOpenAssistant: () -> Unit) {
    val snapshot by vm.snapshot.collectAsStateWithLifecycle()
    val status by vm.status.collectAsStateWithLifecycle()
    val stream by vm.streamState.collectAsStateWithLifecycle()
    val settings by vm.settings.collectAsStateWithLifecycle()

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Hue Pilot")
                        val sub = when {
                            status.error != null && snapshot.isEmpty -> status.error
                            stream == StreamState.CONNECTED -> "${snapshot.lightsOn} of ${snapshot.lights.size} lights on · live"
                            else -> "${snapshot.lightsOn} of ${snapshot.lights.size} lights on"
                        }
                        Text(sub ?: "", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                },
                actions = {
                    IconButton(onClick = onOpenAssistant) { Icon(Icons.Outlined.SmartToy, contentDescription = "Assistant") }
                    IconButton(onClick = onOpenSettings) { Icon(Icons.Outlined.Settings, contentDescription = "Settings") }
                },
            )
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = status.loading,
            onRefresh = vm::refresh,
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            if (snapshot.isEmpty) {
                Box(Modifier.fillMaxSize()) {
                    EmptyState(
                        title = if (status.loading) "Loading your home…" else "Nothing to show yet",
                        subtitle = status.error ?: "Pull down to refresh.",
                        modifier = Modifier.align(Alignment.Center),
                    )
                }
            } else {
                LazyVerticalGrid(
                    columns = GridCells.Adaptive(minSize = 170.dp),
                    contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 96.dp),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    modifier = Modifier.fillMaxSize(),
                ) {
                    item(span = { GridItemSpan(maxLineSpan) }) {
                        AllLightsCard(on = snapshot.allOn, lightsOn = snapshot.lightsOn, total = snapshot.lights.size, onToggle = vm::setAllOn)
                    }
                    if (snapshot.rooms.isNotEmpty()) {
                        item(span = { GridItemSpan(maxLineSpan) }) { SectionHeader("Rooms") }
                        items(snapshot.rooms, key = { it.id }) { g ->
                            GroupCard(g, favourite = g.id in settings.favouriteRoomIds, onOpen = { onOpenGroup(g.id) }, onToggle = { vm.setGroupOn(g, it) }, onBrightness = { vm.setGroupBrightness(g, it) })
                        }
                    }
                    if (snapshot.zones.isNotEmpty()) {
                        item(span = { GridItemSpan(maxLineSpan) }) { SectionHeader("Zones") }
                        items(snapshot.zones, key = { it.id }) { g ->
                            GroupCard(g, favourite = g.id in settings.favouriteRoomIds, onOpen = { onOpenGroup(g.id) }, onToggle = { vm.setGroupOn(g, it) }, onBrightness = { vm.setGroupBrightness(g, it) })
                        }
                    }
                    if (snapshot.lightsWithoutRoom.isNotEmpty()) {
                        item(span = { GridItemSpan(maxLineSpan) }) {
                            Text(
                                "${snapshot.lightsWithoutRoom.size} light(s) are not assigned to a room — see the Lights tab.",
                                style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(top = 8.dp),
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun SectionHeader(text: String) {
    Text(text, style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(top = 8.dp, bottom = 2.dp))
}

@Composable
private fun AllLightsCard(on: Boolean, lightsOn: Int, total: Int, onToggle: (Boolean) -> Unit) {
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.Home, contentDescription = null, tint = MaterialTheme.colorScheme.onPrimaryContainer)
            Spacer(Modifier.width(16.dp))
            Column(Modifier.weight(1f)) {
                Text("All lights", style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onPrimaryContainer)
                Text(if (lightsOn == 0) "Everything is off" else "$lightsOn of $total on", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onPrimaryContainer)
            }
            Switch(checked = on, onCheckedChange = onToggle)
        }
    }
}

@Composable
fun GroupCard(
    group: GroupUi,
    favourite: Boolean = false,
    onOpen: () -> Unit,
    onToggle: (Boolean) -> Unit,
    onBrightness: (Double) -> Unit,
) {
    val container = if (group.on) MaterialTheme.colorScheme.surfaceVariant else MaterialTheme.colorScheme.surfaceContainerLow
    Card(
        colors = CardDefaults.cardColors(containerColor = container),
        modifier = Modifier.fillMaxWidth().clickable(onClick = onOpen),
    ) {
        Column(Modifier.padding(start = 14.dp, end = 8.dp, top = 12.dp, bottom = 4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    archetypeIcon(group.archetype), contentDescription = null,
                    tint = if (group.on) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(26.dp),
                )
                Spacer(Modifier.weight(1f))
                Switch(checked = group.on, onCheckedChange = onToggle, modifier = Modifier.height(32.dp))
            }
            Spacer(Modifier.height(8.dp))
            Text(group.name, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            val subtitle = when {
                group.lights.isEmpty() -> "No lights"
                group.on -> "${group.lightsOn} of ${group.lights.size} on"
                else -> "${group.lights.size} light${if (group.lights.size == 1) "" else "s"} · off"
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                if (group.colorHexes.isNotEmpty()) ColorDots(group.colorHexes, size = 10.dp, max = 5)
            }
            BrightnessSlider(
                value = group.brightness,
                enabled = group.lights.isNotEmpty(),
                showLabel = false,
                onCommit = onBrightness,
                modifier = Modifier.fillMaxWidth().height(36.dp),
            )
        }
    }
}
