package pt.prospero.huepilot.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import pt.prospero.huepilot.domain.ColorMath
import kotlin.math.roundToInt

fun hexColor(hex: String): Color {
    val rgb = ColorMath.hexToRgb(hex) ?: return Color(0xFFFFD9A3)
    return Color(rgb.r, rgb.g, rgb.b)
}

/** Small row of colour dots (max [max]). */
@Composable
fun ColorDots(hexes: List<String>, modifier: Modifier = Modifier, size: Dp = 12.dp, max: Int = 6) {
    Row(modifier = modifier, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        hexes.take(max).forEach { hex ->
            Box(
                modifier = Modifier
                    .size(size)
                    .background(hexColor(hex), CircleShape)
                    .border(0.5.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.4f), CircleShape)
            )
        }
    }
}

/**
 * Brightness slider with a local value while dragging; [onCommit] is called when the drag ends
 * (and also throttled while dragging so the light follows the finger).
 */
@Composable
fun BrightnessSlider(
    value: Double,
    enabled: Boolean = true,
    modifier: Modifier = Modifier,
    showLabel: Boolean = true,
    onCommit: (Double) -> Unit,
) {
    var local by remember { mutableFloatStateOf(value.toFloat()) }
    var dragging by remember { mutableStateOf(false) }
    LaunchedEffect(value) { if (!dragging) local = value.toFloat() }
    var lastSent by remember { mutableStateOf(0L) }
    Row(modifier = modifier, verticalAlignment = Alignment.CenterVertically) {
        Slider(
            value = local,
            onValueChange = { v ->
                dragging = true
                local = v
                val now = System.currentTimeMillis()
                if (now - lastSent > 250) { lastSent = now; onCommit(v.toDouble()) }
            },
            onValueChangeFinished = {
                dragging = false
                onCommit(local.toDouble())
            },
            valueRange = 1f..100f,
            enabled = enabled,
            modifier = Modifier.weight(1f),
            colors = SliderDefaults.colors(),
        )
        if (showLabel) {
            Spacer(Modifier.size(8.dp))
            Text(
                "${local.roundToInt()}%",
                style = MaterialTheme.typography.labelLarge,
                modifier = Modifier.padding(end = 4.dp),
                textAlign = TextAlign.End,
            )
        }
    }
}

/** Colour temperature slider from warm to cool with a black-body gradient track (values in mirek). */
@Composable
fun ColorTemperatureSlider(
    mirek: Int,
    mirekMin: Int,
    mirekMax: Int,
    enabled: Boolean = true,
    modifier: Modifier = Modifier,
    onCommit: (Int) -> Unit,
) {
    // Slider goes warm (left, high mirek) -> cool (right, low mirek), i.e. increasing Kelvin.
    val kMin = ColorMath.mirekToKelvin(mirekMax).toFloat()
    val kMax = ColorMath.mirekToKelvin(mirekMin).toFloat()
    val currentK = ColorMath.mirekToKelvin(mirek.coerceIn(mirekMin, mirekMax)).toFloat()
    var local by remember { mutableFloatStateOf(currentK) }
    var dragging by remember { mutableStateOf(false) }
    LaunchedEffect(currentK) { if (!dragging) local = currentK }
    val stops = remember(kMin, kMax) {
        (0..8).map { i ->
            val k = kMin + (kMax - kMin) * i / 8f
            hexColor(ColorMath.kelvinToRgb(k.roundToInt()).toHex())
        }
    }
    Column(modifier) {
        Box(contentAlignment = Alignment.Center) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp)
                    .height(16.dp)
                    .background(Brush.horizontalGradient(stops), CircleShape)
                    .border(0.5.dp, MaterialTheme.colorScheme.outline.copy(alpha = 0.4f), CircleShape)
            )
            Slider(
                value = local,
                onValueChange = { dragging = true; local = it },
                onValueChangeFinished = {
                    dragging = false
                    onCommit(ColorMath.kelvinToMirek(local.roundToInt()).coerceIn(mirekMin, mirekMax))
                },
                valueRange = kMin..kMax,
                enabled = enabled,
                colors = SliderDefaults.colors(
                    activeTrackColor = Color.Transparent,
                    inactiveTrackColor = Color.Transparent,
                    thumbColor = MaterialTheme.colorScheme.onSurface,
                ),
            )
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Text("${kMin.roundToInt()} K", style = MaterialTheme.typography.labelSmall)
            Text("${local.roundToInt()} K", style = MaterialTheme.typography.labelLarge)
            Text("${kMax.roundToInt()} K", style = MaterialTheme.typography.labelSmall)
        }
    }
}

/** Simple text input dialog used for rename / save-as-scene. */
@Composable
fun TextInputDialog(
    title: String,
    initial: String,
    confirmLabel: String = "Save",
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    var text by rememberSaveable { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            OutlinedTextField(value = text, onValueChange = { text = it }, singleLine = true, modifier = Modifier.fillMaxWidth())
        },
        confirmButton = { TextButton(onClick = { onConfirm(text.trim()) }, enabled = text.isNotBlank()) { Text(confirmLabel) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
fun ConfirmDialog(title: String, text: String, confirmLabel: String = "Delete", onDismiss: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = { Text(text) },
        confirmButton = { TextButton(onClick = onConfirm) { Text(confirmLabel) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

@Composable
fun EmptyState(title: String, subtitle: String? = null, modifier: Modifier = Modifier) {
    Column(modifier = modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(title, style = MaterialTheme.typography.titleMedium, textAlign = TextAlign.Center)
        if (subtitle != null) {
            Spacer(Modifier.height(8.dp))
            Text(subtitle, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        }
    }
}
