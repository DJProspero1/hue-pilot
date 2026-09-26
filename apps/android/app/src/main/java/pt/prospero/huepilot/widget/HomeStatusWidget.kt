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
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.fillMaxHeight
import androidx.glance.layout.fillMaxSize
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import pt.prospero.huepilot.R

/**
 * Home status (2×1 … 4×1): "6 of 11 lights on", colour dots of the lit rooms and All off / All on
 * buttons (bridge_home grouped light). Tapping the text opens the app.
 */
class HomeStatusWidget : HueWidget(2 to 1, 3 to 1, 4 to 1, 5 to 1) {

    @Composable
    override fun Content(state: WidgetState, config: WidgetConfig) {
        val context = LocalContext.current
        val size = LocalSize.current
        val wide = WidgetLogic.cellsWide(size.width.value) >= 3
        WidgetFrame(state, onClick = openAppAction(context, "home"), padding = 10.dp) {
            val snap = state.snapshot
            val on = snap.lightsOn
            val total = snap.lights.size
            val dots = WidgetLogic.litRoomColors(snap.groups)
            Row(modifier = GlanceModifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
                Column(modifier = GlanceModifier.defaultWeight().fillMaxHeight().clickable(openAppAction(context, "home")), verticalAlignment = Alignment.CenterVertically) {
                    if (wide) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            WidgetIcon(R.drawable.wg_ic_lightbulb, if (on > 0) WidgetColors.Amber else WidgetColors.Muted, 16.dp)
                            HGap(6.dp)
                            Text(if (on == 0) "All lights off" else "$on of $total lights on", style = textStyle(WidgetColors.Text, 13.sp, FontWeight.Bold), maxLines = 1)
                        }
                    } else {
                        Text(if (on == 0) "All off" else "$on of $total", style = textStyle(WidgetColors.Text, 14.sp, FontWeight.Bold), maxLines = 1)
                        Text(if (on == 0) "lights" else "lights on", style = textStyle(WidgetColors.Muted, 10.sp), maxLines = 1)
                    }
                    if (dots.isNotEmpty()) {
                        VGap(4.dp)
                        ColorDots(dots)
                    }
                }
                HGap(6.dp)
                if (wide) {
                    PillButton("All off", widgetAction(WidgetActions.ALL_LIGHTS, arg = "false"), size = 11.sp)
                    HGap(6.dp)
                    PillButton("All on", widgetAction(WidgetActions.ALL_LIGHTS, arg = "true"), filled = true, size = 11.sp)
                } else {
                    Column(horizontalAlignment = Alignment.End) {
                        PillButton("Off", widgetAction(WidgetActions.ALL_LIGHTS, arg = "false"), size = 11.sp)
                        VGap(4.dp)
                        PillButton("On", widgetAction(WidgetActions.ALL_LIGHTS, arg = "true"), filled = true, size = 11.sp)
                    }
                }
            }
        }
    }
}

class HomeStatusWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = HomeStatusWidget()
}
