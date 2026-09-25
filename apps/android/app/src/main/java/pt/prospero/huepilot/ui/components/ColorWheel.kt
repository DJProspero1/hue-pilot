package pt.prospero.huepilot.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import pt.prospero.huepilot.domain.ColorMath
import pt.prospero.huepilot.domain.Gamut
import pt.prospero.huepilot.domain.HSV
import pt.prospero.huepilot.domain.XY
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.min
import kotlin.math.sin

/**
 * A hue/saturation colour disc drawn on a Canvas with a draggable thumb. The selected colour is
 * converted to CIE xy (clipped to [gamut]) and reported through [onColorSelected] when the drag ends
 * (and throttled while dragging when [liveUpdates] is true).
 */
@Composable
fun ColorWheel(
    currentXy: XY?,
    gamut: Gamut,
    modifier: Modifier = Modifier,
    liveUpdates: Boolean = true,
    onColorSelected: (XY) -> Unit,
) {
    // Thumb position as (hue degrees, saturation 0..1)
    var hue by remember { mutableStateOf(30f) }
    var sat by remember { mutableStateOf(0.5f) }
    var dragging by remember { mutableStateOf(false) }
    var lastSent by remember { mutableStateOf(0L) }

    LaunchedEffect(currentXy) {
        if (!dragging && currentXy != null) {
            val rgb = ColorMath.xyToRgb(currentXy, 1.0)
            val hsv = ColorMath.rgbToHsv(rgb)
            hue = hsv.h
            sat = hsv.s
        }
    }

    fun emit(final: Boolean) {
        val rgb = ColorMath.hsvToRgb(HSV(hue, sat, 1f))
        val xy = ColorMath.rgbToXy(rgb, gamut)
        val now = System.currentTimeMillis()
        if (final || (liveUpdates && now - lastSent > 300)) {
            lastSent = now
            onColorSelected(xy)
        }
    }

    fun updateFromPointer(pos: Offset, center: Offset, radius: Float) {
        val dx = pos.x - center.x
        val dy = pos.y - center.y
        val dist = hypot(dx, dy)
        var angle = Math.toDegrees(atan2(dy, dx).toDouble()).toFloat()
        if (angle < 0) angle += 360f
        hue = angle
        sat = (dist / radius).coerceIn(0f, 1f)
    }

    val hueColors = remember {
        listOf(
            Color.Red, Color(0xFFFFFF00), Color.Green, Color.Cyan, Color.Blue, Color.Magenta, Color.Red,
        )
    }

    Canvas(
        modifier = modifier
            .fillMaxWidth()
            .aspectRatio(1f)
            .pointerInput(gamut) {
                detectDragGestures(
                    onDragStart = { pos ->
                        dragging = true
                        val c = Offset(size.width / 2f, size.height / 2f)
                        updateFromPointer(pos, c, min(size.width, size.height) / 2f - 8f)
                        emit(false)
                    },
                    onDrag = { change, _ ->
                        val c = Offset(size.width / 2f, size.height / 2f)
                        updateFromPointer(change.position, c, min(size.width, size.height) / 2f - 8f)
                        emit(false)
                    },
                    onDragEnd = { dragging = false; emit(true) },
                    onDragCancel = { dragging = false; emit(true) },
                )
            }
            .pointerInput(gamut) {
                detectTapGestures { pos ->
                    val c = Offset(size.width / 2f, size.height / 2f)
                    updateFromPointer(pos, c, min(size.width, size.height) / 2f - 8f)
                    emit(true)
                }
            }
    ) {
        val radius = min(size.width, size.height) / 2f - 8f
        val center = Offset(size.width / 2f, size.height / 2f)
        // Hue sweep
        drawCircle(brush = Brush.sweepGradient(hueColors, center), radius = radius, center = center)
        // Saturation: white in the middle fading out
        drawCircle(
            brush = Brush.radialGradient(listOf(Color.White, Color.White.copy(alpha = 0f)), center, radius),
            radius = radius, center = center,
        )
        // Outline
        drawCircle(color = Color.Black.copy(alpha = 0.15f), radius = radius, center = center, style = Stroke(width = 2f))
        // Thumb
        val rad = Math.toRadians(hue.toDouble())
        val tx = center.x + cos(rad).toFloat() * sat * radius
        val ty = center.y + sin(rad).toFloat() * sat * radius
        val thumbColor = ColorMath.hsvToRgb(HSV(hue, sat, 1f))
        drawCircle(color = Color.Black.copy(alpha = 0.35f), radius = 20f, center = Offset(tx + 1.5f, ty + 2.5f))
        drawCircle(color = Color(thumbColor.r, thumbColor.g, thumbColor.b), radius = 18f, center = Offset(tx, ty))
        drawCircle(color = Color.White, radius = 18f, center = Offset(tx, ty), style = Stroke(width = 5f))
    }
}
