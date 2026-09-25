package pt.prospero.huepilot.domain

import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.ln
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt

/** CIE 1931 xy chromaticity. */
data class XY(val x: Double, val y: Double)

/** Colour gamut triangle of a Hue light. */
data class Gamut(val red: XY, val green: XY, val blue: XY)

data class RGB(val r: Int, val g: Int, val b: Int) {
    fun toHex(): String = "#%02x%02x%02x".format(r.coerceIn(0, 255), g.coerceIn(0, 255), b.coerceIn(0, 255))
    fun toArgb(): Int = (0xFF shl 24) or (r.coerceIn(0, 255) shl 16) or (g.coerceIn(0, 255) shl 8) or b.coerceIn(0, 255)
}

data class HSV(val h: Float, val s: Float, val v: Float)

/**
 * Colour conversions used across the app and the assistant. The formulas match the Philips
 * reference implementation (and packages/hue-core in this repository) exactly.
 */
object ColorMath {
    val GAMUT_C = Gamut(XY(0.6915, 0.3083), XY(0.17, 0.7), XY(0.1532, 0.0475))
    val GAMUT_A = Gamut(XY(0.704, 0.296), XY(0.2151, 0.7106), XY(0.138, 0.08))
    val GAMUT_B = Gamut(XY(0.675, 0.322), XY(0.409, 0.518), XY(0.167, 0.04))

    fun gamutForType(type: String?): Gamut = when (type) {
        "A" -> GAMUT_A
        "B" -> GAMUT_B
        else -> GAMUT_C
    }

    private fun clamp(v: Double, lo: Double, hi: Double) = min(hi, max(lo, v))

    fun srgbToLinear(c: Double): Double = if (c > 0.04045) ((c + 0.055) / 1.055).pow(2.4) else c / 12.92
    fun linearToSrgb(c: Double): Double = if (c <= 0.0031308) 12.92 * c else 1.055 * c.pow(1.0 / 2.4) - 0.055

    /** sRGB 0..255 -> xy, clipped to [gamut]. */
    fun rgbToXy(rgb: RGB, gamut: Gamut = GAMUT_C): XY {
        val r = srgbToLinear(rgb.r.coerceIn(0, 255) / 255.0)
        val g = srgbToLinear(rgb.g.coerceIn(0, 255) / 255.0)
        val b = srgbToLinear(rgb.b.coerceIn(0, 255) / 255.0)
        val x = r * 0.664511 + g * 0.154324 + b * 0.162028
        val y = r * 0.283881 + g * 0.668433 + b * 0.047685
        val z = r * 0.000088 + g * 0.072310 + b * 0.986039
        val sum = x + y + z
        if (sum == 0.0) return XY(0.3227, 0.329)
        val clipped = clipToGamut(XY(x / sum, y / sum), gamut)
        return XY(round4(clipped.x), round4(clipped.y))
    }

    private fun round4(v: Double) = (v * 10000.0).roundToInt() / 10000.0

    /** xy + brightness (0..1) -> sRGB 0..255. */
    fun xyToRgb(xy: XY, brightness: Double = 1.0): RGB {
        val x = xy.x
        val y = if (xy.y == 0.0) 1e-6 else xy.y
        val z = 1.0 - x - y
        val yy = clamp(brightness, 0.0, 1.0)
        val xx = (yy / y) * x
        val zz = (yy / y) * z
        var r = xx * 1.656492 - yy * 0.354851 - zz * 0.255038
        var g = -xx * 0.707196 + yy * 1.655397 + zz * 0.036152
        var b = xx * 0.051713 - yy * 0.121364 + zz * 1.011530
        val mx = max(r, max(g, b))
        if (mx > 1.0) {
            r /= mx; g /= mx; b /= mx
        }
        r = clamp(r, 0.0, 1.0); g = clamp(g, 0.0, 1.0); b = clamp(b, 0.0, 1.0)
        return RGB(
            (linearToSrgb(r) * 255).roundToInt(),
            (linearToSrgb(g) * 255).roundToInt(),
            (linearToSrgb(b) * 255).roundToInt(),
        )
    }

    fun xyToHex(xy: XY): String = xyToRgb(xy, 1.0).toHex()

    private fun cross(p1: XY, p2: XY) = p1.x * p2.y - p1.y * p2.x

    fun isInsideGamut(p: XY, gamut: Gamut): Boolean {
        val v1 = XY(gamut.green.x - gamut.red.x, gamut.green.y - gamut.red.y)
        val v2 = XY(gamut.blue.x - gamut.red.x, gamut.blue.y - gamut.red.y)
        val q = XY(p.x - gamut.red.x, p.y - gamut.red.y)
        val denom = cross(v1, v2)
        if (denom == 0.0) return false
        val s = cross(q, v2) / denom
        val t = cross(v1, q) / denom
        return s >= 0 && t >= 0 && s + t <= 1
    }

    private fun closestPointOnSegment(a: XY, b: XY, p: XY): XY {
        val apx = p.x - a.x; val apy = p.y - a.y
        val abx = b.x - a.x; val aby = b.y - a.y
        val ab2 = abx * abx + aby * aby
        val t = if (ab2 == 0.0) 0.0 else clamp((apx * abx + apy * aby) / ab2, 0.0, 1.0)
        return XY(a.x + abx * t, a.y + aby * t)
    }

    private fun distance(a: XY, b: XY) = hypot(a.x - b.x, a.y - b.y)

    fun clipToGamut(p: XY, gamut: Gamut): XY {
        if (isInsideGamut(p, gamut)) return p
        val candidates = listOf(
            closestPointOnSegment(gamut.red, gamut.green, p),
            closestPointOnSegment(gamut.green, gamut.blue, p),
            closestPointOnSegment(gamut.blue, gamut.red, p),
        )
        return candidates.minByOrNull { distance(it, p) } ?: p
    }

    fun hexToRgb(hex: String): RGB? {
        var m = hex.trim().removePrefix("#")
        if (m.length == 3) m = m.map { "$it$it" }.joinToString("")
        if (!Regex("^[0-9a-fA-F]{6}$").matches(m)) return null
        val n = m.toLong(16).toInt()
        return RGB((n shr 16) and 255, (n shr 8) and 255, n and 255)
    }

    fun hsvToRgb(hsv: HSV): RGB {
        val h = ((hsv.h % 360f) + 360f) % 360f
        val s = hsv.s.coerceIn(0f, 1f)
        val v = hsv.v.coerceIn(0f, 1f)
        val c = v * s
        val x = c * (1 - abs(((h / 60f) % 2) - 1))
        val m = v - c
        val (r, g, b) = when {
            h < 60 -> Triple(c, x, 0f)
            h < 120 -> Triple(x, c, 0f)
            h < 180 -> Triple(0f, c, x)
            h < 240 -> Triple(0f, x, c)
            h < 300 -> Triple(x, 0f, c)
            else -> Triple(c, 0f, x)
        }
        return RGB(((r + m) * 255).roundToInt(), ((g + m) * 255).roundToInt(), ((b + m) * 255).roundToInt())
    }

    fun rgbToHsv(rgb: RGB): HSV {
        val r = rgb.r / 255f; val g = rgb.g / 255f; val b = rgb.b / 255f
        val mx = max(r, max(g, b)); val mn = min(r, min(g, b))
        val d = mx - mn
        var h = 0f
        if (d != 0f) {
            h = when (mx) {
                r -> 60f * (((g - b) / d) % 6f)
                g -> 60f * ((b - r) / d + 2f)
                else -> 60f * ((r - g) / d + 4f)
            }
        }
        if (h < 0) h += 360f
        return HSV(h, if (mx == 0f) 0f else d / mx, mx)
    }

    fun mirekToKelvin(mirek: Int): Int = (1_000_000.0 / mirek).roundToInt()
    fun kelvinToMirek(kelvin: Int): Int = (1_000_000.0 / kelvin).roundToInt()

    /** Tanner Helland's black-body approximation, used for white swatches and the CT slider track. */
    fun kelvinToRgb(kelvin: Int): RGB {
        val t = kelvin.coerceIn(1000, 40000) / 100.0
        val r: Double; val g: Double; val b: Double
        if (t <= 66) {
            r = 255.0
            g = 99.4708025861 * ln(t) - 161.1195681661
            b = if (t <= 19) 0.0 else 138.5177312231 * ln(t - 10) - 305.0447927307
        } else {
            r = 329.698727446 * (t - 60).pow(-0.1332047592)
            g = 288.1221695283 * (t - 60).pow(-0.0755148492)
            b = 255.0
        }
        return RGB(r.roundToInt().coerceIn(0, 255), g.roundToInt().coerceIn(0, 255), b.roundToInt().coerceIn(0, 255))
    }

    fun mirekToHex(mirek: Int): String = kelvinToRgb(mirekToKelvin(mirek)).toHex()
}
