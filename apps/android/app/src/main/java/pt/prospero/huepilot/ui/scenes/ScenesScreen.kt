package pt.prospero.huepilot.ui.scenes

import androidx.compose.animation.animateColorAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Palette
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import pt.prospero.huepilot.ui.HueViewModel
import pt.prospero.huepilot.ui.components.EmptyState
import pt.prospero.huepilot.ui.components.ScreenHeader
import pt.prospero.huepilot.ui.components.SectionTitle
import pt.prospero.huepilot.ui.components.pluralize
import pt.prospero.huepilot.ui.room.SceneTile

@Composable
fun ScenesScreen(vm: HueViewModel) {
    val snapshot by vm.snapshot.collectAsStateWithLifecycle()
    var filter by rememberSaveable { mutableStateOf<String?>(null) }
    val groupsWithScenes = snapshot.groups.filter { g -> snapshot.scenes.any { it.groupId == g.id } }
    if (filter != null && groupsWithScenes.none { it.id == filter }) filter = null
    val shown = if (filter == null) snapshot.scenes else snapshot.scenes.filter { it.groupId == filter }

    LazyVerticalGrid(
        columns = GridCells.Fixed(2),
        contentPadding = PaddingValues(start = 20.dp, end = 20.dp, bottom = 110.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
        modifier = Modifier.fillMaxSize(),
    ) {
        item(span = { GridItemSpan(maxLineSpan) }) {
            ScreenHeader(
                "Scenes",
                subtitle = if (snapshot.scenes.isEmpty()) null else "${pluralize(snapshot.scenes.size, "scene")} in ${pluralize(groupsWithScenes.size, "room")}",
                horizontalPadding = 0.dp,
            )
        }
        if (snapshot.scenes.isEmpty()) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                EmptyState("No scenes", "Create scenes from a room screen with \"Save current\".", icon = Icons.Rounded.Palette)
            }
            return@LazyVerticalGrid
        }
        item(span = { GridItemSpan(maxLineSpan) }) {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp), contentPadding = PaddingValues(bottom = 6.dp)) {
                item { FilterPill("All", filter == null) { filter = null } }
                items(groupsWithScenes, key = { it.id }) { g -> FilterPill(g.name, filter == g.id) { filter = g.id } }
            }
        }
        if (filter == null) {
            groupsWithScenes.forEach { g ->
                val scenes = snapshot.scenesFor(g.id)
                item(span = { GridItemSpan(maxLineSpan) }, key = "h-${g.id}") { SectionTitle(g.name, count = scenes.size, horizontalPadding = 4.dp, modifier = Modifier.padding(vertical = 2.dp)) }
                items(scenes, key = { it.id }) { s -> SceneGridTile(vm, s) }
            }
        } else {
            items(shown, key = { it.id }) { s -> SceneGridTile(vm, s) }
        }
    }
}

@Composable
private fun SceneGridTile(vm: HueViewModel, s: pt.prospero.huepilot.data.hue.SceneUi) {
    SceneTile(
        scene = s,
        width = null,
        height = 112.dp,
        onActivate = { vm.recallScene(s.id, false) },
        onDynamic = { vm.recallScene(s.id, true) },
        onRename = { vm.renameScene(s.id, it) },
        onDelete = { vm.deleteScene(s.id) },
    )
}

@Composable
private fun FilterPill(label: String, selected: Boolean, onClick: () -> Unit) {
    val bg by animateColorAsState(if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainer, label = "pill")
    Box(
        Modifier
            .clip(CircleShape)
            .background(bg)
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
    ) {
        Text(label, style = MaterialTheme.typography.labelLarge, color = if (selected) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant)
    }
}
