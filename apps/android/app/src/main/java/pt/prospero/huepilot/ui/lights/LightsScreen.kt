package pt.prospero.huepilot.ui.lights

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Clear
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import pt.prospero.huepilot.ui.HueViewModel
import pt.prospero.huepilot.ui.components.EmptyState
import pt.prospero.huepilot.ui.room.LightRow

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun LightsScreen(vm: HueViewModel, onOpenLight: (String) -> Unit) {
    val snapshot by vm.snapshot.collectAsStateWithLifecycle()
    var query by rememberSaveable { mutableStateOf("") }
    val filtered = snapshot.lights.filter { l ->
        query.isBlank() || l.name.contains(query, ignoreCase = true) || (l.roomName?.contains(query, ignoreCase = true) == true)
    }
    val grouped = filtered.groupBy { it.roomName ?: "No room" }

    Scaffold(topBar = { TopAppBar(title = { Text("Lights") }) }) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(bottom = 96.dp)) {
            item {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    placeholder = { Text("Search lights or rooms") },
                    leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                    trailingIcon = { if (query.isNotEmpty()) IconButton(onClick = { query = "" }) { Icon(Icons.Outlined.Clear, contentDescription = "Clear") } },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                )
            }
            if (filtered.isEmpty()) {
                item { EmptyState(if (snapshot.lights.isEmpty()) "No lights found" else "No matches", if (snapshot.lights.isEmpty()) "Pull to refresh on the Home tab." else null) }
            }
            grouped.forEach { (room, lights) ->
                stickyHeader {
                    Text(
                        "$room · ${lights.count { it.on }} of ${lights.size} on",
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface).padding(horizontal = 16.dp, vertical = 8.dp),
                    )
                }
                items(lights, key = { it.id }) { l ->
                    LightRow(light = l, onOpen = { onOpenLight(l.id) }, onToggle = { vm.setLightOn(l, it) }, onBrightness = { vm.setLightBrightness(l, it) })
                }
            }
        }
    }
}
