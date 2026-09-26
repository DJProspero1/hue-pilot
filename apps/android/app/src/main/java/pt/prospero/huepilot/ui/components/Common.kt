package pt.prospero.huepilot.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.layout
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import pt.prospero.huepilot.domain.ColorMath
import pt.prospero.huepilot.ui.theme.HuePalette
import pt.prospero.huepilot.ui.theme.hueTokens
import java.time.Duration
import java.time.Instant
import java.time.LocalTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.math.roundToInt

// -----------------------------------------------------------------------------
// Colour helpers
// -----------------------------------------------------------------------------

fun hexColor(hex: String): Color {
    val rgb = ColorMath.hexToRgb(hex) ?: return HuePalette.WarmWhite
    return Color(rgb.r, rgb.g, rgb.b)
}

/** Text colour that reads well on top of [this] swatch. */
fun Color.readableOn(): Color = if (luminance() > 0.45f) Color(0xFF1B1408) else Color(0xFFFFF7EC)

/**
 * Background brush of an "ambient" surface: the card takes on the colours of the lights that are on.
 * Off surfaces are a flat neutral. Colours are animated so toggling a room fades the tint in and out.
 */
@Composable
fun ambientBrush(hexes: List<String>, on: Boolean, base: Color = MaterialTheme.colorScheme.surfaceContainer): Brush {
    val tokens = hueTokens
    val lit = on && hexes.isNotEmpty()
    val c1Target = if (lit) lerp(base, hexColor(hexes[0]), tokens.tintAlpha) else base
    val c2Target = if (lit) lerp(base, hexColor(hexes.getOrElse(1) { hexes[0] }), tokens.tintAlpha * 0.55f) else base
    val c1 by animateColorAsState(c1Target, tween(450), label = "ambient1")
    val c2 by animateColorAsState(c2Target, tween(450), label = "ambient2")
    return Brush.linearGradient(listOf(c1, c2), start = Offset.Zero, end = Offset(1200f, 900f))
}

/** Card whose background reflects the colours of lit lights. */
@Composable
fun AmbientCard(
    hexes: List<String>,
    on: Boolean,
    modifier: Modifier = Modifier,
    shape: Shape = RoundedCornerShape(hueTokens.cardRadius),
    onClick: (() -> Unit)? = null,
    contentPadding: Dp = 16.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    val brush = ambientBrush(hexes, on)
    val interaction = remember { MutableInteractionSource() }
    val pressed by interaction.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) 0.975f else 1f, tween(120), label = "press")
    Column(
        modifier
            .scale(scale)
            .clip(shape)
            .background(brush)
            .then(if (onClick != null) Modifier.clickable(interactionSource = interaction, indication = null, onClick = onClick) else Modifier)
            .padding(contentPadding),
        content = content,
    )
}

/** Circular icon that lights up (and glows) in the colour of the light it represents. */
@Composable
fun GlowIcon(icon: ImageVector, color: Color, on: Boolean, modifier: Modifier = Modifier, size: Dp = 44.dp, iconSize: Dp = 22.dp) {
    val tokens = hueTokens
    val bg by animateColorAsState(if (on) color else MaterialTheme.colorScheme.surfaceContainerHighest, tween(350), label = "glowBg")
    val glow by animateFloatAsState(if (on) tokens.glowAlpha else 0f, tween(350), label = "glow")
    val tint = if (on) color.readableOn() else MaterialTheme.colorScheme.onSurfaceVariant
    Box(
        modifier
            .size(size)
            .drawBehind {
                if (glow > 0f) drawCircle(Brush.radialGradient(listOf(color.copy(alpha = glow), color.copy(alpha = 0f))), radius = this.size.minDimension * 0.95f)
            }
            .background(bg, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = null, tint = tint, modifier = Modifier.size(iconSize))
    }
}

/** Small row of colour dots (max [max]). */
@Composable
fun ColorDots(hexes: List<String>, modifier: Modifier = Modifier, size: Dp = 12.dp, max: Int = 6) {
    Row(modifier = modifier, horizontalArrangement = Arrangement.spacedBy((-size / 4))) {
        hexes.take(max).forEach { hex ->
            Box(
                Modifier
                    .size(size)
                    .background(hexColor(hex), CircleShape)
                    .border(1.5.dp, MaterialTheme.colorScheme.surfaceContainer, CircleShape),
            )
        }
    }
}

/** Scene artwork: the palette of the scene rendered as a soft gradient. */
@Composable
fun SceneArt(hexes: List<String>, modifier: Modifier = Modifier, shape: Shape = RoundedCornerShape(hueTokens.tileRadius), content: @Composable BoxScope.() -> Unit = {}) {
    val colors = hexes.map { hexColor(it) }
    val brush = when (colors.size) {
        0 -> Brush.linearGradient(listOf(MaterialTheme.colorScheme.surfaceContainerHighest, MaterialTheme.colorScheme.surfaceContainerHigh))
        1 -> Brush.linearGradient(listOf(lerp(colors[0], Color.White, 0.18f), colors[0], lerp(colors[0], Color.Black, 0.35f)))
        else -> Brush.linearGradient(colors.take(5), start = Offset.Zero, end = Offset(900f, 700f))
    }
    Box(
        modifier
            .clip(shape)
            .background(brush)
            .drawBehind {
                // Soft highlight for depth.
                drawCircle(Brush.radialGradient(listOf(Color.White.copy(alpha = 0.22f), Color.Transparent)), radius = size.maxDimension * 0.6f, center = Offset(size.width * 0.2f, size.height * 0.1f))
            },
        content = content,
    )
}

// -----------------------------------------------------------------------------
// Sliders
// -----------------------------------------------------------------------------

/** Horizontal drag/tap input returning a 0..1 fraction; [onChange] is called with `final = true` when the finger lifts. */
private fun Modifier.horizontalFractionInput(enabled: Boolean, onChange: (fraction: Float, final: Boolean) -> Unit): Modifier =
    if (!enabled) this else this
        .pointerInput(Unit) {
            detectTapGestures { pos -> onChange((pos.x / size.width).coerceIn(0f, 1f), true) }
        }
        .pointerInput(Unit) {
            detectHorizontalDragGestures(
                onDragStart = { pos -> onChange((pos.x / size.width).coerceIn(0f, 1f), false) },
                onDragEnd = { onChange(-1f, true) },
                onDragCancel = { onChange(-1f, true) },
                onHorizontalDrag = { change, _ -> change.consume(); onChange((change.position.x / size.width).coerceIn(0f, 1f), false) },
            )
        }

/**
 * Brightness slider in the Hue style: a pill that fills with the light's colour. Reports throttled
 * values while dragging (so the light follows the finger) and a final value on release.
 */
@Composable
fun FillSlider(
    value: Double,
    tint: Color,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    height: Dp = 44.dp,
    showLabel: Boolean = true,
    onCommit: (Double) -> Unit,
) {
    var local by remember { mutableFloatStateOf(value.toFloat()) }
    var dragging by remember { mutableStateOf(false) }
    var lastSent by remember { mutableLongStateOf(0L) }
    LaunchedEffect(value) { if (!dragging) local = value.toFloat() }
    val shown = remember { Animatable(value.toFloat()) }
    LaunchedEffect(local, dragging) { if (dragging) shown.snapTo(local) else shown.animateTo(local, tween(350)) }

    val track = MaterialTheme.colorScheme.surfaceContainerHighest
    val handle = Color.White.copy(alpha = 0.85f)
    val alpha = if (enabled) 1f else 0.45f

    fun set(fraction: Float, final: Boolean) {
        if (fraction >= 0f) local = (1f + fraction * 99f).coerceIn(1f, 100f)
        if (final) {
            dragging = false
            onCommit(local.roundToInt().toDouble())
        } else {
            dragging = true
            val now = System.currentTimeMillis()
            if (now - lastSent > 220) { lastSent = now; onCommit(local.roundToInt().toDouble()) }
        }
    }

    Row(modifier.height(height), verticalAlignment = Alignment.CenterVertically) {
        Canvas(
            Modifier
                .weight(1f)
                .height(height)
                .horizontalFractionInput(enabled) { f, final -> set(f, final) },
        ) {
            val r = CornerRadius(size.height / 2f)
            val frac = ((shown.value - 1f) / 99f).coerceIn(0f, 1f)
            val fillW = size.height + (size.width - size.height) * frac
            drawRoundRect(track.copy(alpha = track.alpha * alpha), cornerRadius = r)
            clipRect(right = fillW) {
                drawRoundRect(Brush.horizontalGradient(listOf(lerp(tint, Color.Black, 0.12f), tint), endX = size.width), cornerRadius = r, alpha = alpha)
            }
            val hx = (fillW - size.height * 0.42f).coerceAtLeast(size.height * 0.42f)
            drawRoundRect(handle, topLeft = Offset(hx - 2.dp.toPx(), size.height * 0.28f), size = Size(4.dp.toPx(), size.height * 0.44f), cornerRadius = CornerRadius(2.dp.toPx()), alpha = alpha)
        }
        if (showLabel) {
            Text(
                "${shown.value.roundToInt()}%",
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.width(52.dp),
                textAlign = TextAlign.End,
                color = MaterialTheme.colorScheme.onSurface.copy(alpha = alpha),
            )
        }
    }
}

/** Colour temperature slider: a warm→cool gradient pill with a ring handle (values in mirek). */
@Composable
fun ColorTemperatureSlider(
    mirek: Int,
    mirekMin: Int,
    mirekMax: Int,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    height: Dp = 44.dp,
    onCommit: (Int) -> Unit,
) {
    val kMin = ColorMath.mirekToKelvin(mirekMax).toFloat()
    val kMax = ColorMath.mirekToKelvin(mirekMin).toFloat()
    val currentK = ColorMath.mirekToKelvin(mirek.coerceIn(mirekMin, mirekMax)).toFloat()
    var local by remember { mutableFloatStateOf(currentK) }
    var dragging by remember { mutableStateOf(false) }
    var lastSent by remember { mutableLongStateOf(0L) }
    LaunchedEffect(currentK) { if (!dragging) local = currentK }
    val stops = remember(kMin, kMax) { (0..10).map { i -> hexColor(ColorMath.kelvinToRgb((kMin + (kMax - kMin) * i / 10f).roundToInt()).toHex()) } }
    val outline = MaterialTheme.colorScheme.outlineVariant

    fun set(fraction: Float, final: Boolean) {
        if (fraction >= 0f) local = kMin + (kMax - kMin) * fraction
        val m = ColorMath.kelvinToMirek(local.roundToInt()).coerceIn(mirekMin, mirekMax)
        if (final) { dragging = false; onCommit(m) } else {
            dragging = true
            val now = System.currentTimeMillis()
            if (now - lastSent > 250) { lastSent = now; onCommit(m) }
        }
    }

    Column(modifier) {
        Canvas(
            Modifier
                .fillMaxWidth()
                .height(height)
                .horizontalFractionInput(enabled) { f, final -> set(f, final) },
        ) {
            val r = CornerRadius(size.height / 2f)
            drawRoundRect(Brush.horizontalGradient(stops), cornerRadius = r)
            drawRoundRect(outline, cornerRadius = r, style = Stroke(1.dp.toPx()))
            val frac = ((local - kMin) / (kMax - kMin)).coerceIn(0f, 1f)
            val cx = size.height / 2f + (size.width - size.height) * frac
            val ring = size.height * 0.36f
            drawCircle(Color.Black.copy(alpha = 0.25f), radius = ring + 2.dp.toPx(), center = Offset(cx, size.height / 2f + 1.dp.toPx()))
            drawCircle(hexColor(ColorMath.kelvinToRgb(local.roundToInt()).toHex()), radius = ring, center = Offset(cx, size.height / 2f))
            drawCircle(Color.White, radius = ring, center = Offset(cx, size.height / 2f), style = Stroke(3.dp.toPx()))
        }
        Row(Modifier.fillMaxWidth().padding(top = 6.dp, start = 4.dp, end = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("${kMin.roundToInt()} K", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text("${local.roundToInt()} K", style = MaterialTheme.typography.labelLarge)
            Text("${kMax.roundToInt()} K", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

// -----------------------------------------------------------------------------
// Small building blocks
// -----------------------------------------------------------------------------

@Composable
fun HueSwitch(checked: Boolean, onCheckedChange: (Boolean) -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    Switch(
        checked = checked,
        onCheckedChange = onCheckedChange,
        enabled = enabled,
        modifier = modifier,
        colors = SwitchDefaults.colors(
            checkedThumbColor = MaterialTheme.colorScheme.onPrimary,
            checkedTrackColor = MaterialTheme.colorScheme.primary,
            uncheckedThumbColor = MaterialTheme.colorScheme.onSurfaceVariant,
            uncheckedTrackColor = MaterialTheme.colorScheme.surfaceContainerHighest,
            uncheckedBorderColor = Color.Transparent,
        ),
    )
}

/** Round icon button used in headers. */
@Composable
fun CircleIconButton(icon: ImageVector, contentDescription: String?, onClick: () -> Unit, modifier: Modifier = Modifier, tint: Color = MaterialTheme.colorScheme.onSurface, container: Color = MaterialTheme.colorScheme.surfaceContainer, size: Dp = 42.dp) {
    Box(
        modifier
            .size(size)
            .clip(CircleShape)
            .background(container)
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = contentDescription, tint = tint, modifier = Modifier.size(size * 0.5f))
    }
}

/** Large screen header: optional back button, a big title, an optional subtitle and trailing actions. */
@Composable
fun ScreenHeader(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    eyebrow: String? = null,
    onBack: (() -> Unit)? = null,
    horizontalPadding: Dp = 20.dp,
    actions: @Composable RowScope.() -> Unit = {},
) {
    Column(modifier.fillMaxWidth().padding(horizontal = horizontalPadding, vertical = 12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            if (onBack != null) {
                CircleIconButton(Icons.AutoMirrored.Rounded.ArrowBack, "Back", onBack)
                Spacer(Modifier.width(12.dp))
            }
            Column(Modifier.weight(1f)) {
                if (eyebrow != null) Text(eyebrow.uppercase(), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                Text(title, style = if (onBack == null) MaterialTheme.typography.headlineLarge else MaterialTheme.typography.headlineSmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (subtitle != null) Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically, content = actions)
        }
    }
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier, count: Int? = null, horizontalPadding: Dp = 20.dp, trailing: (@Composable () -> Unit)? = null) {
    Row(modifier.fillMaxWidth().padding(horizontal = horizontalPadding, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(text, style = MaterialTheme.typography.titleMedium)
        if (count != null) {
            Spacer(Modifier.width(8.dp))
            Text("$count", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Spacer(Modifier.weight(1f))
        trailing?.invoke()
    }
}

/** Small status chip ("Motion", "72%", "Live"). */
@Composable
fun StatusPill(text: String, modifier: Modifier = Modifier, color: Color = MaterialTheme.colorScheme.onSurfaceVariant, container: Color = MaterialTheme.colorScheme.surfaceContainerHigh, icon: ImageVector? = null) {
    Row(
        modifier.background(container, CircleShape).padding(horizontal = 10.dp, vertical = 5.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = null, tint = color, modifier = Modifier.size(14.dp))
            Spacer(Modifier.width(5.dp))
        }
        Text(text, style = MaterialTheme.typography.labelMedium, color = color, maxLines = 1)
    }
}

/** Segmented pill tabs. */
@Composable
fun PillTabs(options: List<String>, selected: Int, onSelect: (Int) -> Unit, modifier: Modifier = Modifier) {
    Row(modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surfaceContainer, CircleShape).padding(4.dp)) {
        options.forEachIndexed { i, label ->
            val active = i == selected
            val bg by animateColorAsState(if (active) MaterialTheme.colorScheme.primaryContainer else Color.Transparent, tween(200), label = "tab")
            Box(
                Modifier
                    .weight(1f)
                    .clip(CircleShape)
                    .background(bg)
                    .clickable { onSelect(i) }
                    .padding(vertical = 10.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(label, style = MaterialTheme.typography.labelLarge, color = if (active) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** Row of colour swatches ("quick colours"). */
@Composable
fun SwatchRow(swatches: List<Pair<String, String>>, modifier: Modifier = Modifier, size: Dp = 40.dp, showLabels: Boolean = true, contentPadding: Dp = 0.dp, onPick: (label: String, hex: String) -> Unit) {
    Row(modifier.padding(horizontal = contentPadding), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        swatches.forEach { (label, hex) ->
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.clip(RoundedCornerShape(12.dp)).clickable { onPick(label, hex) }.padding(2.dp)) {
                Box(
                    Modifier
                        .size(size)
                        .drawBehind { drawCircle(hexColor(hex).copy(alpha = 0.35f), radius = size.toPx() * 0.62f) }
                        .background(hexColor(hex), CircleShape)
                        .border(1.dp, Color.White.copy(alpha = 0.25f), CircleShape),
                )
                if (showLabels) {
                    Spacer(Modifier.height(4.dp))
                    Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
                }
            }
        }
    }
}

// -----------------------------------------------------------------------------
// Dialogs & states
// -----------------------------------------------------------------------------

@Composable
fun TextInputDialog(title: String, initial: String, confirmLabel: String = "Save", onDismiss: () -> Unit, onConfirm: (String) -> Unit) {
    var text by rememberSaveable { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { OutlinedTextField(value = text, onValueChange = { text = it }, singleLine = true, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(14.dp)) },
        confirmButton = { TextButton(onClick = { onConfirm(text.trim()) }, enabled = text.isNotBlank()) { Text(confirmLabel) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
        shape = RoundedCornerShape(24.dp),
    )
}

@Composable
fun ConfirmDialog(title: String, text: String, confirmLabel: String = "Delete", onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(text) },
        confirmButton = { TextButton(onClick = onConfirm) { Text(confirmLabel, color = MaterialTheme.colorScheme.error) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
        shape = RoundedCornerShape(24.dp),
    )
}

@Composable
fun EmptyState(title: String, subtitle: String? = null, modifier: Modifier = Modifier, icon: ImageVector? = null) {
    Column(modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        if (icon != null) {
            Box(Modifier.size(64.dp).background(MaterialTheme.colorScheme.surfaceContainerHigh, CircleShape), contentAlignment = Alignment.Center) {
                Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(28.dp))
            }
            Spacer(Modifier.height(16.dp))
        }
        Text(title, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        if (subtitle != null) {
            Spacer(Modifier.height(6.dp))
            Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        }
    }
}

// -----------------------------------------------------------------------------
// Text helpers
// -----------------------------------------------------------------------------

fun greeting(): String = when (LocalTime.now().hour) {
    in 5..11 -> "Good morning"
    in 12..17 -> "Good afternoon"
    in 18..22 -> "Good evening"
    else -> "Good night"
}

private val timeFmt = DateTimeFormatter.ofPattern("d MMM HH:mm")

fun relativeTime(iso: String?): String {
    if (iso.isNullOrBlank()) return "—"
    return runCatching {
        val instant = runCatching { OffsetDateTime.parse(iso).toInstant() }.getOrElse { Instant.parse(if (iso.endsWith("Z")) iso else iso + "Z") }
        val d = Duration.between(instant, Instant.now())
        when {
            d.toMinutes() < 1 -> "just now"
            d.toMinutes() < 60 -> "${d.toMinutes()} min ago"
            d.toHours() < 24 -> "${d.toHours()} h ago"
            else -> timeFmt.format(instant.atZone(ZoneId.systemDefault()))
        }
    }.getOrDefault(iso)
}

fun pluralize(n: Int, one: String, many: String = one + "s") = "$n ${if (n == 1) one else many}"

/** `SolidColor` brush helper for places that need a Brush from a Color. */
fun Color.asBrush(): Brush = SolidColor(this)

/**
 * Lets a horizontally scrolling row run edge to edge inside a padded card: the content is measured
 * [horizontal] wider on each side and shifted back, so it scrolls under the card's padding.
 */
fun Modifier.bleed(horizontal: Dp): Modifier = layout { measurable, constraints ->
    val extra = (horizontal * 2).roundToPx()
    val placeable = measurable.measure(constraints.copy(maxWidth = constraints.maxWidth + extra, minWidth = 0))
    layout(placeable.width - extra, placeable.height) { placeable.place(-horizontal.roundToPx(), 0) }
}
