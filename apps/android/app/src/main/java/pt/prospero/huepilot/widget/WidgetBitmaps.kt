package pt.prospero.huepilot.widget

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RectF
import android.graphics.Shader
import android.util.LruCache
import kotlin.math.roundToInt

/** Rendered bitmaps for the widgets (scene palette gradients). Cached so identical tiles share one bitmap. */
object WidgetBitmaps {
    private val cache = LruCache<String, Bitmap>(96)

    /**
     * Rounded tile painted with a diagonal gradient of the scene's palette and a dark scrim at the bottom
     * so a name overlaid on it stays legible.
     */
    fun sceneTile(context: Context, paletteHexes: List<String>, widthDp: Float, heightDp: Float, radiusDp: Float = 18f): Bitmap {
        val density = context.resources.displayMetrics.density
        val w = (widthDp * density).roundToInt().coerceAtLeast(8)
        val h = (heightDp * density).roundToInt().coerceAtLeast(8)
        val stops = WidgetLogic.gradientStops(paletteHexes)
        val key = stops.joinToString(",") + "|$w|$h|$radiusDp"
        cache.get(key)?.let { return it }

        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        val rect = RectF(0f, 0f, w.toFloat(), h.toFloat())
        val radius = radiusDp * density
        val gradient = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = LinearGradient(0f, 0f, w.toFloat(), h.toFloat(), stops.toIntArray(), WidgetLogic.stopPositions(stops.size), Shader.TileMode.CLAMP)
        }
        canvas.drawRoundRect(rect, radius, radius, gradient)
        val scrim = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            shader = LinearGradient(0f, h * 0.3f, 0f, h.toFloat(), intArrayOf(0x00000000, 0xA6000000.toInt()), null, Shader.TileMode.CLAMP)
            xfermode = PorterDuffXfermode(PorterDuff.Mode.SRC_ATOP)
        }
        canvas.drawRoundRect(rect, radius, radius, scrim)
        cache.put(key, bmp)
        return bmp
    }
}
