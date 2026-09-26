package pt.prospero.huepilot.widget

import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceModifier
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.fillMaxHeight
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text

/**
 * Colour strip (4×1): the room name on the left and eight quick-colour swatches; tap sets the room colour.
 * Configure: the room.
 */
class ColorStripWidget : HueWidget(3 to 1, 4 to 1, 5 to 1) {

    @Composable
    override fun Content(state: WidgetState, config: WidgetConfig) {
        val context = LocalContext.current
        val size = LocalSize.current
        val group = config.groupId?.let { state.snapshot.group(it) } ?: WidgetLogic.defaultGroup(state.snapshot.groups, state.favouriteRoomIds)
        WidgetFrame(state, onClick = group?.let { openAppAction(context, "room/${it.id}") }, padding = 8.dp) {
            if (group == null) {
                WidgetMessage("Choose a room in the widget settings")
            } else {
                val cells = WidgetLogic.cellsWide(size.width.value)
                val swatches = WidgetLogic.quickColors(if (cells >= 4) WidgetLogic.QUICK_8 else WidgetLogic.QUICK_6)
                val swatch = if (cells >= 5) 30.dp else 26.dp
                Row(modifier = GlanceModifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
                    Column(modifier = GlanceModifier.width(if (cells >= 4) 72.dp else 58.dp), verticalAlignment = Alignment.CenterVertically) {
                        WidgetIcon(archetypeIconRes(group.archetype), if (group.on) WidgetColors.Amber else WidgetColors.Muted, 16.dp)
                        VGap(2.dp)
                        Text(group.name, style = textStyle(WidgetColors.Text, 11.sp, FontWeight.Bold), maxLines = 1)
                        Text(if (group.on) "On" else "Off", style = textStyle(WidgetColors.Muted, 9.sp), maxLines = 1)
                    }
                    Row(modifier = GlanceModifier.defaultWeight().fillMaxHeight(), verticalAlignment = Alignment.CenterVertically) {
                        swatches.forEach { (label, hex) ->
                            Box(modifier = GlanceModifier.defaultWeight().fillMaxHeight(), contentAlignment = Alignment.Center) {
                                Swatch(hex, widgetAction(WidgetActions.GROUP_COLOR, group.id, hex, label), size = swatch)
                            }
                        }
                    }
                }
            }
        }
    }
}

class ColorStripWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = ColorStripWidget()
}
