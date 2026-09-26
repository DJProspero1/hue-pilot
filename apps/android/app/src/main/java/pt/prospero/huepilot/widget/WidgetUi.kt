package pt.prospero.huepilot.widget

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.annotation.DrawableRes
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.ColorFilter
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.action.Action
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.ContentScale
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextAlign
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import pt.prospero.huepilot.MainActivity
import pt.prospero.huepilot.R

/**
 * Widget design tokens: the app's warm near-black palette (`HuePalette`), always dark — lighting
 * widgets look best dark on any launcher, so no dynamic colours are used.
 */
object WidgetColors {
    val Background = Color(0xF01E1B17)      // NightCard at 94 %
    val Tile = Color(0xFF272319)            // NightCardHigh
    val TileHigh = Color(0xFF2F2A20)        // NightCardHighest
    val Outline = Color(0xFF3B352C)
    val Text = Color(0xFFF5EFE6)
    val Muted = Color(0xFFA89F92)
    val Amber = Color(0xFFFFB454)
    val OnAmber = Color(0xFF2A1600)
    val AmberDim = Color(0xFF3D2A0A)
    val Danger = Color(0xFFFF6B6B)
    val DangerDim = Color(0xFF4A2222)
    val Success = Color(0xFF5BD39B)
}

fun cp(color: Color): ColorProvider = ColorProvider(color)

fun cp(argb: Int): ColorProvider = ColorProvider(Color(argb))

fun textStyle(color: Color = WidgetColors.Text, size: TextUnit = 12.sp, weight: FontWeight = FontWeight.Normal, align: TextAlign? = null) =
    TextStyle(color = cp(color), fontSize = size, fontWeight = weight, textAlign = align)

/** Responsive size buckets expressed in launcher cells (≈ 70 dp wide, 80 dp tall, minus the usual margins). */
object WidgetSizes {
    fun cells(w: Int, h: Int): DpSize = DpSize((70 * w - 30).dp, (80 * h - 40).dp)
    fun set(vararg cells: Pair<Int, Int>): Set<DpSize> = cells.map { cells(it.first, it.second) }.toSet()
}

/** Rounded solid background; API < 31 cannot clip corners so a tinted shape drawable is used instead. */
fun GlanceModifier.roundedBackground(color: Color, radius: Dp): GlanceModifier =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        background(ColorProvider(color)).cornerRadius(radius)
    } else {
        background(ImageProvider(shapeFor(radius)), ContentScale.FillBounds, ColorFilter.tint(ColorProvider(color)))
    }

@DrawableRes
private fun shapeFor(radius: Dp): Int = when {
    radius >= 100.dp -> R.drawable.widget_shape_pill
    radius >= 24.dp -> R.drawable.widget_shape_24
    radius >= 18.dp -> R.drawable.widget_shape_18
    else -> R.drawable.widget_shape_12
}

fun GlanceModifier.widgetBackground(): GlanceModifier = roundedBackground(WidgetColors.Background, 24.dp)

/**
 * Base class: responsive sizes, state + per-widget config, config cleanup on delete.
 *
 * A Glance session stays alive for a while and `update()` only recomposes it (it does not run
 * [provideGlance] again), so the content collects [WidgetData.live] and [WidgetPrefs.changes] instead of
 * capturing a snapshot: live sessions re-render on repository changes, expired ones reload on the next update.
 */
abstract class HueWidget(vararg cells: Pair<Int, Int>) : GlanceAppWidget() {
    override val sizeMode: SizeMode = SizeMode.Responsive(WidgetSizes.set(*cells))

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val app = context.applicationContext
        val appWidgetId = runCatching { GlanceAppWidgetManager(context).getAppWidgetId(id) }.getOrDefault(0)
        val initial = WidgetData.load(app)
        val live = WidgetData.live(app)
        provideContent {
            val liveState by live.collectAsState()
            val version by WidgetPrefs.changes.collectAsState()
            val config = remember(version, appWidgetId) { WidgetPrefs.get(app, appWidgetId) }
            // Until the live flow has data, show what the one-shot load produced (cache / offline).
            val state = if (liveState.hasData || !liveState.paired) liveState else initial
            Content(state, config)
        }
    }

    @Composable
    abstract fun Content(state: WidgetState, config: WidgetConfig)

    override suspend fun onDelete(context: Context, glanceId: GlanceId) {
        runCatching { WidgetPrefs.remove(context, GlanceAppWidgetManager(context).getAppWidgetId(glanceId)) }
    }
}

/** Opens the app on a route (`home`, `scenes`, `assistant`, `room/<id>`, …) through the huepilot:// deep link. */
fun openAppAction(context: Context, route: String, listen: Boolean = false): Action {
    val uri = Uri.parse("huepilot://$route" + if (listen) "?listen=1" else "")
    val intent = Intent(Intent.ACTION_VIEW, uri, context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    return actionStartActivity(intent)
}

/** Card background, "pair a bridge" / "loading" states and the offline hint, shared by all widgets. */
@Composable
fun WidgetFrame(state: WidgetState, onClick: Action? = null, padding: Dp = 10.dp, content: @Composable () -> Unit) {
    var modifier = GlanceModifier.fillMaxSize().widgetBackground()
    if (onClick != null) modifier = modifier.clickable(onClick)
    Box(modifier = modifier.padding(padding), contentAlignment = Alignment.TopStart) {
        when {
            !state.paired -> WidgetMessage("Open Hue Pilot to pair a bridge")
            !state.hasData -> WidgetMessage(if (state.offline) "Can't reach the bridge" else "Loading…")
            else -> content()
        }
        if (state.offline && state.hasData) {
            Box(modifier = GlanceModifier.fillMaxSize(), contentAlignment = Alignment.BottomEnd) {
                Text("offline", style = textStyle(WidgetColors.Muted, 9.sp), maxLines = 1)
            }
        }
    }
}

@Composable
fun WidgetMessage(text: String) {
    Box(modifier = GlanceModifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Text(text, style = textStyle(WidgetColors.Muted, 12.sp, align = TextAlign.Center), maxLines = 2)
    }
}

@Composable
fun WidgetIcon(@DrawableRes res: Int, tint: Color, size: Dp, description: String? = null, modifier: GlanceModifier = GlanceModifier) {
    Image(
        provider = ImageProvider(res),
        contentDescription = description,
        modifier = modifier.size(size),
        colorFilter = ColorFilter.tint(cp(tint)),
    )
}

/** Small rounded text button; amber when [filled]. */
@Composable
fun PillButton(text: String, onClick: Action, modifier: GlanceModifier = GlanceModifier, filled: Boolean = false, size: TextUnit = 12.sp, bg: Color? = null) {
    val background = bg ?: if (filled) WidgetColors.Amber else WidgetColors.TileHigh
    val fg = if (filled) WidgetColors.OnAmber else WidgetColors.Text
    Box(
        modifier = modifier.roundedBackground(background, 999.dp).clickable(onClick).padding(horizontal = 10.dp, vertical = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = textStyle(fg, size, FontWeight.Bold, TextAlign.Center), maxLines = 1)
    }
}

/** Round icon button. */
@Composable
fun IconButton(@DrawableRes res: Int, onClick: Action, description: String, modifier: GlanceModifier = GlanceModifier, filled: Boolean = false, size: Dp = 34.dp, iconSize: Dp = 18.dp, bg: Color? = null, tint: Color? = null) {
    val background = bg ?: if (filled) WidgetColors.Amber else WidgetColors.TileHigh
    val fg = tint ?: if (filled) WidgetColors.OnAmber else WidgetColors.Text
    Box(
        modifier = modifier.size(size).roundedBackground(background, 999.dp).clickable(onClick),
        contentAlignment = Alignment.Center,
    ) {
        WidgetIcon(res, fg, iconSize, description)
    }
}

/** Solid colour circle (quick colour swatch). */
@Composable
fun Swatch(hex: String, onClick: Action, size: Dp = 26.dp, modifier: GlanceModifier = GlanceModifier, selected: Boolean = false) {
    val color = Color(WidgetLogic.parseHex(hex) ?: WidgetLogic.WARM_WHITE)
    Box(modifier = modifier.size(size).roundedBackground(if (selected) WidgetColors.Text else WidgetColors.Outline, 999.dp).clickable(onClick), contentAlignment = Alignment.Center) {
        Box(modifier = GlanceModifier.size(size - 4.dp).roundedBackground(color, 999.dp)) {}
    }
}

/** Horizontal gap. */
@Composable
fun HGap(width: Dp = 6.dp) = Spacer(GlanceModifier.width(width))

/** Vertical gap. */
@Composable
fun VGap(height: Dp = 6.dp) = Spacer(GlanceModifier.height(height))

/** Row of small colour dots (lit rooms). */
@Composable
fun ColorDots(hexes: List<String>, dot: Dp = 8.dp) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        hexes.forEachIndexed { i, hex ->
            Box(modifier = GlanceModifier.padding(start = if (i > 0) 3.dp else 0.dp)) {
                Box(modifier = GlanceModifier.size(dot).roundedBackground(Color(WidgetLogic.parseHex(hex) ?: WidgetLogic.WARM_WHITE), 999.dp)) {}
            }
        }
    }
}

/** Header line: icon, title, optional subtitle, optional trailing content. */
@Composable
fun WidgetHeader(@DrawableRes icon: Int, title: String, subtitle: String? = null, iconTint: Color = WidgetColors.Amber, trailing: (@Composable () -> Unit)? = null) {
    Row(modifier = GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        WidgetIcon(icon, iconTint, 18.dp)
        HGap(8.dp)
        Column(modifier = GlanceModifier.defaultWeight()) {
            Text(title, style = textStyle(WidgetColors.Text, 14.sp, FontWeight.Bold), maxLines = 1)
            if (subtitle != null) Text(subtitle, style = textStyle(WidgetColors.Muted, 11.sp), maxLines = 1)
        }
        if (trailing != null) trailing()
    }
}

/** Maps a Hue room/zone archetype to a widget icon (mirrors `ui/components/Icons.kt`). */
@DrawableRes
fun archetypeIconRes(archetype: String?): Int = when (archetype?.lowercase()) {
    "living_room", "lounge", "tv", "man_cave" -> R.drawable.wg_ic_sofa
    "kitchen" -> R.drawable.wg_ic_kitchen
    "dining", "barbecue" -> R.drawable.wg_ic_restaurant
    "bedroom", "kids_bedroom", "nursery" -> R.drawable.wg_ic_bed
    "guest_room" -> R.drawable.wg_ic_hotel
    "bathroom" -> R.drawable.wg_ic_bathtub
    "toilet" -> R.drawable.wg_ic_wc
    "office", "computer", "work", "reading" -> R.drawable.wg_ic_computer
    "gym", "recreation" -> R.drawable.wg_ic_gym
    "hallway", "front_door", "staircase", "closet", "storage", "laundry_room" -> R.drawable.wg_ic_door
    "garage", "carport", "driveway" -> R.drawable.wg_ic_car
    "terrace", "balcony", "garden", "porch", "pool", "outdoor", "other" -> R.drawable.wg_ic_park
    "home", "downstairs", "upstairs", "top_floor", "attic" -> R.drawable.wg_ic_home
    "music", "studio" -> R.drawable.wg_ic_music
    else -> R.drawable.wg_ic_lightbulb
}
