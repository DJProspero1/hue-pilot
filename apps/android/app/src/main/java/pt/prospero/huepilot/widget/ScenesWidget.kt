package pt.prospero.huepilot.widget

import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.ContentScale
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxHeight
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import pt.prospero.huepilot.R
import pt.prospero.huepilot.data.hue.SceneUi

/**
 * Scenes grid (2×2 … 4×4): each scene is a tile painted with its palette gradient, name overlaid, the
 * active scene marked with a check. Tap activates. Configure: one room, or the favourites (default).
 */
class ScenesWidget : HueWidget(2 to 2, 3 to 2, 4 to 2, 2 to 3, 3 to 3, 4 to 3, 3 to 4, 4 to 4) {

    @Composable
    override fun Content(state: WidgetState, config: WidgetConfig) {
        val context = LocalContext.current
        val size = LocalSize.current
        val pad = 8.dp
        val gap = 6.dp
        WidgetFrame(state, onClick = openAppAction(context, "scenes"), padding = pad) {
            val scenes = WidgetLogic.chooseScenes(state.snapshot.scenes, config.groupId, state.favouriteRoomIds)
            val cols = WidgetLogic.gridColumns(size.width.value)
            val rows = WidgetLogic.gridRows(size.height.value)
            val shown = scenes.take(cols * rows)
            if (shown.isEmpty()) {
                WidgetMessage("No scenes yet")
            } else {
                val tileW = (size.width.value - 2 * pad.value - (cols - 1) * gap.value) / cols
                val tileH = (size.height.value - 2 * pad.value - (rows - 1) * gap.value) / rows
                val showGroup = config.groupId == null
                Column(modifier = GlanceModifier.fillMaxSize()) {
                    shown.chunked(cols).forEachIndexed { r, line ->
                        if (r > 0) VGap(gap)
                        Row(modifier = GlanceModifier.fillMaxWidth().defaultWeight()) {
                            line.forEachIndexed { i, s ->
                                if (i > 0) HGap(gap)
                                SceneTile(s, tileW, tileH, showGroup, GlanceModifier.defaultWeight().fillMaxHeight())
                            }
                            repeat(cols - line.size) {
                                HGap(gap)
                                Spacer(GlanceModifier.defaultWeight())
                            }
                        }
                    }
                }
            }
        }
    }

    @Composable
    private fun SceneTile(s: SceneUi, widthDp: Float, heightDp: Float, showGroup: Boolean, modifier: GlanceModifier) {
        val context = LocalContext.current
        val bitmap = WidgetBitmaps.sceneTile(context, s.paletteHexes, widthDp, heightDp)
        Box(modifier = modifier.clickable(widgetAction(WidgetActions.SCENE, s.id))) {
            Image(ImageProvider(bitmap), contentDescription = s.name, modifier = GlanceModifier.fillMaxSize(), contentScale = ContentScale.Crop)
            Column(modifier = GlanceModifier.fillMaxSize().padding(horizontal = 7.dp, vertical = 6.dp), verticalAlignment = Alignment.Bottom) {
                // Narrow tiles get a smaller font (long names are ellipsised rather than broken mid-word).
                val narrow = widthDp < 70f
                Text(s.name, style = textStyle(WidgetColors.Text, if (narrow) 10.sp else 12.sp, FontWeight.Bold), maxLines = 1)
                if (showGroup && s.groupName.isNotEmpty()) Text(s.groupName, style = textStyle(WidgetColors.Text, 9.sp), maxLines = 1)
            }
            if (s.isActive) {
                Box(modifier = GlanceModifier.fillMaxSize().padding(5.dp), contentAlignment = Alignment.TopEnd) {
                    Box(modifier = GlanceModifier.size(18.dp).roundedBackground(WidgetColors.Amber, 999.dp), contentAlignment = Alignment.Center) {
                        WidgetIcon(R.drawable.wg_ic_check, WidgetColors.OnAmber, 12.dp, "Active")
                    }
                }
            }
        }
    }
}

class ScenesWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = ScenesWidget()
}
