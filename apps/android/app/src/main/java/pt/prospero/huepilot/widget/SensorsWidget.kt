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
import pt.prospero.huepilot.data.hue.AccessoryUi
import kotlin.math.roundToInt

/**
 * Sensors & security (4×2, 4×3): every motion sensor and Hue Secure camera with motion state, temperature,
 * light level, battery and "x min ago". Tap opens the Accessories tab; the header has a refresh button.
 */
class SensorsWidget : HueWidget(3 to 2, 4 to 2, 3 to 3, 4 to 3, 4 to 4) {

    @Composable
    override fun Content(state: WidgetState, config: WidgetConfig) {
        val context = LocalContext.current
        val size = LocalSize.current
        val open = openAppAction(context, "accessories")
        WidgetFrame(state, onClick = open, padding = 8.dp) {
            val devices = WidgetLogic.sensorDevices(state.snapshot.accessories)
            // One 34 dp row + 3 dp gap per 37 dp, after the header and padding (cells are ≈ 80 dp tall).
            val rows = ((WidgetLogic.cellsTall(size.height.value) * 80 - 44) / 37).coerceIn(1, 8)
            Column(modifier = GlanceModifier.fillMaxSize()) {
                Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    WidgetIcon(R.drawable.wg_ic_sensors, WidgetColors.Amber, 16.dp)
                    HGap(6.dp)
                    Text("Sensors & security", modifier = GlanceModifier.defaultWeight(), style = textStyle(WidgetColors.Text, 12.sp, FontWeight.Bold), maxLines = 1)
                    IconButton(R.drawable.wg_ic_refresh, widgetAction(WidgetActions.REFRESH), "Refresh", size = 22.dp, iconSize = 13.dp)
                }
                if (devices.isEmpty()) {
                    VGap(8.dp)
                    Text("No motion sensors or cameras", style = textStyle(WidgetColors.Muted, 11.sp), maxLines = 2)
                } else {
                    // Spacing via padding: a Glance Column holds at most 10 children.
                    devices.take(rows).forEach { d -> SensorRow(d, openAction = open) }
                }
            }
        }
    }

    @Composable
    private fun SensorRow(d: AccessoryUi, openAction: androidx.glance.action.Action) {
        val camera = WidgetLogic.isCamera(d.productName)
        val motion = d.motion == true
        val updated = WidgetLogic.relativeTime(d.motionUpdated ?: d.lightLevelUpdated ?: d.temperatureUpdated)
        val readings = listOfNotNull(
            d.temperatureC?.let { "${((it * 2).roundToInt() / 2.0).let { v -> if (v % 1.0 == 0.0) v.toInt().toString() else v.toString() }}°" },
            d.lux?.let { "${it.roundToInt()} lx" },
            d.batteryLevel?.let { "$it%" },
        ).joinToString(" · ")
        Box(modifier = GlanceModifier.fillMaxWidth().padding(top = 3.dp)) {
        Row(
            modifier = GlanceModifier.fillMaxWidth().height(33.dp).roundedBackground(WidgetColors.Tile, 12.dp).clickable(openAction).padding(horizontal = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            WidgetIcon(if (camera) R.drawable.wg_ic_videocam else R.drawable.wg_ic_sensors, if (motion) WidgetColors.Danger else WidgetColors.Muted, 16.dp)
            HGap(8.dp)
            Column(modifier = GlanceModifier.defaultWeight()) {
                Text(d.name, style = textStyle(WidgetColors.Text, 12.sp, FontWeight.Bold), maxLines = 1)
                val line = listOf(readings, updated).filter { it.isNotEmpty() }.joinToString(" · ")
                if (line.isNotEmpty()) Text(line, style = textStyle(WidgetColors.Muted, 9.sp), maxLines = 1)
            }
            HGap(6.dp)
            Box(
                modifier = GlanceModifier.roundedBackground(if (motion) WidgetColors.DangerDim else WidgetColors.TileHigh, 999.dp).padding(horizontal = 8.dp, vertical = 3.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(if (motion) "Motion" else "Clear", style = textStyle(if (motion) WidgetColors.Danger else WidgetColors.Muted, 10.sp, FontWeight.Bold), maxLines = 1)
            }
        }
        }
    }
}

class SensorsWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = SensorsWidget()
}
