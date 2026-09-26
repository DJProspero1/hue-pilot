package pt.prospero.huepilot.widget

import androidx.compose.runtime.Composable
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
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import pt.prospero.huepilot.R
import pt.prospero.huepilot.data.hue.GroupUi
import pt.prospero.huepilot.data.hue.SceneUi
import pt.prospero.huepilot.data.hue.SnapshotBuilder

/**
 * Room control (4×2, 4×3): header with icon/name/state, On/Off, brightness −/+ with 25/50/75/100 presets,
 * six quick colours and the room's scenes as chips. Configure: the room.
 */
class RoomControlWidget : HueWidget(3 to 2, 4 to 2, 3 to 3, 4 to 3, 4 to 4) {

    @Composable
    override fun Content(state: WidgetState, config: WidgetConfig) {
        val context = LocalContext.current
        val size = LocalSize.current
        val group = config.groupId?.let { state.snapshot.group(it) } ?: WidgetLogic.defaultGroup(state.snapshot.groups, state.favouriteRoomIds)
        WidgetFrame(state, onClick = group?.let { openAppAction(context, "room/${it.id}") }, padding = 8.dp) {
            if (group == null) {
                WidgetMessage("Choose a room in the widget settings")
            } else {
                val tall = WidgetLogic.cellsTall(size.height.value) >= 3
                val wide = WidgetLogic.cellsWide(size.width.value) >= 4
                RoomControls(group, state.snapshot.scenesFor(group.id), tall = tall, wide = wide)
            }
        }
    }

    @Composable
    private fun RoomControls(g: GroupUi, scenes: List<SceneUi>, tall: Boolean, wide: Boolean) {
        val pct = SnapshotBuilder.percent(g.brightness)
        val subtitle = WidgetLogic.onLabel(g.lightsOn, g.lights.size) + if (g.on) " · $pct%" else ""
        Column(modifier = GlanceModifier.fillMaxSize()) {
            WidgetHeader(archetypeIconRes(g.archetype), g.name, subtitle, iconTint = if (g.on) WidgetColors.Amber else WidgetColors.Muted) {
                PillButton(if (g.on) "Off" else "On", widgetAction(WidgetActions.GROUP_ON, g.id, (!g.on).toString()), filled = !g.on)
            }
            // Sections are spaced with padding rather than Spacers: a Glance Column holds at most 10 children.
            if (tall) {
                Box(modifier = GlanceModifier.fillMaxWidth().padding(top = 6.dp)) {
                    Box(
                        modifier = GlanceModifier.fillMaxWidth().height(44.dp)
                            .roundedBackground(if (g.on) WidgetColors.Amber else WidgetColors.TileHigh, 14.dp)
                            .clickable(widgetAction(WidgetActions.TOGGLE_GROUP, g.id)),
                        contentAlignment = Alignment.Center,
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            WidgetIcon(R.drawable.wg_ic_power, if (g.on) WidgetColors.OnAmber else WidgetColors.Text, 18.dp)
                            HGap(8.dp)
                            Text(
                                if (g.on) "On · tap to turn off" else "Off · tap to turn on",
                                style = textStyle(if (g.on) WidgetColors.OnAmber else WidgetColors.Text, 13.sp, FontWeight.Bold),
                                maxLines = 1,
                            )
                        }
                    }
                }
            }
            // Brightness: − [25] [50] [75] [100] +
            Row(modifier = GlanceModifier.fillMaxWidth().padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(R.drawable.wg_ic_remove, widgetAction(WidgetActions.GROUP_BRIGHTNESS_DELTA, g.id, "-10"), "Dimmer", size = 28.dp, iconSize = 16.dp)
                for (p in listOf(25, 50, 75, 100)) {
                    // Gaps are padding on wrapper boxes: a Glance Row holds at most 10 children.
                    Box(modifier = GlanceModifier.defaultWeight().padding(start = 4.dp)) {
                        PillButton("$p", widgetAction(WidgetActions.GROUP_BRIGHTNESS, g.id, "$p"), modifier = GlanceModifier.fillMaxWidth(), filled = g.on && pct == p, size = 11.sp)
                    }
                }
                Box(modifier = GlanceModifier.padding(start = 4.dp)) {
                    IconButton(R.drawable.wg_ic_add, widgetAction(WidgetActions.GROUP_BRIGHTNESS_DELTA, g.id, "10"), "Brighter", size = 28.dp, iconSize = 16.dp)
                }
            }
            // Quick colours
            Row(modifier = GlanceModifier.fillMaxWidth().padding(top = 6.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalAlignment = Alignment.CenterVertically) {
                WidgetLogic.quickColors(WidgetLogic.QUICK_6).forEachIndexed { i, (label, hex) ->
                    Box(modifier = GlanceModifier.padding(start = if (i == 0) 0.dp else if (wide) 10.dp else 6.dp)) {
                        Swatch(hex, widgetAction(WidgetActions.GROUP_COLOR, g.id, hex, label), size = 24.dp)
                    }
                }
            }
            if (scenes.isNotEmpty()) {
                // Three chips per row keep scene names readable at 4 cells; the tall variant shows a second row.
                val perRow = if (WidgetLogic.cellsWide(LocalSize.current.width.value) >= 5) 4 else 3
                SceneChips(scenes.take(perRow), top = 6.dp)
                if (tall && scenes.size > perRow) SceneChips(scenes.drop(perRow).take(perRow), top = 4.dp)
            }
        }
    }

    @Composable
    private fun SceneChips(scenes: List<SceneUi>, top: androidx.compose.ui.unit.Dp) {
        Row(modifier = GlanceModifier.fillMaxWidth().padding(top = top)) {
            scenes.forEachIndexed { i, s ->
                Box(modifier = GlanceModifier.defaultWeight().padding(start = if (i > 0) 4.dp else 0.dp)) {
                    PillButton(s.name, widgetAction(WidgetActions.SCENE, s.id), modifier = GlanceModifier.fillMaxWidth(), filled = s.isActive, size = 10.sp)
                }
            }
        }
    }
}

class RoomControlWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = RoomControlWidget()
}
