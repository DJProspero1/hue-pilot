package pt.prospero.huepilot.ui.lights

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Clear
import androidx.compose.material.icons.rounded.Lightbulb
import androidx.compose.material.icons.rounded.Search
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import pt.prospero.huepilot.ui.HueViewModel
import pt.prospero.huepilot.ui.components.EmptyState
import pt.prospero.huepilot.ui.components.ScreenHeader
import pt.prospero.huepilot.ui.room.LightRow

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun LightsScreen(vm: HueViewModel, onOpenLight: (String) -> Unit) {
    val snapshot by vm.snapshot.collectAsStateWithLifecycle()
    var query by rememberSaveable { mutableStateOf("") }
    val filtered = snapshot.lights.filter { l ->
        query.isBlank() || l.name.contains(query, ignoreCase = true) || (l.roomName?.contains(query, ignoreCase = true) == true)
    }
    val grouped = filtered.groupBy { it.roomName ?: "Not in a room" }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 110.dp)) {
        item {
            ScreenHeader("Lights", subtitle = if (snapshot.lights.isEmpty()) null else "${snapshot.lightsOn} of ${snapshot.lights.size} on")
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                placeholder = { Text("Search lights or rooms") },
                leadingIcon = { Icon(Icons.Rounded.Search, contentDescription = null) },
                trailingIcon = { if (query.isNotEmpty()) IconButton(onClick = { query = "" }) { Icon(Icons.Rounded.Clear, contentDescription = "Clear") } },
                singleLine = true,
                shape = CircleShape,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedContainerColor = MaterialTheme.colorScheme.surfaceContainer,
                    unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainer,
                    focusedBorderColor = MaterialTheme.colorScheme.primary.copy(alpha = 0.5f),
                    unfocusedBorderColor = Color.Transparent,
                ),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp),
            )
        }
        if (filtered.isEmpty()) {
            item {
                EmptyState(
                    if (snapshot.lights.isEmpty()) "No lights found" else "No matches",
                    if (snapshot.lights.isEmpty()) "Pull to refresh on the Home tab." else "Try another name.",
                    icon = Icons.Rounded.Lightbulb,
                )
            }
        }
        grouped.forEach { (room, lights) ->
            stickyHeader(key = "h-$room") {
                val group = snapshot.groups.firstOrNull { it.name == room }
                Row(
                    Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.background).padding(start = 20.dp, end = 12.dp, top = 12.dp, bottom = 2.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(room, style = MaterialTheme.typography.titleMedium)
                    Spacer(Modifier.width(8.dp))
                    Text("${lights.count { it.on }} of ${lights.size} on", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.weight(1f))
                    if (group != null) {
                        TextButton(onClick = { vm.setGroupOn(group, !group.on) }) { Text(if (group.on) "All off" else "All on") }
                    }
                }
            }
            items(lights, key = { it.id }) { l ->
                LightRow(light = l, onOpen = { onOpenLight(l.id) }, onToggle = { vm.setLightOn(l, it) }, onBrightness = { vm.setLightBrightness(l, it) })
            }
        }
    }
}
