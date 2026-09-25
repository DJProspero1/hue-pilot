package pt.prospero.huepilot.ui.room

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.ChevronRight
import androidx.compose.material.icons.outlined.Star
import androidx.compose.material.icons.outlined.StarBorder
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import pt.prospero.huepilot.data.hue.LightUi
import pt.prospero.huepilot.data.hue.SceneUi
import pt.prospero.huepilot.domain.ColorMath
import pt.prospero.huepilot.domain.ColorNames
import pt.prospero.huepilot.ui.HueViewModel
import pt.prospero.huepilot.ui.components.BrightnessSlider
import pt.prospero.huepilot.ui.components.ColorDots
import pt.prospero.huepilot.ui.components.ConfirmDialog
import pt.prospero.huepilot.ui.components.TextInputDialog
import pt.prospero.huepilot.ui.components.archetypeIcon
import pt.prospero.huepilot.ui.components.hexColor
import pt.prospero.huepilot.ui.components.lightArchetypeIcon
import kotlin.math.roundToInt

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RoomScreen(vm: HueViewModel, groupId: String, onBack: () -> Unit, onOpenLight: (String) -> Unit) {
    val snapshot by vm.snapshot.collectAsStateWithLifecycle()
    val settings by vm.settings.collectAsStateWithLifecycle()
    val group = snapshot.group(groupId)
    var saveDialog by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(group?.name ?: "Room") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Outlined.ArrowBack, contentDescription = "Back") } },
                actions = {
                    if (group != null) {
                        val fav = group.id in settings.favouriteRoomIds
                        IconButton(onClick = { vm.toggleFavouriteRoom(group.id) }) {
                            Icon(if (fav) Icons.Outlined.Star else Icons.Outlined.StarBorder, contentDescription = "Favourite (widget)")
                        }
                    }
                },
            )
        },
    ) { padding ->
        if (group == null) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) { Text("This room no longer exists.") }
            return@Scaffold
        }
        val scenes = snapshot.scenesFor(group.id)
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(bottom = 32.dp)) {
            item {
                Card(
                    Modifier.padding(horizontal = 16.dp, vertical = 8.dp).fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
                ) {
                    Column(Modifier.padding(16.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(archetypeIcon(group.archetype), contentDescription = null, modifier = Modifier.size(32.dp), tint = MaterialTheme.colorScheme.onPrimaryContainer)
                            Spacer(Modifier.width(12.dp))
                            Column(Modifier.weight(1f)) {
                                Text(if (group.on) "On" else "Off", style = MaterialTheme.typography.titleLarge, color = MaterialTheme.colorScheme.onPrimaryContainer)
                                Text("${group.lightsOn} of ${group.lights.size} lights on", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onPrimaryContainer)
                            }
                            Switch(checked = group.on, onCheckedChange = { vm.setGroupOn(group, it) })
                        }
                        Spacer(Modifier.height(4.dp))
                        BrightnessSlider(value = group.brightness, enabled = group.lights.isNotEmpty(), onCommit = { vm.setGroupBrightness(group, it) })
                    }
                }
            }

            item {
                Row(Modifier.padding(horizontal = 16.dp, vertical = 4.dp).fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("Scenes", style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                    OutlinedButton(onClick = { saveDialog = true }, enabled = group.lights.isNotEmpty()) {
                        Icon(Icons.Outlined.Add, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Save current")
                    }
                }
            }
            item {
                if (scenes.isEmpty()) {
                    Text("No scenes yet. Set the lights as you like and tap \"Save current\".", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
                } else {
                    LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        items(scenes, key = { it.id }) { s ->
                            SceneChip(
                                scene = s,
                                onActivate = { vm.recallScene(s.id, false) },
                                onDynamic = { vm.recallScene(s.id, true) },
                                onRename = { vm.renameScene(s.id, it) },
                                onDelete = { vm.deleteScene(s.id) },
                            )
                        }
                    }
                }
            }

            item {
                Text("Quick colours", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
                LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(ColorNames.QUICK_PALETTE) { (label, hex) ->
                        val parsed = ColorNames.parseColor(label.lowercase()) ?: ColorNames.parseColor(hex)
                        Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.clickable {
                            if (parsed != null) vm.setGroupColor(group, parsed.xy, parsed.mirek)
                        }) {
                            Box(Modifier.size(40.dp).background(hexColor(hex), CircleShape).border(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.3f), CircleShape))
                            Text(label, style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
            }

            item { Text("Lights", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 4.dp)) }
            items(group.lights, key = { it.id }) { l ->
                LightRow(
                    light = l,
                    onOpen = { onOpenLight(l.id) },
                    onToggle = { vm.setLightOn(l, it) },
                    onBrightness = { vm.setLightBrightness(l, it) },
                )
            }
        }
    }

    if (saveDialog && group != null) {
        TextInputDialog(title = "Save current state as scene", initial = "", onDismiss = { saveDialog = false }) {
            vm.saveScene(group, it); saveDialog = false
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun SceneChip(
    scene: SceneUi,
    onActivate: () -> Unit,
    onDynamic: () -> Unit,
    onRename: (String) -> Unit,
    onDelete: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    var rename by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    val active = scene.isActive
    val border = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outlineVariant
    Box {
        Column(
            Modifier
                .width(132.dp)
                .border(if (active) 2.dp else 1.dp, border, RoundedCornerShape(16.dp))
                .background(if (active) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.6f) else MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(16.dp))
                .combinedClickable(onClick = onActivate, onLongClick = { menu = true })
                .padding(12.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (scene.paletteHexes.isEmpty()) {
                    Box(Modifier.size(14.dp).background(MaterialTheme.colorScheme.outlineVariant, CircleShape))
                } else ColorDots(scene.paletteHexes, size = 14.dp, max = 5)
            }
            Spacer(Modifier.height(10.dp))
            Text(scene.name, style = MaterialTheme.typography.labelLarge, maxLines = 1, overflow = TextOverflow.Ellipsis, fontWeight = if (active) FontWeight.Bold else FontWeight.Medium)
            Text(
                when {
                    scene.isDynamic -> "Dynamic"
                    active -> "Active"
                    else -> "Tap · hold for more"
                },
                style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            DropdownMenuItem(text = { Text("Activate") }, onClick = { menu = false; onActivate() })
            DropdownMenuItem(text = { Text("Start dynamic") }, onClick = { menu = false; onDynamic() })
            DropdownMenuItem(text = { Text("Rename") }, onClick = { menu = false; rename = true })
            DropdownMenuItem(text = { Text("Delete") }, onClick = { menu = false; confirmDelete = true })
        }
    }
    if (rename) TextInputDialog(title = "Rename scene", initial = scene.name, onDismiss = { rename = false }) { onRename(it); rename = false }
    if (confirmDelete) ConfirmDialog("Delete scene", "Delete \"${scene.name}\"? This cannot be undone.", onDismiss = { confirmDelete = false }) { confirmDelete = false; onDelete() }
}

@Composable
fun LightRow(light: LightUi, onOpen: () -> Unit, onToggle: (Boolean) -> Unit, onBrightness: (Double) -> Unit, showRoom: Boolean = false) {
    Card(
        Modifier.padding(horizontal = 16.dp, vertical = 4.dp).fillMaxWidth().clickable(onClick = onOpen),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
    ) {
        Column(Modifier.padding(start = 12.dp, end = 8.dp, top = 8.dp, bottom = 2.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(36.dp).background(if (light.on) hexColor(light.swatchHex) else MaterialTheme.colorScheme.surfaceVariant, CircleShape)
                        .border(1.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.3f), CircleShape),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(lightArchetypeIcon(light.archetype), contentDescription = null, tint = if (light.on) androidx.compose.ui.graphics.Color.Black.copy(alpha = 0.55f) else MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(20.dp))
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text(light.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    val detail = buildString {
                        if (showRoom && light.roomName != null) append(light.roomName).append(" · ")
                        append(
                            when {
                                !light.on -> "Off"
                                light.isCtMode -> "${light.kelvin} K · ${light.brightness.roundToInt()}%"
                                light.activeEffect != null -> "${light.activeEffect.replaceFirstChar { it.uppercase() }} · ${light.brightness.roundToInt()}%"
                                else -> "${light.brightness.roundToInt()}%"
                            }
                        )
                        if (light.connectivity != null && light.connectivity != "connected") append(" · ${light.connectivity.replace('_', ' ')}")
                    }
                    Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                Switch(checked = light.on, onCheckedChange = onToggle)
                Icon(Icons.Outlined.ChevronRight, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (light.supportsDimming) {
                BrightnessSlider(value = light.brightness, enabled = true, showLabel = false, onCommit = onBrightness, modifier = Modifier.fillMaxWidth().height(34.dp))
            }
        }
    }
}

@Suppress("unused")
private fun kelvinLabel(mirek: Int) = "${ColorMath.mirekToKelvin(mirek)} K"
