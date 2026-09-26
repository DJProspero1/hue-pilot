package pt.prospero.huepilot.ui.room

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Add
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material.icons.rounded.Star
import androidx.compose.material.icons.rounded.StarBorder
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import pt.prospero.huepilot.data.hue.LightUi
import pt.prospero.huepilot.data.hue.SceneUi
import pt.prospero.huepilot.domain.ColorNames
import pt.prospero.huepilot.ui.HueViewModel
import pt.prospero.huepilot.ui.components.AmbientCard
import pt.prospero.huepilot.ui.components.CircleIconButton
import pt.prospero.huepilot.ui.components.ConfirmDialog
import pt.prospero.huepilot.ui.components.FillSlider
import pt.prospero.huepilot.ui.components.GlowIcon
import pt.prospero.huepilot.ui.components.HueSwitch
import pt.prospero.huepilot.ui.components.SceneArt
import pt.prospero.huepilot.ui.components.ScreenHeader
import pt.prospero.huepilot.ui.components.SectionTitle
import pt.prospero.huepilot.ui.components.SwatchRow
import pt.prospero.huepilot.ui.components.TextInputDialog
import pt.prospero.huepilot.ui.components.archetypeIcon
import pt.prospero.huepilot.ui.components.bleed
import pt.prospero.huepilot.ui.components.hexColor
import pt.prospero.huepilot.ui.components.lightArchetypeIcon
import pt.prospero.huepilot.ui.components.prettyName
import pt.prospero.huepilot.ui.theme.hueTokens
import kotlin.math.roundToInt

@Composable
fun RoomScreen(vm: HueViewModel, groupId: String, onBack: () -> Unit, onOpenLight: (String) -> Unit) {
    val snapshot by vm.snapshot.collectAsStateWithLifecycle()
    val settings by vm.settings.collectAsStateWithLifecycle()
    val group = snapshot.group(groupId)
    var saveDialog by remember { mutableStateOf(false) }

    if (group == null) {
        Column(Modifier.fillMaxSize()) {
            ScreenHeader("Room", onBack = onBack)
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { Text("This room no longer exists.") }
        }
        return
    }
    val scenes = snapshot.scenesFor(group.id)
    val tint = hexColor(group.colorHexes.firstOrNull() ?: "#ffd9a3")

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 40.dp)) {
        item {
            val fav = group.id in settings.favouriteRoomIds
            ScreenHeader(
                title = group.name,
                eyebrow = if (group.kind.rtype == "zone") "Zone" else "Room",
                subtitle = when {
                    group.lights.isEmpty() -> "No lights"
                    group.on -> "${group.lightsOn} of ${group.lights.size} lights on"
                    else -> "${group.lights.size} lights · off"
                },
                onBack = onBack,
                actions = {
                    CircleIconButton(if (fav) Icons.Rounded.Star else Icons.Rounded.StarBorder, "Favourite", onClick = { vm.toggleFavouriteRoom(group.id) }, tint = if (fav) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)
                },
            )
        }

        item {
            AmbientCard(hexes = group.colorHexes, on = group.on, modifier = Modifier.padding(horizontal = 20.dp), contentPadding = 18.dp) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    GlowIcon(archetypeIcon(group.archetype), color = tint, on = group.on, size = 54.dp, iconSize = 27.dp)
                    Spacer(Modifier.width(14.dp))
                    Column(Modifier.weight(1f)) {
                        Text(if (group.on) "On" else "Off", style = MaterialTheme.typography.headlineSmall)
                        Text(if (group.on) "${group.brightness.roundToInt()}% brightness" else "Tap the switch or a scene", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    HueSwitch(checked = group.on, onCheckedChange = { vm.setGroupOn(group, it) }, enabled = group.lights.isNotEmpty())
                }
                Spacer(Modifier.height(18.dp))
                FillSlider(value = group.brightness, tint = tint, height = 48.dp, enabled = group.lights.isNotEmpty(), onCommit = { vm.setGroupBrightness(group, it) })
                if (group.lights.any { it.supportsColor || it.supportsCt }) {
                    Spacer(Modifier.height(16.dp))
                    Text("Quick colours", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Spacer(Modifier.height(8.dp))
                    SwatchRow(
                        ColorNames.QUICK_PALETTE, size = 34.dp, showLabels = false, contentPadding = 18.dp,
                        modifier = Modifier.bleed(18.dp).horizontalScroll(rememberScrollState()),
                    ) { label, hex ->
                        val parsed = ColorNames.parseColor(label.lowercase()) ?: ColorNames.parseColor(hex)
                        if (parsed != null) vm.setGroupColor(group, parsed.xy, parsed.mirek)
                    }
                }
            }
        }

        item {
            SectionTitle("Scenes", count = scenes.size, modifier = Modifier.padding(top = 12.dp)) {
                TextButton(onClick = { saveDialog = true }, enabled = group.lights.isNotEmpty()) {
                    Icon(Icons.Rounded.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Save current")
                }
            }
            if (scenes.isEmpty()) {
                Text(
                    "No scenes yet. Set the lights the way you like them and tap \"Save current\".",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
                )
            } else {
                LazyRow(contentPadding = PaddingValues(horizontal = 20.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    items(scenes, key = { it.id }) { s ->
                        SceneTile(
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

        item { SectionTitle("Lights", count = group.lights.size, modifier = Modifier.padding(top = 14.dp)) }
        items(group.lights, key = { it.id }) { l ->
            LightRow(light = l, onOpen = { onOpenLight(l.id) }, onToggle = { vm.setLightOn(l, it) }, onBrightness = { vm.setLightBrightness(l, it) })
        }
    }

    if (saveDialog) {
        TextInputDialog(title = "Save the current look as a scene", initial = "", onDismiss = { saveDialog = false }) {
            vm.saveScene(group, it); saveDialog = false
        }
    }
}

/** Scene tile with the palette as artwork. Tap activates, long-press opens the menu. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun SceneTile(
    scene: SceneUi,
    modifier: Modifier = Modifier,
    /** Fixed width, or null to fill the available width (grids). */
    width: androidx.compose.ui.unit.Dp? = 150.dp,
    height: androidx.compose.ui.unit.Dp = 104.dp,
    showRoom: Boolean = false,
    onActivate: () -> Unit,
    onDynamic: () -> Unit,
    onRename: (String) -> Unit,
    onDelete: () -> Unit,
) {
    var menu by remember { mutableStateOf(false) }
    var rename by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    val active = scene.isActive
    Box(modifier) {
        SceneArt(
            scene.paletteHexes,
            modifier = Modifier
                .then(if (width != null) Modifier.width(width) else Modifier.fillMaxWidth())
                .height(height)
                .clip(androidx.compose.foundation.shape.RoundedCornerShape(hueTokens.tileRadius))
                .combinedClickable(onClick = onActivate, onLongClick = { menu = true }),
        ) {
            Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.62f)), startY = 40f)))
            Column(Modifier.align(Alignment.BottomStart).padding(12.dp)) {
                Text(scene.name, style = MaterialTheme.typography.titleSmall, color = Color.White, maxLines = 2, overflow = TextOverflow.Ellipsis)
                val sub = when {
                    scene.isDynamic -> "Dynamic · playing"
                    active -> "Active"
                    showRoom -> scene.groupName
                    else -> null
                }
                if (sub != null) Text(sub, style = MaterialTheme.typography.labelSmall, color = Color.White.copy(alpha = 0.8f), maxLines = 1)
            }
            if (active) {
                Box(Modifier.align(Alignment.TopEnd).padding(8.dp).size(22.dp).background(Color.White, CircleShape), contentAlignment = Alignment.Center) {
                    Icon(Icons.Rounded.Check, contentDescription = "Active", tint = Color.Black, modifier = Modifier.size(14.dp))
                }
            }
        }
        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            DropdownMenuItem(text = { Text("Activate") }, onClick = { menu = false; onActivate() })
            DropdownMenuItem(text = { Text("Play dynamic") }, onClick = { menu = false; onDynamic() })
            DropdownMenuItem(text = { Text("Rename") }, onClick = { menu = false; rename = true })
            DropdownMenuItem(text = { Text("Delete") }, onClick = { menu = false; confirmDelete = true })
        }
    }
    if (rename) TextInputDialog(title = "Rename scene", initial = scene.name, onDismiss = { rename = false }) { onRename(it); rename = false }
    if (confirmDelete) ConfirmDialog("Delete scene", "Delete \"${scene.name}\"? This cannot be undone.", onDismiss = { confirmDelete = false }) { confirmDelete = false; onDelete() }
}

/** One light: colour-lit icon, name, state, switch and (when on) a colour-filled brightness bar. */
@Composable
fun LightRow(light: LightUi, onOpen: () -> Unit, onToggle: (Boolean) -> Unit, onBrightness: (Double) -> Unit, showRoom: Boolean = false, modifier: Modifier = Modifier) {
    val tint = hexColor(light.swatchHex)
    AmbientCard(
        hexes = listOf(light.swatchHex), on = light.on, onClick = onOpen,
        modifier = modifier.padding(horizontal = 20.dp, vertical = 5.dp), contentPadding = 14.dp,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            GlowIcon(lightArchetypeIcon(light.archetype), color = tint, on = light.on, size = 42.dp, iconSize = 21.dp)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(light.name, style = MaterialTheme.typography.titleSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                val detail = buildString {
                    if (showRoom && light.roomName != null) append(light.roomName).append(" · ")
                    append(
                        when {
                            !light.on -> "Off"
                            light.activeEffect != null -> "${prettyName(light.activeEffect)} effect · ${light.brightness.roundToInt()}%"
                            light.isCtMode -> "${light.kelvin} K · ${light.brightness.roundToInt()}%"
                            light.supportsColor -> "Colour · ${light.brightness.roundToInt()}%"
                            else -> "${light.brightness.roundToInt()}%"
                        },
                    )
                    if (light.connectivity != null && light.connectivity != "connected") append(" · ${prettyName(light.connectivity)}")
                }
                Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            HueSwitch(checked = light.on, onCheckedChange = onToggle)
        }
        AnimatedVisibility(visible = light.on && light.supportsDimming, enter = fadeIn() + expandVertically(), exit = fadeOut() + shrinkVertically()) {
            Column {
                Spacer(Modifier.height(10.dp))
                FillSlider(value = light.brightness, tint = tint, height = 30.dp, showLabel = false, onCommit = onBrightness)
            }
        }
    }
}
