package pt.prospero.huepilot.ui.scenes

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import pt.prospero.huepilot.data.hue.SceneUi
import pt.prospero.huepilot.ui.HueViewModel
import pt.prospero.huepilot.ui.components.ColorDots
import pt.prospero.huepilot.ui.components.ConfirmDialog
import pt.prospero.huepilot.ui.components.EmptyState
import pt.prospero.huepilot.ui.components.TextInputDialog
import pt.prospero.huepilot.ui.components.archetypeIcon

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ScenesScreen(vm: HueViewModel) {
    val snapshot by vm.snapshot.collectAsStateWithLifecycle()
    val grouped = snapshot.scenes.groupBy { it.groupId }

    Scaffold(topBar = { TopAppBar(title = { Text("Scenes") }) }) { padding ->
        if (snapshot.scenes.isEmpty()) {
            EmptyState("No scenes", "Create scenes from a room screen with \"Save current\".", Modifier.padding(padding))
            return@Scaffold
        }
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(bottom = 96.dp)) {
            snapshot.groups.forEach { g ->
                val scenes = grouped[g.id] ?: return@forEach
                item(key = "h-${g.id}") {
                    Row(Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(archetypeIcon(g.archetype), contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.width(8.dp))
                        Text(g.name, style = MaterialTheme.typography.titleMedium)
                    }
                }
                items(scenes, key = { it.id }) { s ->
                    SceneRow(
                        s,
                        onActivate = { vm.recallScene(s.id, false) },
                        onDynamic = { vm.recallScene(s.id, true) },
                        onRename = { vm.renameScene(s.id, it) },
                        onDelete = { vm.deleteScene(s.id) },
                    )
                }
            }
        }
    }
}

@Composable
private fun SceneRow(s: SceneUi, onActivate: () -> Unit, onDynamic: () -> Unit, onRename: (String) -> Unit, onDelete: () -> Unit) {
    var menu by remember { mutableStateOf(false) }
    var rename by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    Card(
        Modifier.padding(horizontal = 16.dp, vertical = 4.dp).fillMaxWidth().clickable(onClick = onActivate),
        colors = CardDefaults.cardColors(containerColor = if (s.isActive) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.6f) else MaterialTheme.colorScheme.surfaceContainer),
    ) {
        Row(Modifier.padding(start = 16.dp, end = 4.dp, top = 10.dp, bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(s.name, style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(4.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    ColorDots(s.paletteHexes, size = 12.dp)
                    if (s.paletteHexes.isNotEmpty()) Spacer(Modifier.width(8.dp))
                    Text(
                        when { s.isDynamic -> "Dynamic · active"; s.isActive -> "Active"; else -> "" },
                        style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary,
                    )
                }
            }
            FilledTonalIconButton(onClick = onActivate) { Icon(Icons.Outlined.PlayArrow, contentDescription = "Activate") }
            IconButton(onClick = onDynamic) { Icon(Icons.Outlined.AutoAwesome, contentDescription = "Start dynamic") }
            IconButton(onClick = { menu = true }) { Icon(Icons.Outlined.MoreVert, contentDescription = "More") }
            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                DropdownMenuItem(text = { Text("Rename") }, onClick = { menu = false; rename = true })
                DropdownMenuItem(text = { Text("Delete") }, onClick = { menu = false; confirmDelete = true })
            }
        }
    }
    if (rename) TextInputDialog("Rename scene", s.name, onDismiss = { rename = false }) { onRename(it); rename = false }
    if (confirmDelete) ConfirmDialog("Delete scene", "Delete \"${s.name}\"?", onDismiss = { confirmDelete = false }) { confirmDelete = false; onDelete() }
}
