package pt.prospero.huepilot.domain

import kotlin.math.roundToInt

/** Result of parsing a free-form colour: either a chromatic xy or a white colour temperature. */
data class ParsedColor(val xy: XY? = null, val mirek: Int? = null, val hex: String, val label: String)

/** Named colours and white presets shared with the desktop app / MCP server contract. */
object ColorNames {
    val COLOR_NAMES: Map<String, String> = linkedMapOf(
        "red" to "#ff0000",
        "crimson" to "#dc143c",
        "orange" to "#ff7a00",
        "amber" to "#ffbf00",
        "yellow" to "#ffe600",
        "gold" to "#ffd700",
        "lime" to "#8cff00",
        "green" to "#00ff40",
        "mint" to "#5dffb0",
        "teal" to "#00c8b4",
        "turquoise" to "#40e0d0",
        "cyan" to "#00ffff",
        "aqua" to "#00e5ff",
        "sky blue" to "#5ec8ff",
        "blue" to "#0040ff",
        "navy" to "#001880",
        "indigo" to "#4b0082",
        "violet" to "#8a2be2",
        "purple" to "#a020f0",
        "lavender" to "#b57edc",
        "magenta" to "#ff00ff",
        "pink" to "#ff69b4",
        "hot pink" to "#ff1493",
        "rose" to "#ff007f",
        "salmon" to "#fa8072",
        "coral" to "#ff7f50",
        "peach" to "#ffb07c",
        "white" to "#ffffff",
    )

    val WHITE_PRESETS: Map<String, Int> = linkedMapOf(
        "candlelight" to 2000,
        "candle" to 2000,
        "very warm" to 2200,
        "relax" to 2237,
        "warm white" to 2700,
        "warm" to 2700,
        "cozy" to 2700,
        "cosy" to 2700,
        "read" to 3000,
        "reading" to 3000,
        "soft white" to 3000,
        "neutral" to 3500,
        "neutral white" to 3500,
        "cool white" to 4000,
        "cool" to 4000,
        "concentrate" to 4292,
        "bright" to 4300,
        "energize" to 6410,
        "energise" to 6410,
        "daylight" to 6500,
        "cold white" to 6500,
    )

    /** Quick palette shown in the light detail screen (label -> hex). */
    val QUICK_PALETTE: List<Pair<String, String>> = listOf(
        "Warm" to "#ffb46b", "Relax" to "#ffd7a3", "Neutral" to "#fff1dd", "Cool" to "#e6f0ff",
        "Red" to "#ff2b2b", "Orange" to "#ff7a00", "Amber" to "#ffbf00", "Yellow" to "#ffe600",
        "Lime" to "#8cff00", "Green" to "#00ff40", "Teal" to "#00c8b4", "Cyan" to "#00e5ff",
        "Sky" to "#5ec8ff", "Blue" to "#0040ff", "Indigo" to "#4b0082", "Purple" to "#a020f0",
        "Lavender" to "#b57edc", "Magenta" to "#ff00ff", "Pink" to "#ff69b4", "Rose" to "#ff007f",
    )

    private val kelvinRegex = Regex("^(\\d{3,5})\\s*k(elvin)?$")
    private val mirekRegex = Regex("^(\\d{3})\\s*(mirek|mired)$")

    private fun presetFor(s: String): Int? = WHITE_PRESETS[s] ?: WHITE_PRESETS[s.replace(Regex("\\s*white$"), "")]

    /** Parse "#ff8800", "red", "warm white", "2700K", "300 mirek". */
    fun parseColor(input: String?, gamut: Gamut = ColorMath.GAMUT_C): ParsedColor? {
        val s = input?.trim()?.lowercase() ?: return null
        if (s.isEmpty()) return null
        kelvinRegex.find(s)?.let { m ->
            val k = m.groupValues[1].toInt().coerceIn(2000, 6535)
            return ParsedColor(mirek = ColorMath.kelvinToMirek(k), hex = ColorMath.kelvinToRgb(k).toHex(), label = "${k}K")
        }
        mirekRegex.find(s)?.let { m ->
            val mk = m.groupValues[1].toInt().coerceIn(153, 500)
            return ParsedColor(mirek = mk, hex = ColorMath.mirekToHex(mk), label = "${ColorMath.mirekToKelvin(mk)}K")
        }
        presetFor(s)?.let { k ->
            return ParsedColor(mirek = ColorMath.kelvinToMirek(k), hex = ColorMath.kelvinToRgb(k).toHex(), label = s)
        }
        val named = COLOR_NAMES[s]
        val hex = named ?: (if (ColorMath.hexToRgb(s) != null) (if (s.startsWith("#")) s else "#$s") else null)
        hex ?: return null
        val rgb = ColorMath.hexToRgb(hex) ?: return null
        return ParsedColor(xy = ColorMath.rgbToXy(rgb, gamut), hex = rgb.toHex(), label = if (named != null) s else hex)
    }

    /** Parse "warm", "3000K", 3000 (Kelvin) or 250 (mirek) into mirek. */
    fun parseColorTemperature(input: Any?): Int? {
        when (input) {
            null -> return null
            is Number -> {
                val v = input.toDouble()
                if (v >= 153 && v <= 500) return v.roundToInt()
                if (v >= 1000 && v <= 10000) return ColorMath.kelvinToMirek(v.roundToInt()).coerceIn(153, 500)
                return null
            }
            else -> {
                val s = input.toString().trim().lowercase()
                if (s.isEmpty()) return null
                val numeric = s.replace(Regex("k(elvin)?$"), "").trim().toDoubleOrNull()
                if (numeric != null) return parseColorTemperature(numeric)
                presetFor(s)?.let { return ColorMath.kelvinToMirek(it).coerceIn(153, 500) }
                return null
            }
        }
    }
}
