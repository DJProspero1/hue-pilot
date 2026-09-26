package pt.prospero.huepilot.widget

import android.app.Activity
import android.appwidget.AppWidgetHost
import android.appwidget.AppWidgetHostView
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.util.SizeF
import android.view.Gravity
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.io.File

/**
 * Debug-only harness: binds every widget provider in an [AppWidgetHost], lays the host views out at their
 * launcher cell sizes and (optionally) writes PNG crops of each one. Used to check the design on the
 * emulator and to produce the `widget_preview_*` drawables.
 *
 * ```
 * adb shell appwidget grantbind --package pt.prospero.huepilot --user 0
 * adb shell am start -n pt.prospero.huepilot/.widget.WidgetPreviewActivity [--es widget rooms] [--ez capture true] [--es pin rooms]
 * adb pull /sdcard/Android/data/pt.prospero.huepilot/files/widget-previews
 * ```
 * Extras: `widget` = catalog id or `all`; `capture` = save PNGs (2 px per dp) after `capture_delay` ms
 * (default 5000; use ~20000 when binding all widgets, Glance sessions take a while); `pin` = catalog id to
 * pass to [WidgetCatalog.requestPin]; `cell_w` / `cell_h` = dp per launcher cell (default 70 × 80).
 */
class WidgetPreviewActivity : ComponentActivity() {

    private class Spec(val id: String, val sizes: List<Pair<Int, Int>>, val config: (WidgetState) -> WidgetConfig = { WidgetConfig.EMPTY })
    private class Entry(val id: String, val w: Int, val h: Int, val view: AppWidgetHostView)

    private lateinit var host: AppWidgetHost
    private val ids = ArrayList<Int>()
    private val entries = ArrayList<Entry>()

    private val specs = listOf(
        Spec(WidgetCatalog.ID_ROOMS, listOf(2 to 1, 4 to 2, 4 to 4)),
        Spec(WidgetCatalog.ID_ROOM_CONTROL, listOf(4 to 2, 4 to 3)) { s ->
            val g = s.snapshot.groups.firstOrNull { g -> s.snapshot.scenes.count { it.groupId == g.id } >= 4 } ?: s.snapshot.groups.firstOrNull()
            WidgetConfig(groupId = g?.id)
        },
        Spec(WidgetCatalog.ID_SCENES, listOf(2 to 2, 3 to 2, 4 to 3)),
        Spec(WidgetCatalog.ID_HOME_STATUS, listOf(2 to 1, 4 to 1)),
        Spec(WidgetCatalog.ID_LIGHT_CONTROL, listOf(2 to 2, 4 to 2)) { s ->
            WidgetConfig(lightId = (s.snapshot.lights.firstOrNull { it.supportsColor } ?: s.snapshot.lights.firstOrNull())?.id)
        },
        Spec(WidgetCatalog.ID_ASSISTANT, listOf(1 to 1, 2 to 1)),
        Spec(WidgetCatalog.ID_SENSORS, listOf(4 to 2, 4 to 3)),
        Spec(WidgetCatalog.ID_COLOR_STRIP, listOf(4 to 1)) { s -> WidgetConfig(groupId = s.snapshot.rooms.firstOrNull()?.id) },
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        host = AppWidgetHost(this, HOST_ID)
        // Ids from earlier runs (e.g. after a force-stop) would keep being re-rendered by every update: drop them.
        host.appWidgetIds.forEach { runCatching { host.deleteAppWidgetId(it) } }
        host.startListening()
        val manager = AppWidgetManager.getInstance(this)
        val which = intent.getStringExtra("widget") ?: "all"
        val capture = intent.getBooleanExtra("capture", false)
        val captureDelay = intent.getLongExtra("capture_delay", 5000L)
        val pin = intent.getStringExtra("pin")
        val cellW = intent.getIntExtra("cell_w", 70)
        val cellH = intent.getIntExtra("cell_h", 80)
        val density = resources.displayMetrics.density

        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding((16 * density).toInt(), (24 * density).toInt(), (16 * density).toInt(), (24 * density).toInt())
        }
        val scroll = ScrollView(this).apply {
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(0xFF5B7BB5.toInt(), 0xFF8E6BAA.toInt(), 0xFFD98C6A.toInt()))
            addView(column)
        }
        setContentView(scroll)

        lifecycleScope.launch {
            val state = WidgetData.load(this@WidgetPreviewActivity)
            for (spec in specs) {
                if (which != "all" && spec.id != which) continue
                val info = WidgetCatalog.byId(spec.id) ?: continue
                for ((w, h) in spec.sizes) {
                    val wDp = w * cellW
                    val hDp = h * cellH
                    val id = host.allocateAppWidgetId()
                    ids += id
                    WidgetPrefs.save(this@WidgetPreviewActivity, id, spec.config(state))
                    val options = Bundle().apply {
                        putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, wDp)
                        putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, wDp)
                        putInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, hDp)
                        putInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, hDp)
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                            putParcelableArrayList(AppWidgetManager.OPTION_APPWIDGET_SIZES, arrayListOf(SizeF(wDp.toFloat(), hDp.toFloat())))
                        }
                    }
                    val bound = manager.bindAppWidgetIdIfAllowed(id, ComponentName(this@WidgetPreviewActivity, info.receiverClass), options)
                    column.addView(TextView(this@WidgetPreviewActivity).apply {
                        text = "${info.title} ${w}×${h}" + if (bound) "" else " — bind refused (run: adb shell appwidget grantbind --package pt.prospero.huepilot --user 0)"
                        setTextColor(Color.WHITE)
                        setPadding(0, (12 * density).toInt(), 0, (6 * density).toInt())
                    })
                    if (!bound) continue
                    val view = host.createView(this@WidgetPreviewActivity, id, manager.getAppWidgetInfo(id))
                    view.updateAppWidgetSize(null, wDp, hDp, wDp, hDp)
                    column.addView(view, LinearLayout.LayoutParams((wDp * density).toInt(), (hDp * density).toInt()))
                    entries += Entry(spec.id, w, h, view)
                }
            }
            if (pin != null) {
                WidgetCatalog.byId(pin)?.let { Log.i(TAG, "requestPin(${it.id}) = ${WidgetCatalog.requestPin(this@WidgetPreviewActivity, it)}") }
            }
            if (capture) {
                delay(captureDelay)
                captureAll(density)
            }
        }
    }

    private fun captureAll(density: Float) {
        val dir = File(getExternalFilesDir(null), "widget-previews").apply { mkdirs() }
        var n = 0
        for (e in entries) {
            val v = e.view
            if (v.width == 0 || v.height == 0) continue
            val full = Bitmap.createBitmap(v.width, v.height, Bitmap.Config.ARGB_8888)
            v.draw(Canvas(full))
            val scale = 2f / density
            val scaled = Bitmap.createScaledBitmap(full, (v.width * scale).toInt(), (v.height * scale).toInt(), true)
            File(dir, "${e.id}_${e.w}x${e.h}.png").outputStream().use { scaled.compress(Bitmap.CompressFormat.PNG, 100, it) }
            n++
        }
        Log.i(TAG, "captured $n previews to $dir")
        title = "captured $n"
    }

    override fun onDestroy() {
        super.onDestroy()
        runCatching { host.stopListening() }
        if (isFinishing) ids.forEach { runCatching { host.deleteAppWidgetId(it) } }
    }

    companion object {
        private const val TAG = "WidgetPreview"
        private const val HOST_ID = 0x4855
        @Suppress("unused") const val RESULT_NONE = Activity.RESULT_CANCELED
    }
}
