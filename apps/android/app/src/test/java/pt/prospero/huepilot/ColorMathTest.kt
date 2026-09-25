package pt.prospero.huepilot

import com.google.common.truth.Truth.assertThat
import org.junit.Test
import pt.prospero.huepilot.domain.ColorMath
import pt.prospero.huepilot.domain.ColorNames
import pt.prospero.huepilot.domain.RGB
import pt.prospero.huepilot.domain.XY

class ColorMathTest {
    @Test
    fun `pure red maps to the red corner of gamut C`() {
        val xy = ColorMath.rgbToXy(RGB(255, 0, 0))
        // Philips formula gives ~ (0.7006, 0.2993) which is clipped to the gamut C red corner.
        assertThat(xy.x).isWithin(0.01).of(0.6915)
        assertThat(xy.y).isWithin(0.01).of(0.3083)
    }

    @Test
    fun `white maps near D65`() {
        val xy = ColorMath.rgbToXy(RGB(255, 255, 255))
        assertThat(xy.x).isWithin(0.01).of(0.3227)
        assertThat(xy.y).isWithin(0.01).of(0.3290)
    }

    @Test
    fun `black does not divide by zero`() {
        val xy = ColorMath.rgbToXy(RGB(0, 0, 0))
        assertThat(xy.x).isGreaterThan(0.0)
        assertThat(xy.y).isGreaterThan(0.0)
    }

    @Test
    fun `xy to rgb round trip keeps hue`() {
        val original = RGB(255, 128, 0)
        val xy = ColorMath.rgbToXy(original)
        val back = ColorMath.xyToRgb(xy, 1.0)
        // The Philips matrices are not exact inverses; a small drift is expected.
        assertThat(back.r).isEqualTo(255)
        assertThat(back.g).isWithin(12).of(128)
        assertThat(back.b).isAtMost(40)
    }

    @Test
    fun `points outside the gamut are clipped onto the triangle`() {
        val outside = XY(0.9, 0.1)
        assertThat(ColorMath.isInsideGamut(outside, ColorMath.GAMUT_C)).isFalse()
        val clipped = ColorMath.clipToGamut(outside, ColorMath.GAMUT_C)
        assertThat(ColorMath.isInsideGamut(XY(clipped.x - 1e-9 * 0, clipped.y), ColorMath.GAMUT_C) || onEdge(clipped)).isTrue()
        // Points inside are untouched.
        val inside = XY(0.3, 0.3)
        assertThat(ColorMath.clipToGamut(inside, ColorMath.GAMUT_C)).isEqualTo(inside)
    }

    private fun onEdge(p: XY): Boolean {
        val g = ColorMath.GAMUT_C
        val edges = listOf(g.red to g.green, g.green to g.blue, g.blue to g.red)
        return edges.any { (a, b) ->
            val cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
            kotlin.math.abs(cross) < 1e-6
        }
    }

    @Test
    fun `mirek and kelvin conversions`() {
        assertThat(ColorMath.mirekToKelvin(370)).isEqualTo(2703)
        assertThat(ColorMath.kelvinToMirek(2700)).isEqualTo(370)
        assertThat(ColorMath.kelvinToMirek(6500)).isEqualTo(154)
    }

    @Test
    fun `black body colours are warm at low kelvin and blueish at high kelvin`() {
        val warm = ColorMath.kelvinToRgb(2000)
        assertThat(warm.r).isEqualTo(255)
        assertThat(warm.b).isLessThan(60)
        val cool = ColorMath.kelvinToRgb(10000)
        assertThat(cool.b).isEqualTo(255)
        assertThat(cool.r).isLessThan(230)
        val neutral = ColorMath.kelvinToRgb(6600)
        assertThat(neutral.r).isEqualTo(255)
        assertThat(neutral.g).isAtLeast(250)
    }

    @Test
    fun `hex parsing and formatting`() {
        assertThat(ColorMath.hexToRgb("#ff8800")).isEqualTo(RGB(255, 136, 0))
        assertThat(ColorMath.hexToRgb("f80")).isEqualTo(RGB(255, 136, 0))
        assertThat(ColorMath.hexToRgb("nope")).isNull()
        assertThat(RGB(255, 136, 0).toHex()).isEqualTo("#ff8800")
    }

    @Test
    fun `hsv round trip`() {
        val rgb = RGB(30, 200, 120)
        val hsv = ColorMath.rgbToHsv(rgb)
        val back = ColorMath.hsvToRgb(hsv)
        assertThat(back).isEqualTo(rgb)
    }

    @Test
    fun `colour names and white presets parse`() {
        val red = ColorNames.parseColor("Red")!!
        assertThat(red.xy).isNotNull()
        assertThat(red.hex).isEqualTo("#ff0000")

        val warm = ColorNames.parseColor("warm white")!!
        assertThat(warm.mirek).isEqualTo(370)
        assertThat(warm.xy).isNull()

        val k = ColorNames.parseColor("3000K")!!
        assertThat(k.mirek).isEqualTo(333)

        val hex = ColorNames.parseColor("#00ff40")!!
        assertThat(hex.xy).isNotNull()

        assertThat(ColorNames.parseColor("not a colour")).isNull()
    }

    @Test
    fun `colour temperature parsing accepts presets kelvin and mirek`() {
        assertThat(ColorNames.parseColorTemperature("relax")).isEqualTo(447)
        assertThat(ColorNames.parseColorTemperature("3000K")).isEqualTo(333)
        assertThat(ColorNames.parseColorTemperature(4000)).isEqualTo(250)
        assertThat(ColorNames.parseColorTemperature(300)).isEqualTo(300)
        assertThat(ColorNames.parseColorTemperature("cool white")).isEqualTo(250)
        assertThat(ColorNames.parseColorTemperature("daylight")).isEqualTo(154)
        assertThat(ColorNames.parseColorTemperature("banana")).isNull()
    }
}
