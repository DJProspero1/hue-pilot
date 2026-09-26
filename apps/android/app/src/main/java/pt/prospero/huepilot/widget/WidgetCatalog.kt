package pt.prospero.huepilot.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.annotation.DrawableRes
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import pt.prospero.huepilot.R

/** One entry of the widget gallery. No Compose UI dependencies: the in-app gallery screen builds on this. */
data class WidgetInfo(
    val id: String,
    val title: String,
    val description: String,
    @DrawableRes val previewRes: Int,
    val receiverClass: Class<out GlanceAppWidgetReceiver>,
    /** Human-readable size range, e.g. "2×1 – 4×4". */
    val sizeHint: String,
    /** The widget must be configured (room / light) before it is useful. */
    val needsConfig: Boolean = false,
    val widget: () -> GlanceAppWidget,
)

object WidgetCatalog {
    const val ID_ROOMS = "rooms"
    const val ID_ROOM_CONTROL = "room_control"
    const val ID_SCENES = "scenes"
    const val ID_HOME_STATUS = "home_status"
    const val ID_LIGHT_CONTROL = "light_control"
    const val ID_ASSISTANT = "assistant"
    const val ID_SENSORS = "sensors"
    const val ID_COLOR_STRIP = "color_strip"

    val all: List<WidgetInfo> = listOf(
        WidgetInfo(
            ID_ROOMS, "Rooms", "Tiles for your rooms and zones, tinted with their light colour. Tap a tile to toggle it.",
            R.drawable.widget_preview_rooms, RoomsWidgetReceiver::class.java, "2×1 – 4×4",
        ) { RoomsWidget() },
        WidgetInfo(
            ID_ROOM_CONTROL, "Room control", "On/off, brightness presets, quick colours and scenes for one room.",
            R.drawable.widget_preview_room_control, RoomControlWidgetReceiver::class.java, "4×2 – 4×3", needsConfig = true,
        ) { RoomControlWidget() },
        WidgetInfo(
            ID_SCENES, "Scenes", "Scene tiles painted with their palette. Tap to activate.",
            R.drawable.widget_preview_scenes, ScenesWidgetReceiver::class.java, "2×2 – 4×4",
        ) { ScenesWidget() },
        WidgetInfo(
            ID_HOME_STATUS, "All lights", "How many lights are on, with All off / All on buttons.",
            R.drawable.widget_preview_home_status, HomeStatusWidgetReceiver::class.java, "2×1 – 4×1",
        ) { HomeStatusWidget() },
        WidgetInfo(
            ID_LIGHT_CONTROL, "Light control", "On/off, brightness and quick colours for a single light.",
            R.drawable.widget_preview_light_control, LightControlWidgetReceiver::class.java, "2×2 – 4×2", needsConfig = true,
        ) { LightControlWidget() },
        WidgetInfo(
            ID_ASSISTANT, "Ask Hue Pilot", "Talk to the assistant, plus All off and Good night shortcuts.",
            R.drawable.widget_preview_assistant, AssistantWidgetReceiver::class.java, "1×1 – 2×1",
        ) { AssistantWidget() },
        WidgetInfo(
            ID_SENSORS, "Sensors & security", "Motion sensors and Hue Secure cameras: motion, temperature, light level, battery.",
            R.drawable.widget_preview_sensors, SensorsWidgetReceiver::class.java, "4×2 – 4×3",
        ) { SensorsWidget() },
        WidgetInfo(
            ID_COLOR_STRIP, "Colour strip", "Eight quick colours for one room.",
            R.drawable.widget_preview_color_strip, ColorStripWidgetReceiver::class.java, "4×1", needsConfig = true,
        ) { ColorStripWidget() },
    )

    fun byId(id: String?): WidgetInfo? = all.firstOrNull { it.id == id }

    fun byReceiver(className: String?): WidgetInfo? = all.firstOrNull { it.receiverClass.name == className }

    /** Provider component of a widget, as registered in the manifest. */
    fun provider(context: Context, info: WidgetInfo) = ComponentName(context, info.receiverClass)

    fun isPinSupported(context: Context): Boolean =
        runCatching { AppWidgetManager.getInstance(context).isRequestPinAppWidgetSupported }.getOrDefault(false)

    /**
     * Asks the launcher to place the widget on the home screen (system dialog). For widgets that need
     * configuration the configure activity opens once the widget has been placed.
     */
    fun requestPin(context: Context, info: WidgetInfo): Boolean {
        val manager = AppWidgetManager.getInstance(context)
        if (!manager.isRequestPinAppWidgetSupported) return false
        val callback = if (info.needsConfig) {
            val intent = Intent(context, WidgetConfigureActivity::class.java)
                .setAction(WidgetConfigureActivity.ACTION_PINNED + info.id)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0)
            PendingIntent.getActivity(context, info.id.hashCode(), intent, flags)
        } else null
        return runCatching { manager.requestPinAppWidget(provider(context, info), null, callback) }.getOrDefault(false)
    }
}
