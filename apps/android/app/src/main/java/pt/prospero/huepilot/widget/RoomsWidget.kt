package pt.prospero.huepilot.widget

import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.action.actionStartActivity
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.RowScope
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import pt.prospero.huepilot.MainActivity
import pt.prospero.huepilot.appContainer
import pt.prospero.huepilot.data.hue.HueClient
import pt.prospero.huepilot.data.hue.SnapshotBuilder

/** Room shown in the widget. */
private data class WidgetRoom(val id: String, val name: String, val on: Boolean, val groupedLightId: String?)

/** Home-screen widget: on/off toggles for up to four favourite rooms (star a room in the app). */
class RoomsWidget : GlanceAppWidget() {

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val rooms = loadRooms(context)
        provideContent { GlanceTheme { WidgetContent(rooms) } }
    }

    private suspend fun loadRooms(context: Context): List<WidgetRoom>? {
        val container = context.appContainer
        val settings = withTimeoutOrNull(3000) { container.settings.settings.first() } ?: return null
        val bridge = settings.bridge?.takeIf { it.isPaired } ?: return null
        var snap = container.repository.snapshot.value
        if (snap.isEmpty) {
            // App not running: fetch what we need directly.
            val client = HueClient(bridge)
            val all = runCatching { client.getAllResources() }.getOrNull() ?: return emptyList()
            snap = SnapshotBuilder.build(all.associateBy { it["id"]?.jsonPrimitive?.content ?: "" })
        }
        val favs = settings.favouriteRoomIds
        val chosen = if (favs.isEmpty()) snap.rooms.take(4) else snap.groups.filter { it.id in favs }.take(4)
        return chosen.map { WidgetRoom(it.id, it.name, it.on, it.groupedLightId) }
    }

    @Composable
    private fun WidgetContent(rooms: List<WidgetRoom>?) {
        Column(
            modifier = GlanceModifier.fillMaxSize().background(GlanceTheme.colors.widgetBackground).cornerRadius(20.dp).padding(10.dp)
                .clickable(actionStartActivity<MainActivity>()),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            when {
                rooms == null -> Text("Open Hue Pilot to pair a bridge", style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 13.sp))
                rooms.isEmpty() -> Text("No rooms available", style = TextStyle(color = GlanceTheme.colors.onSurface, fontSize = 13.sp))
                else -> {
                    val chunks = rooms.chunked(2)
                    chunks.forEachIndexed { idx, pair ->
                        Row(modifier = GlanceModifier.fillMaxWidth()) {
                            pair.forEachIndexed { i, r ->
                                if (i > 0) Spacer(GlanceModifier.width(8.dp))
                                RoomTile(r)
                            }
                        }
                        if (idx < chunks.size - 1) Spacer(GlanceModifier.height(8.dp))
                    }
                }
            }
        }
    }

    @Composable
    private fun RowScope.RoomTile(r: WidgetRoom) {
        val bg = if (r.on) ColorProvider(Color(0xFFF2A65A)) else GlanceTheme.colors.secondaryContainer
        val fg = if (r.on) ColorProvider(Color(0xFF2B1A0A)) else GlanceTheme.colors.onSecondaryContainer
        Column(
            modifier = GlanceModifier
                .defaultWeight()
                .background(bg)
                .cornerRadius(14.dp)
                .padding(horizontal = 10.dp, vertical = 8.dp)
                .clickable(actionRunCallback<ToggleRoomAction>(actionParametersOf(ToggleRoomAction.ROOM_ID to r.id, ToggleRoomAction.GROUPED_LIGHT to (r.groupedLightId ?: ""), ToggleRoomAction.ON to r.on))),
        ) {
            Text(r.name, style = TextStyle(color = fg, fontSize = 13.sp, fontWeight = FontWeight.Bold), maxLines = 1)
            Text(if (r.on) "On · tap to turn off" else "Off · tap to turn on", style = TextStyle(color = fg, fontSize = 11.sp), maxLines = 1)
        }
    }
}

class ToggleRoomAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val glId = parameters[GROUPED_LIGHT].orEmpty()
        val on = parameters[ON] ?: false
        val container = context.appContainer
        val bridge = container.settings.settings.first().bridge?.takeIf { it.isPaired } ?: return
        if (glId.isNotEmpty()) {
            val client = container.repository.client.value ?: HueClient(bridge)
            runCatching { client.put("grouped_light", glId, buildJsonObject { putJsonObject("on") { put("on", !on) } }) }
            container.repository.applyLocalPatch(glId, buildJsonObject { putJsonObject("on") { put("on", !on) } })
        }
        RoomsWidget().update(context, glanceId)
    }

    companion object {
        val ROOM_ID = ActionParameters.Key<String>("room_id")
        val GROUPED_LIGHT = ActionParameters.Key<String>("grouped_light")
        val ON = ActionParameters.Key<Boolean>("on")
    }
}

class RoomsWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = RoomsWidget()
}
