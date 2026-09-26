package pt.prospero.huepilot.widget

import android.content.Context
import android.util.Log
import androidx.glance.GlanceId
import androidx.glance.action.Action
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.jsonPrimitive
import pt.prospero.huepilot.appContainer
import pt.prospero.huepilot.domain.ColorNames

/**
 * Every bridge write a widget can perform. Writes go through the app's repository (optimistic local
 * patch + PUT); afterwards every widget is re-rendered, the changed resource types are re-fetched from
 * the bridge and, if anything differs, the widgets are rendered once more.
 */
object WidgetActions {
    private const val TAG = "WidgetActions"

    const val TOGGLE_GROUP = "toggle_group"
    const val GROUP_ON = "group_on"
    const val GROUP_BRIGHTNESS = "group_bri"
    const val GROUP_BRIGHTNESS_DELTA = "group_bri_delta"
    const val GROUP_COLOR = "group_color"
    const val SCENE = "scene"
    const val ALL_LIGHTS = "all"
    const val TOGGLE_LIGHT = "toggle_light"
    const val LIGHT_BRIGHTNESS_DELTA = "light_bri_delta"
    const val LIGHT_COLOR = "light_color"
    const val REFRESH = "refresh"

    suspend fun perform(context: Context, op: String, id: String?, arg: String?, arg2: String?) {
        val app = context.applicationContext
        if (op == REFRESH) {
            WidgetData.load(app, forceRefresh = true)
            WidgetUpdater.updateAllNow(app)
            return
        }
        val state = WidgetData.load(app)
        if (!state.paired) return
        val snap = state.snapshot
        val repo = app.appContainer.repository
        val touched: List<String> = runCatching {
            when (op) {
                TOGGLE_GROUP -> {
                    val g = snap.group(id.orEmpty()) ?: return
                    repo.setGroupOn(g.groupedLightId ?: return, !g.on)
                    GROUP_TYPES
                }
                GROUP_ON -> {
                    val g = snap.group(id.orEmpty()) ?: return
                    repo.setGroupOn(g.groupedLightId ?: return, arg.toBoolean())
                    GROUP_TYPES
                }
                GROUP_BRIGHTNESS -> {
                    val g = snap.group(id.orEmpty()) ?: return
                    repo.setGroupBrightness(g.groupedLightId ?: return, arg?.toDoubleOrNull() ?: return)
                    GROUP_TYPES
                }
                GROUP_BRIGHTNESS_DELTA -> {
                    val g = snap.group(id.orEmpty()) ?: return
                    val delta = arg?.toDoubleOrNull() ?: return
                    val current = if (g.on) g.brightness else 0.0
                    repo.setGroupBrightness(g.groupedLightId ?: return, (current + delta).coerceIn(1.0, 100.0))
                    GROUP_TYPES
                }
                GROUP_COLOR -> {
                    val g = snap.group(id.orEmpty()) ?: return
                    val parsed = ColorNames.parseColor(arg2) ?: ColorNames.parseColor(arg) ?: return
                    repo.setGroupColor(g, parsed.xy, parsed.mirek)
                    GROUP_TYPES
                }
                SCENE -> {
                    repo.recallScene(id ?: return)
                    listOf("scene", "light", "grouped_light")
                }
                ALL_LIGHTS -> {
                    repo.setGroupOn(snap.bridgeHomeGroupedLightId ?: return, arg.toBoolean())
                    GROUP_TYPES
                }
                TOGGLE_LIGHT -> {
                    val l = snap.light(id.orEmpty()) ?: return
                    repo.setLightOn(l.id, !l.on)
                    GROUP_TYPES
                }
                LIGHT_BRIGHTNESS_DELTA -> {
                    val l = snap.light(id.orEmpty()) ?: return
                    val delta = arg?.toDoubleOrNull() ?: return
                    val current = if (l.on) l.brightness else 0.0
                    repo.setLightBrightness(l.id, (current + delta).coerceIn(1.0, 100.0))
                    GROUP_TYPES
                }
                LIGHT_COLOR -> {
                    val l = snap.light(id.orEmpty()) ?: return
                    val parsed = ColorNames.parseColor(arg2, l.gamut) ?: ColorNames.parseColor(arg, l.gamut) ?: return
                    when {
                        parsed.xy != null && l.supportsColor -> repo.setLightColor(l.id, parsed.xy)
                        parsed.mirek != null && l.supportsCt -> repo.setLightMirek(l.id, parsed.mirek)
                        parsed.xy != null && l.supportsCt -> repo.setLightMirek(l.id, 370)
                        else -> return
                    }
                    listOf("light")
                }
                else -> emptyList()
            }
        }.getOrElse { e ->
            Log.w(TAG, "widget action $op failed", e)
            emptyList()
        }
        // Optimistic render first, then confirm from the bridge.
        WidgetUpdater.updateAllNow(app)
        if (touched.isNotEmpty()) refetch(app, touched)
    }

    private val GROUP_TYPES = listOf("grouped_light", "light")

    /** Re-fetches the given resource types and re-renders the widgets when the bridge state differs. */
    private suspend fun refetch(context: Context, types: List<String>) {
        val repo = context.appContainer.repository
        val client = repo.client.value ?: return
        var changed = false
        for (type in types) {
            val list = withTimeoutOrNull(WidgetData.FETCH_TIMEOUT_MS) {
                runCatching { client.getResources(type) }.onFailure { Log.w(TAG, "refetch $type failed", it) }.getOrNull()
            } ?: continue
            val current = repo.resources.value
            for (obj in list) {
                val id = obj["id"]?.jsonPrimitive?.content ?: continue
                if (current[id] != obj) {
                    repo.applyLocalPatch(id, obj)
                    changed = true
                }
            }
        }
        if (changed) WidgetUpdater.updateAllNow(context)
    }
}

/** Glance callback that routes every widget tap to [WidgetActions.perform]. */
class HueWidgetAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val op = parameters[OP] ?: return
        WidgetActions.perform(context, op, parameters[ID], parameters[ARG], parameters[ARG2])
    }

    companion object {
        val OP = ActionParameters.Key<String>("op")
        val ID = ActionParameters.Key<String>("id")
        val ARG = ActionParameters.Key<String>("arg")
        val ARG2 = ActionParameters.Key<String>("arg2")
    }
}

/** Builds the click action for a widget control. */
fun widgetAction(op: String, id: String? = null, arg: String? = null, arg2: String? = null): Action {
    val pairs = buildList {
        add(HueWidgetAction.OP to op)
        id?.let { add(HueWidgetAction.ID to it) }
        arg?.let { add(HueWidgetAction.ARG to it) }
        arg2?.let { add(HueWidgetAction.ARG2 to it) }
    }
    return actionRunCallback<HueWidgetAction>(actionParametersOf(*pairs.toTypedArray()))
}
