package pt.prospero.huepilot.widget

import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceModifier
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.fillMaxHeight
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.padding
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import pt.prospero.huepilot.data.hue.GroupUi
import pt.prospero.huepilot.data.hue.SnapshotBuilder

/**
 * Rooms grid (2×1 … 4×4): one tile per room/zone with archetype icon, name and "3 of 4 on · 80 %".
 * Lit tiles are tinted with the room's light colour; tap toggles the room. Configure: rooms and order.
 */
class RoomsWidget : HueWidget(2 to 1, 3 to 1, 4 to 1, 2 to 2, 3 to 2, 4 to 2, 2 to 3, 3 to 3, 4 to 3, 4 to 4) {

    @Composable
    override fun Content(state: WidgetState, config: WidgetConfig) {
        val context = LocalContext.current
        val size = LocalSize.current
        WidgetFrame(state, onClick = openAppAction(context, "home"), padding = 8.dp) {
            val groups = WidgetLogic.chooseGroups(state.snapshot.groups, config.groupIds, state.favouriteRoomIds)
            val maxRows = WidgetLogic.gridRows(size.height.value)
            val (cols, rows) = WidgetLogic.gridFor(groups.size, WidgetLogic.gridColumns(size.width.value), maxRows)
            val shown = groups.take(cols * rows)
            val compact = maxRows == 1
            if (shown.isEmpty()) {
                WidgetMessage("No rooms yet")
            } else {
                Column(modifier = GlanceModifier.fillMaxSize()) {
                    shown.chunked(cols).forEachIndexed { r, line ->
                        Row(modifier = GlanceModifier.fillMaxWidth().defaultWeight().padding(top = if (r > 0) 6.dp else 0.dp)) {
                            for (i in 0 until cols) {
                                val g = line.getOrNull(i)
                                Box(modifier = GlanceModifier.defaultWeight().fillMaxHeight().padding(start = if (i > 0) 6.dp else 0.dp)) {
                                    if (g != null) RoomTile(g, compact, GlanceModifier.fillMaxSize())
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    /** One room tile; [compact] (single-row widgets) puts the icon beside the text instead of above it. */
    @Composable
    private fun RoomTile(g: GroupUi, compact: Boolean, modifier: GlanceModifier) {
        val tint = Color(WidgetLogic.tileTint(g.on, g.colorHexes.firstOrNull()))
        val subtitle = WidgetLogic.onLabel(g.lightsOn, g.lights.size) + if (g.on) " · ${SnapshotBuilder.percent(g.brightness)}%" else ""
        val iconTint = if (g.on) WidgetColors.Amber else WidgetColors.Muted
        val subtitleColor = if (g.on) WidgetColors.Text else WidgetColors.Muted
        val tile = modifier.roundedBackground(tint, 18.dp).clickable(widgetAction(WidgetActions.TOGGLE_GROUP, g.id))
        if (compact) {
            // Single-row widgets: no room for the icon, the tint and text carry the state.
            Column(modifier = tile.padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(g.name, style = textStyle(WidgetColors.Text, 11.sp, FontWeight.Bold), maxLines = 1)
                Text(subtitle, style = textStyle(subtitleColor, 9.sp), maxLines = 1)
            }
        } else {
            Column(modifier = tile.padding(horizontal = 8.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                WidgetIcon(archetypeIconRes(g.archetype), iconTint, 18.dp)
                VGap(3.dp)
                Text(g.name, style = textStyle(WidgetColors.Text, 11.sp, FontWeight.Bold), maxLines = 1)
                Text(subtitle, style = textStyle(subtitleColor, 10.sp), maxLines = 1)
            }
        }
    }
}

class RoomsWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = RoomsWidget()
}
