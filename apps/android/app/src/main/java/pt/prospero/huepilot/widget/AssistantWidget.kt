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
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextAlign
import pt.prospero.huepilot.R

/**
 * Ask Hue Pilot (1×1, 2×1): microphone tile that opens the Assistant tab listening. The 2×1 variant adds
 * "All off" and "Good night" quick commands (plain bridge actions, no LLM).
 */
class AssistantWidget : HueWidget(1 to 1, 2 to 1, 3 to 1) {

    @Composable
    override fun Content(state: WidgetState, config: WidgetConfig) {
        val context = LocalContext.current
        val size = LocalSize.current
        val wide = WidgetLogic.cellsWide(size.width.value) >= 2
        val listen = openAppAction(context, "assistant", listen = true)
        Box(modifier = GlanceModifier.fillMaxSize().widgetBackground().clickable(listen).padding(6.dp), contentAlignment = Alignment.Center) {
            if (!wide) {
                Box(modifier = GlanceModifier.size(40.dp).roundedBackground(WidgetColors.Amber, 999.dp).clickable(listen), contentAlignment = Alignment.Center) {
                    WidgetIcon(R.drawable.wg_ic_mic, WidgetColors.OnAmber, 22.dp, "Ask Hue Pilot")
                }
            } else {
                // 2×1: mic tile + two icon quick commands; from 3 cells wide there is room for a title too.
                val roomy = WidgetLogic.cellsWide(size.width.value) >= 3
                Row(modifier = GlanceModifier.fillMaxSize().padding(horizontal = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                    Box(modifier = GlanceModifier.size(42.dp).roundedBackground(WidgetColors.Amber, 999.dp).clickable(listen), contentAlignment = Alignment.Center) {
                        WidgetIcon(R.drawable.wg_ic_mic, WidgetColors.OnAmber, 22.dp, "Ask Hue Pilot")
                    }
                    if (roomy) {
                        Text("Ask Hue Pilot", modifier = GlanceModifier.defaultWeight().padding(start = 8.dp), style = textStyle(WidgetColors.Text, 12.sp, FontWeight.Bold), maxLines = 2)
                    }
                    QuickCommand(R.drawable.wg_ic_power, "All off", widgetAction(WidgetActions.ALL_LIGHTS, arg = "false"), GlanceModifier.defaultWeight().padding(start = 6.dp))
                    QuickCommand(R.drawable.wg_ic_moon, "Good night", widgetAction(WidgetActions.ALL_LIGHTS, arg = "false"), GlanceModifier.defaultWeight().padding(start = 2.dp))
                }
            }
        }
    }

    /** Icon button with a tiny label underneath (plain bridge action, no assistant involved). */
    @Composable
    private fun QuickCommand(icon: Int, label: String, action: androidx.glance.action.Action, modifier: GlanceModifier) {
        Column(modifier = modifier.clickable(action), horizontalAlignment = Alignment.CenterHorizontally) {
            Box(modifier = GlanceModifier.size(28.dp).roundedBackground(WidgetColors.TileHigh, 999.dp), contentAlignment = Alignment.Center) {
                WidgetIcon(icon, WidgetColors.Text, 15.dp, label)
            }
            Text(label, style = textStyle(WidgetColors.Muted, 8.sp, align = TextAlign.Center), maxLines = 1)
        }
    }
}

class AssistantWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = AssistantWidget()
}
