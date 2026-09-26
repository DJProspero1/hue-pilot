package pt.prospero.huepilot.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import pt.prospero.huepilot.R
import pt.prospero.huepilot.data.settings.ThemeMode

// -----------------------------------------------------------------------------
// Hue Pilot design language
//
// Warm, near-black dark theme (the default look of a lighting app used at night) and a warm
// off-white light theme. One amber accent; everything else that is coloured on screen comes
// from the actual colour of the lights ("ambient" surfaces). Material You colours are opt-in.
// -----------------------------------------------------------------------------

/** Brand colours shared by the app and the home-screen widgets. */
object HuePalette {
    val Amber = Color(0xFFFFB454)
    val AmberDeep = Color(0xFFC7742A)
    val AmberDark = Color(0xFF3D2A0A)
    val AmberPale = Color(0xFFFFE3C2)

    val Night = Color(0xFF0F0E0C)
    val NightSurface = Color(0xFF171512)
    val NightCard = Color(0xFF1E1B17)
    val NightCardHigh = Color(0xFF272319)
    val NightCardHighest = Color(0xFF2F2A20)
    val NightOutline = Color(0xFF3B352C)
    val NightText = Color(0xFFF5EFE6)
    val NightTextMuted = Color(0xFFA89F92)

    val Day = Color(0xFFF7F3EC)
    val DaySurface = Color(0xFFFFFDF9)
    val DayCard = Color(0xFFF0EBE2)
    val DayCardHigh = Color(0xFFE8E2D7)
    val DayCardHighest = Color(0xFFE0D9CC)
    val DayOutline = Color(0xFFD9D1C5)
    val DayText = Color(0xFF1C1915)
    val DayTextMuted = Color(0xFF6B6357)

    val Success = Color(0xFF5BD39B)
    val Danger = Color(0xFFFF6B6B)

    /** Warm white that stands in for "on" when a light has no colour information. */
    val WarmWhite = Color(0xFFFFD9A3)
}

private val DarkScheme: ColorScheme = darkColorScheme(
    primary = HuePalette.Amber,
    onPrimary = Color(0xFF2A1600),
    primaryContainer = HuePalette.AmberDark,
    onPrimaryContainer = HuePalette.AmberPale,
    secondary = Color(0xFFE2C7A8),
    onSecondary = Color(0xFF3B2A14),
    secondaryContainer = Color(0xFF3A3024),
    onSecondaryContainer = Color(0xFFF2E3CF),
    tertiary = Color(0xFF8FD3C4),
    onTertiary = Color(0xFF07352D),
    tertiaryContainer = Color(0xFF1F4A42),
    onTertiaryContainer = Color(0xFFB8F0E2),
    background = HuePalette.Night,
    onBackground = HuePalette.NightText,
    surface = HuePalette.Night,
    onSurface = HuePalette.NightText,
    surfaceVariant = HuePalette.NightCardHigh,
    onSurfaceVariant = HuePalette.NightTextMuted,
    surfaceContainerLowest = Color(0xFF0B0A08),
    surfaceContainerLow = HuePalette.NightSurface,
    surfaceContainer = HuePalette.NightCard,
    surfaceContainerHigh = HuePalette.NightCardHigh,
    surfaceContainerHighest = HuePalette.NightCardHighest,
    surfaceBright = Color(0xFF3A3428),
    surfaceDim = HuePalette.Night,
    outline = Color(0xFF6B6255),
    outlineVariant = HuePalette.NightOutline,
    inverseSurface = HuePalette.NightText,
    inverseOnSurface = HuePalette.Night,
    inversePrimary = HuePalette.AmberDeep,
    error = HuePalette.Danger,
    onError = Color(0xFF3B0000),
    errorContainer = Color(0xFF4A1A1A),
    onErrorContainer = Color(0xFFFFD6D6),
    scrim = Color.Black,
)

private val LightScheme: ColorScheme = lightColorScheme(
    primary = HuePalette.AmberDeep,
    onPrimary = Color.White,
    primaryContainer = HuePalette.AmberPale,
    onPrimaryContainer = Color(0xFF3B2100),
    secondary = Color(0xFF7A5C3C),
    onSecondary = Color.White,
    secondaryContainer = Color(0xFFF3E4D0),
    onSecondaryContainer = Color(0xFF2E1D0A),
    tertiary = Color(0xFF2C6B60),
    onTertiary = Color.White,
    tertiaryContainer = Color(0xFFC9EFE5),
    onTertiaryContainer = Color(0xFF07352D),
    background = HuePalette.Day,
    onBackground = HuePalette.DayText,
    surface = HuePalette.Day,
    onSurface = HuePalette.DayText,
    surfaceVariant = HuePalette.DayCardHigh,
    onSurfaceVariant = HuePalette.DayTextMuted,
    surfaceContainerLowest = Color.White,
    surfaceContainerLow = HuePalette.DaySurface,
    surfaceContainer = HuePalette.DayCard,
    surfaceContainerHigh = HuePalette.DayCardHigh,
    surfaceContainerHighest = HuePalette.DayCardHighest,
    surfaceBright = Color.White,
    surfaceDim = Color(0xFFE6E0D6),
    outline = Color(0xFF9A9083),
    outlineVariant = HuePalette.DayOutline,
    inverseSurface = HuePalette.DayText,
    inverseOnSurface = HuePalette.Day,
    inversePrimary = HuePalette.Amber,
    error = Color(0xFFBA1A1A),
    onError = Color.White,
    errorContainer = Color(0xFFFFDAD6),
    onErrorContainer = Color(0xFF410002),
    scrim = Color.Black,
)

@OptIn(androidx.compose.ui.text.ExperimentalTextApi::class)
private fun manrope(weight: Int) = Font(
    R.font.manrope,
    weight = FontWeight(weight),
    variationSettings = FontVariation.Settings(FontVariation.weight(weight)),
)

/** Manrope variable font (geometric, friendly, excellent at large display sizes). */
val Manrope = FontFamily(manrope(400), manrope(500), manrope(600), manrope(700), manrope(800))

private fun style(size: Int, weight: FontWeight, lineHeight: Int, letterSpacing: Float = 0f) = TextStyle(
    fontFamily = Manrope,
    fontSize = size.sp,
    fontWeight = weight,
    lineHeight = lineHeight.sp,
    letterSpacing = letterSpacing.sp,
)

val HueTypography = Typography(
    displayLarge = style(52, FontWeight.ExtraBold, 56, -1.5f),
    displayMedium = style(40, FontWeight.ExtraBold, 44, -1f),
    displaySmall = style(32, FontWeight.Bold, 38, -0.6f),
    headlineLarge = style(30, FontWeight.Bold, 36, -0.5f),
    headlineMedium = style(26, FontWeight.Bold, 32, -0.4f),
    headlineSmall = style(22, FontWeight.Bold, 28, -0.2f),
    titleLarge = style(20, FontWeight.Bold, 26, -0.2f),
    titleMedium = style(17, FontWeight.SemiBold, 22),
    titleSmall = style(15, FontWeight.SemiBold, 20),
    bodyLarge = style(16, FontWeight.Medium, 24),
    bodyMedium = style(14, FontWeight.Medium, 20),
    bodySmall = style(12, FontWeight.Medium, 16),
    labelLarge = style(14, FontWeight.SemiBold, 20),
    labelMedium = style(12, FontWeight.SemiBold, 16, 0.2f),
    labelSmall = style(11, FontWeight.SemiBold, 14, 0.3f),
)

val HueShapes = Shapes(
    extraSmall = RoundedCornerShape(8.dp),
    small = RoundedCornerShape(12.dp),
    medium = RoundedCornerShape(18.dp),
    large = RoundedCornerShape(24.dp),
    extraLarge = RoundedCornerShape(32.dp),
)

/** Extra, non-Material tokens the screens rely on. */
data class HueTokens(
    val dark: Boolean,
    /** Alpha used when a light's colour tints a card ("ambient" surfaces). */
    val tintAlpha: Float,
    /** Alpha of the glow behind a lit icon. */
    val glowAlpha: Float,
    val cardRadius: androidx.compose.ui.unit.Dp = 24.dp,
    val tileRadius: androidx.compose.ui.unit.Dp = 20.dp,
    val pillRadius: androidx.compose.ui.unit.Dp = 999.dp,
)

val LocalHueTokens = staticCompositionLocalOf { HueTokens(dark = true, tintAlpha = 0.22f, glowAlpha = 0.35f) }

val hueTokens: HueTokens
    @Composable @ReadOnlyComposable get() = LocalHueTokens.current

@Composable
fun isDarkTheme(mode: ThemeMode): Boolean = when (mode) {
    ThemeMode.SYSTEM -> isSystemInDarkTheme()
    ThemeMode.LIGHT -> false
    ThemeMode.DARK -> true
}

@Composable
fun HuePilotTheme(mode: ThemeMode = ThemeMode.SYSTEM, useWallpaperColors: Boolean = false, content: @Composable () -> Unit) {
    val dark = isDarkTheme(mode)
    val context = LocalContext.current
    val scheme = when {
        useWallpaperColors && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ->
            if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        dark -> DarkScheme
        else -> LightScheme
    }
    val tokens = HueTokens(dark = dark, tintAlpha = if (dark) 0.26f else 0.34f, glowAlpha = if (dark) 0.38f else 0.28f)
    CompositionLocalProvider(LocalHueTokens provides tokens) {
        MaterialTheme(colorScheme = scheme, typography = HueTypography, shapes = HueShapes, content = content)
    }
}
