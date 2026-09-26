package pt.prospero.huepilot.ui.home

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.Settings
import androidx.compose.material.icons.rounded.Videocam
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import pt.prospero.huepilot.data.hue.GroupUi
import pt.prospero.huepilot.data.hue.HomeSnapshot
import pt.prospero.huepilot.data.hue.StreamState
import pt.prospero.huepilot.ui.HueViewModel
import pt.prospero.huepilot.ui.components.AmbientCard
import pt.prospero.huepilot.ui.components.CircleIconButton
import pt.prospero.huepilot.ui.components.ColorDots
import pt.prospero.huepilot.ui.components.EmptyState
import pt.prospero.huepilot.ui.components.FillSlider
import pt.prospero.huepilot.ui.components.GlowIcon
import pt.prospero.huepilot.ui.components.HueSwitch
import pt.prospero.huepilot.ui.components.SectionTitle
import pt.prospero.huepilot.ui.components.archetypeIcon
import pt.prospero.huepilot.ui.components.greeting
import pt.prospero.huepilot.ui.components.hexColor
import pt.prospero.huepilot.ui.components.pluralize
import pt.prospero.huepilot.ui.components.relativeTime
import pt.prospero.huepilot.ui.theme.HuePalette
import kotlin.math.roundToInt

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    vm: HueViewModel,
    onOpenGroup: (String) -> Unit,
    onOpenSettings: () -> Unit,
    onOpenAssistant: () -> Unit,
    onOpenSensors: () -> Unit,
) {
    val snapshot by vm.snapshot.collectAsStateWithLifecycle()
    val status by vm.status.collectAsStateWithLifecycle()
    val stream by vm.streamState.collectAsStateWithLifecycle()

    PullToRefreshBox(isRefreshing = status.loading, onRefresh = vm::refresh, modifier = Modifier.fillMaxSize()) {
        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 110.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                HomeHeader(snapshot, live = stream == StreamState.CONNECTED, error = status.error, onOpenAssistant = onOpenAssistant, onOpenSettings = onOpenSettings)
            }
            if (snapshot.isEmpty) {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    EmptyState(
                        title = if (status.loading) "Loading your home…" else "Nothing to show yet",
                        subtitle = status.error ?: "Pull down to refresh.",
                        icon = Icons.Rounded.Home,
                    )
                }
                return@LazyVerticalGrid
            }
            item(span = { GridItemSpan(maxLineSpan) }) {
                AllLightsCard(snapshot, onToggle = vm::setAllOn)
            }
            if (snapshot.cameras.isNotEmpty() || snapshot.motionSensors.isNotEmpty()) {
                item(span = { GridItemSpan(maxLineSpan) }) { SecurityStrip(snapshot, onOpenSensors) }
            }
            if (snapshot.rooms.isNotEmpty()) {
                item(span = { GridItemSpan(maxLineSpan) }) { SectionTitle("Rooms", count = snapshot.rooms.size, horizontalPadding = 4.dp, modifier = Modifier.padding(top = 6.dp)) }
                items(snapshot.rooms, key = { it.id }) { g ->
                    GroupCard(g, onOpen = { onOpenGroup(g.id) }, onToggle = { vm.setGroupOn(g, it) }, onBrightness = { vm.setGroupBrightness(g, it) })
                }
            }
            if (snapshot.zones.isNotEmpty()) {
                item(span = { GridItemSpan(maxLineSpan) }) { SectionTitle("Zones", count = snapshot.zones.size, horizontalPadding = 4.dp, modifier = Modifier.padding(top = 6.dp)) }
                items(snapshot.zones, key = { it.id }) { g ->
                    GroupCard(g, onOpen = { onOpenGroup(g.id) }, onToggle = { vm.setGroupOn(g, it) }, onBrightness = { vm.setGroupBrightness(g, it) })
                }
            }
            if (snapshot.lightsWithoutRoom.isNotEmpty()) {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    Text(
                        "${pluralize(snapshot.lightsWithoutRoom.size, "light")} not assigned to a room — see the Lights tab.",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                }
            }
        }
    }
}

@Composable
private fun HomeHeader(snapshot: HomeSnapshot, live: Boolean, error: String?, onOpenAssistant: () -> Unit, onOpenSettings: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(greeting(), style = MaterialTheme.typography.headlineLarge)
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (live) {
                    Box(Modifier.size(8.dp).background(HuePalette.Success, CircleShape))
                    Spacer(Modifier.width(6.dp))
                }
                val sub = when {
                    error != null && snapshot.isEmpty -> error
                    snapshot.isEmpty -> "Connecting to your bridge"
                    snapshot.lightsOn == 0 -> "All ${snapshot.lights.size} lights are off"
                    else -> "${snapshot.lightsOn} of ${snapshot.lights.size} lights on"
                }
                Text(sub, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        CircleIconButton(Icons.Rounded.AutoAwesome, "Assistant", onOpenAssistant, tint = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.width(8.dp))
        CircleIconButton(Icons.Rounded.Settings, "Settings", onOpenSettings)
    }
}

@Composable
private fun AllLightsCard(snapshot: HomeSnapshot, onToggle: (Boolean) -> Unit) {
    val hexes = snapshot.litHexes
    AmbientCard(hexes = hexes, on = snapshot.allOn, contentPadding = 18.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            GlowIcon(Icons.Rounded.Home, color = hexColor(hexes.firstOrNull() ?: "#ffd9a3"), on = snapshot.allOn, size = 50.dp, iconSize = 26.dp)
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text("All lights", style = MaterialTheme.typography.titleLarge)
                Text(
                    if (snapshot.lightsOn == 0) "Everything is off" else "${snapshot.lightsOn} of ${snapshot.lights.size} on in ${pluralize(snapshot.rooms.count { it.on }, "room")}",
                    style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            HueSwitch(checked = snapshot.allOn, onCheckedChange = onToggle)
        }
        AnimatedVisibility(visible = hexes.size > 1, enter = fadeIn(), exit = fadeOut()) {
            Column {
                Spacer(Modifier.height(12.dp))
                ColorDots(hexes, size = 14.dp, max = 10)
            }
        }
    }
}

@Composable
private fun SecurityStrip(snapshot: HomeSnapshot, onOpen: () -> Unit) {
    val watchers = snapshot.cameras + snapshot.motionSensors
    val active = watchers.filter { it.motion == true }
    val alert = active.isNotEmpty()
    val tint = if (alert) HuePalette.Danger else MaterialTheme.colorScheme.tertiary
    AmbientCard(hexes = emptyList(), on = false, onClick = onOpen, contentPadding = 14.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            GlowIcon(Icons.Rounded.Videocam, color = tint, on = alert, size = 42.dp, iconSize = 21.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    when {
                        !alert -> "All clear"
                        active.size == 1 -> "Motion at ${active[0].name}"
                        else -> "Motion at ${active[0].name} + ${active.size - 1} more"
                    },
                    style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis,
                    color = if (alert) HuePalette.Danger else MaterialTheme.colorScheme.onSurface,
                )
                val parts = buildList {
                    if (snapshot.cameras.isNotEmpty()) add(pluralize(snapshot.cameras.size, "camera"))
                    if (snapshot.motionSensors.isNotEmpty()) add(pluralize(snapshot.motionSensors.size, "motion sensor"))
                    val last = watchers.mapNotNull { it.motionUpdated }.maxOrNull()
                    if (!alert && last != null) add("last motion ${relativeTime(last)}")
                }
                Text(parts.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Icon(Icons.Rounded.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
fun GroupCard(group: GroupUi, onOpen: () -> Unit, onToggle: (Boolean) -> Unit, onBrightness: (Double) -> Unit) {
    val tint = hexColor(group.colorHexes.firstOrNull() ?: "#ffd9a3")
    AmbientCard(hexes = group.colorHexes, on = group.on, onClick = onOpen, contentPadding = 14.dp) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            GlowIcon(archetypeIcon(group.archetype), color = tint, on = group.on, size = 40.dp, iconSize = 20.dp)
            Spacer(Modifier.weight(1f))
            HueSwitch(checked = group.on, onCheckedChange = onToggle, enabled = group.lights.isNotEmpty())
        }
        Spacer(Modifier.height(12.dp))
        Text(group.name, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Row(verticalAlignment = Alignment.CenterVertically) {
            val subtitle = when {
                group.lights.isEmpty() -> "No lights"
                group.on -> "${group.lightsOn} of ${group.lights.size} on · ${group.brightness.roundToInt()}%"
                else -> "${pluralize(group.lights.size, "light")} · off"
            }
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (group.on && group.colorHexes.size > 1) ColorDots(group.colorHexes, size = 10.dp, max = 4)
        }
        Spacer(Modifier.height(10.dp))
        Box(Modifier.height(28.dp).fillMaxWidth()) {
            androidx.compose.animation.AnimatedVisibility(visible = group.on && group.lights.isNotEmpty(), enter = fadeIn(), exit = fadeOut()) {
                FillSlider(value = group.brightness, tint = tint, height = 28.dp, showLabel = false, onCommit = onBrightness)
            }
        }
    }
}
