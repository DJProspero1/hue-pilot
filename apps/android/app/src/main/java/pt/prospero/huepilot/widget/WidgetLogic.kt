package pt.prospero.huepilot.widget

import pt.prospero.huepilot.data.hue.AccessoryUi
import pt.prospero.huepilot.data.hue.GroupUi
import pt.prospero.huepilot.data.hue.LightUi
import pt.prospero.huepilot.data.hue.SceneUi
import pt.prospero.huepilot.domain.ColorNames
import java.time.Instant
import java.time.OffsetDateTime
import kotlin.math.ceil
import kotlin.math.pow
import kotlin.math.roundToInt

/**
 * Pure helpers shared by the home-screen widgets: colour blending for tinted tiles, gradient stops for
 * scene palettes, relative timestamps and the room/scene/sensor selection rules. No Android dependencies,
 * so everything here is unit-tested on the JVM.
 */
object WidgetLogic {
    /** Neutral tile colour (`HuePalette.NightCardHigh`). */
    const val TILE: Int = 0x272319 or (0xFF shl 24)
    /** Stand-in colour for lights that are on but have no colour information. */
    const val WARM_WHITE: Int = 0xFFD9A3 or (0xFF shl 24)
    /** Alpha at which a room's light colour is blended over the tile colour. */
    const val TINT_ALPHA = 0.28f

    /** `#rrggbb` / `#aarrggbb` (with or without `#`) → ARGB int, or null. */
    fun parseHex(hex: String?): Int? {
        val s = hex?.trim()?.removePrefix("#") ?: return null
        val n = when (s.length) {
            6 -> s.toLongOrNull(16)?.let { 0xFF000000L or it }
            8 -> s.toLongOrNull(16)
            else -> null
        } ?: return null
        return n.toInt()
    }

    fun toHex(argb: Int): String = "#%06x".format(argb and 0xFFFFFF)

    /** Opaque blend of [tint] over [base] at [alpha] (0 = base, 1 = tint). */
    fun blend(base: Int, tint: Int, alpha: Float): Int {
        val a = alpha.coerceIn(0f, 1f)
        fun ch(shift: Int): Int {
            val b = (base shr shift) and 0xFF
            val t = (tint shr shift) and 0xFF
            return (b * (1 - a) + t * a).roundToInt().coerceIn(0, 255)
        }
        return (0xFF shl 24) or (ch(16) shl 16) or (ch(8) shl 8) or ch(0)
    }

    /** Tile colour for a room: neutral when off; its first light colour (or warm white) blended at 28% when on. */
    fun tileTint(on: Boolean, colorHex: String?, base: Int = TILE, alpha: Float = TINT_ALPHA): Int {
        if (!on) return base
        return blend(base, parseHex(colorHex) ?: WARM_WHITE, alpha)
    }

    /** Relative luminance (0..1) of an opaque colour, sRGB. */
    fun luminance(argb: Int): Double {
        fun lin(c: Int): Double { val v = c / 255.0; return if (v <= 0.03928) v / 12.92 else ((v + 0.055) / 1.055).pow(2.4) }
        return 0.2126 * lin((argb shr 16) and 0xFF) + 0.7152 * lin((argb shr 8) and 0xFF) + 0.0722 * lin(argb and 0xFF)
    }

    /** Colour stops for a scene palette gradient: always at least two colours (a single colour fades to a darker shade). */
    fun gradientStops(paletteHexes: List<String>): List<Int> {
        val colors = paletteHexes.mapNotNull { parseHex(it) }.take(5)
        val black = 0xFF shl 24
        return when (colors.size) {
            0 -> listOf(WARM_WHITE, blend(WARM_WHITE, black, 0.45f))
            1 -> listOf(colors[0], blend(colors[0], black, 0.45f))
            else -> colors
        }
    }

    /** Evenly spaced positions (0..1) for [count] gradient stops. */
    fun stopPositions(count: Int): FloatArray = FloatArray(count) { if (count <= 1) 0f else it / (count - 1f) }

    /** "just now", "5 min ago", "3 h ago", "2 d ago" from an ISO-8601 timestamp (Hue `changed`/`updated`). */
    fun relativeTime(iso: String?, nowMillis: Long = System.currentTimeMillis()): String {
        if (iso.isNullOrBlank()) return ""
        val instant = runCatching { OffsetDateTime.parse(iso).toInstant() }
            .recoverCatching { Instant.parse(if (iso.endsWith("Z")) iso else iso + "Z") }
            .getOrNull() ?: return ""
        val secs = (nowMillis - instant.toEpochMilli()) / 1000
        return when {
            secs < 60 -> "just now"
            secs < 3600 -> "${secs / 60} min ago"
            secs < 86400 -> "${secs / 3600} h ago"
            else -> "${secs / 86400} d ago"
        }
    }

    /** "3 of 4 on", "All 4 on", "Off". */
    fun onLabel(on: Int, total: Int): String = when {
        total == 0 -> "No lights"
        on == 0 -> "Off"
        on == total -> if (total == 1) "On" else "All $total on"
        else -> "$on of $total on"
    }

    /** Groups shown by the Rooms grid: the configured ids in order, else the favourites, else every room then zone. */
    fun chooseGroups(groups: List<GroupUi>, configuredIds: List<String>, favouriteIds: List<String>): List<GroupUi> {
        val byId = groups.associateBy { it.id }
        val ordered = configuredIds.ifEmpty { favouriteIds }.mapNotNull { byId[it] }
        return ordered.ifEmpty { groups }
    }

    /** Default single group for a widget: first favourite, else first room, else first zone. */
    fun defaultGroup(groups: List<GroupUi>, favouriteIds: List<String>): GroupUi? =
        favouriteIds.firstNotNullOfOrNull { id -> groups.firstOrNull { it.id == id } } ?: groups.firstOrNull()

    /** Scenes shown by the Scenes widget: the chosen group's, else scenes of the favourite rooms, else all. */
    fun chooseScenes(scenes: List<SceneUi>, groupId: String?, favouriteIds: List<String>): List<SceneUi> {
        if (groupId != null) return scenes.filter { it.groupId == groupId }
        val favs = scenes.filter { it.groupId in favouriteIds }
        return favs.ifEmpty { scenes }
    }

    fun isCamera(productName: String?): Boolean = productName?.contains("camera", ignoreCase = true) == true

    /** Motion sensors and Hue Secure cameras, cameras first, then by name. */
    fun sensorDevices(accessories: List<AccessoryUi>): List<AccessoryUi> =
        accessories.filter { !it.isBridge && (it.motionId != null || isCamera(it.productName)) }
            .sortedWith(compareBy({ !isCamera(it.productName) }, { it.name.lowercase() }))

    /** Launcher cells spanned by a widget of the given bucket width (buckets are `70 * cells - 30` dp). */
    fun cellsWide(widthDp: Float): Int = ((widthDp + 30f) / 70f).toInt().coerceIn(1, 6)

    /** Launcher cells spanned by a widget of the given bucket height (buckets are `80 * cells - 40` dp). */
    fun cellsTall(heightDp: Float): Int = ((heightDp + 40f) / 80f).toInt().coerceIn(1, 6)

    /** Tile columns for a grid widget: one per cell, at least two. */
    fun gridColumns(widthDp: Float): Int = cellsWide(widthDp).coerceIn(2, 5)

    /** Tile rows for a grid widget: one per cell. */
    fun gridRows(heightDp: Float): Int = cellsTall(heightDp)

    /**
     * Columns × rows for [count] tiles in a widget that can hold up to [maxCols] × [maxRows]: uses as
     * few columns as possible (wider tiles) while still showing every tile that fits, and no empty rows.
     */
    fun gridFor(count: Int, maxCols: Int, maxRows: Int): Pair<Int, Int> {
        if (count <= 0) return maxCols to 1
        val cols = ceil(count / maxRows.toFloat()).toInt().coerceIn(2, maxOf(2, maxCols))
        val rows = ceil(minOf(count, cols * maxRows) / cols.toFloat()).toInt().coerceIn(1, maxRows)
        return cols to rows
    }

    /** Quick-colour swatches: label → hex from the app's quick palette. */
    fun quickColors(labels: List<String>): List<Pair<String, String>> =
        labels.mapNotNull { l -> ColorNames.QUICK_PALETTE.firstOrNull { it.first == l } }

    val QUICK_8 = listOf("Warm", "Neutral", "Cool", "Red", "Orange", "Green", "Blue", "Purple")
    val QUICK_6 = listOf("Warm", "Cool", "Red", "Orange", "Green", "Blue")
    val QUICK_4 = listOf("Warm", "Cool", "Red", "Blue")
    val WHITES_4 = listOf("Warm", "Relax", "Neutral", "Cool")

    /** Swatches for a light: colours if it supports colour, white presets if it only supports colour temperature, none otherwise. */
    fun lightSwatches(light: LightUi, count: Int): List<Pair<String, String>> = when {
        light.supportsColor -> quickColors(if (count >= 6) QUICK_6 else QUICK_4)
        light.supportsCt -> quickColors(WHITES_4)
        else -> emptyList()
    }

    /** Distinct colours of the rooms that are lit (for the Home status colour dots). */
    fun litRoomColors(groups: List<GroupUi>, max: Int = 6): List<String> =
        groups.filter { it.on }.map { it.colorHexes.firstOrNull() ?: toHex(WARM_WHITE) }.distinct().take(max)
}
