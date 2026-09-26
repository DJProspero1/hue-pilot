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
import androidx.glance.layout.fillMaxHeight
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextAlign
import pt.prospero.huepilot.R
import pt.prospero.huepilot.data.hue.LightUi
import pt.prospero.huepilot.data.hue.SnapshotBuilder

/**
 * Light control (2×2, 4×2): one light with on/off, brightness −/+ and quick colours (only when the light
 * supports colour or colour temperature). Configure: the light.
 */
class LightControlWidget : HueWidget(2 to 2, 3 to 2, 4 to 2) {

    @Composable
    override fun Content(state: WidgetState, config: WidgetConfig) {
        val context = LocalContext.current
        val size = LocalSize.current
        val light = config.lightId?.let { state.snapshot.light(it) } ?: state.snapshot.lights.firstOrNull()
        WidgetFrame(state, onClick = light?.let { openAppAction(context, "light/${it.id}") }, padding = 8.dp) {
            if (light == null) {
                WidgetMessage("Choose a light in the widget settings")
            } else if (WidgetLogic.cellsWide(size.width.value) >= 3) {
                Wide(light)
            } else {
                Compact(light)
            }
        }
    }

    @Composable
    private fun NameRow(l: LightUi, withToggle: Boolean) {
        Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            // The compact (2-cell) variant drops the bulb icon so the name has room next to the toggle.
            if (!withToggle) {
                WidgetIcon(R.drawable.wg_ic_lightbulb, if (l.on) WidgetColors.Amber else WidgetColors.Muted, 18.dp)
                HGap(6.dp)
            }
            Column(modifier = GlanceModifier.defaultWeight()) {
                Text(l.name, style = textStyle(WidgetColors.Text, if (withToggle) 12.sp else 13.sp, FontWeight.Bold), maxLines = 1)
                Text(l.roomName ?: "No room", style = textStyle(WidgetColors.Muted, 10.sp), maxLines = 1)
            }
            if (withToggle) {
                IconButton(R.drawable.wg_ic_power, widgetAction(WidgetActions.TOGGLE_LIGHT, l.id), if (l.on) "Turn off" else "Turn on", filled = l.on, size = 30.dp, iconSize = 16.dp)
            }
        }
    }

    @Composable
    private fun BrightnessRow(l: LightUi) {
        val pct = if (l.on) SnapshotBuilder.percent(l.brightness) else 0
        Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            IconButton(R.drawable.wg_ic_remove, widgetAction(WidgetActions.LIGHT_BRIGHTNESS_DELTA, l.id, "-10"), "Dimmer", size = 30.dp, iconSize = 16.dp)
            Text("$pct%", modifier = GlanceModifier.defaultWeight(), style = textStyle(WidgetColors.Text, 13.sp, FontWeight.Bold, TextAlign.Center), maxLines = 1)
            IconButton(R.drawable.wg_ic_add, widgetAction(WidgetActions.LIGHT_BRIGHTNESS_DELTA, l.id, "10"), "Brighter", size = 30.dp, iconSize = 16.dp)
        }
    }

    @Composable
    private fun Swatches(l: LightUi, count: Int) {
        val swatches = WidgetLogic.lightSwatches(l, count)
        if (swatches.isEmpty()) return
        Row(modifier = GlanceModifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalAlignment = Alignment.CenterVertically) {
            swatches.forEachIndexed { i, (label, hex) ->
                Box(modifier = GlanceModifier.padding(start = if (i > 0) 8.dp else 0.dp)) {
                    Swatch(hex, widgetAction(WidgetActions.LIGHT_COLOR, l.id, hex, label), size = 24.dp)
                }
            }
        }
    }

    @Composable
    private fun Compact(l: LightUi) {
        Column(modifier = GlanceModifier.fillMaxSize()) {
            NameRow(l, withToggle = true)
            VGap(8.dp)
            BrightnessRow(l)
            VGap(8.dp)
            Swatches(l, 4)
        }
    }

    @Composable
    private fun Wide(l: LightUi) {
        Row(modifier = GlanceModifier.fillMaxSize()) {
            Column(modifier = GlanceModifier.defaultWeight().fillMaxHeight()) {
                NameRow(l, withToggle = false)
                VGap(8.dp)
                Box(
                    modifier = GlanceModifier.fillMaxWidth().height(36.dp)
                        .roundedBackground(if (l.on) WidgetColors.Amber else WidgetColors.TileHigh, 14.dp)
                        .clickable(widgetAction(WidgetActions.TOGGLE_LIGHT, l.id)),
                    contentAlignment = Alignment.Center,
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        WidgetIcon(R.drawable.wg_ic_power, if (l.on) WidgetColors.OnAmber else WidgetColors.Text, 16.dp)
                        HGap(6.dp)
                        Text(if (l.on) "On" else "Off", style = textStyle(if (l.on) WidgetColors.OnAmber else WidgetColors.Text, 13.sp, FontWeight.Bold), maxLines = 1)
                    }
                }
            }
            HGap(10.dp)
            Column(modifier = GlanceModifier.defaultWeight().fillMaxHeight(), verticalAlignment = Alignment.CenterVertically) {
                BrightnessRow(l)
                VGap(10.dp)
                Swatches(l, 4)
            }
        }
    }
}

class LightControlWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = LightControlWidget()
}
