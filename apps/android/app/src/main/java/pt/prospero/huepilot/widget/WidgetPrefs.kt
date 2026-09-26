package pt.prospero.huepilot.widget

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/**
 * Per-widget configuration chosen in [WidgetConfigureActivity]. Stored as one JSON string per
 * appWidgetId in SharedPreferences; all fields are optional so every widget has a sensible default.
 */
@Serializable
data class WidgetConfig(
    /** Room/zone for Room control, Colour strip and Scenes (null = default / favourites). */
    val groupId: String? = null,
    /** Light for Light control. */
    val lightId: String? = null,
    /** Ordered rooms/zones for the Rooms grid (empty = favourites, else all). */
    val groupIds: List<String> = emptyList(),
) {
    val isEmpty: Boolean get() = groupId == null && lightId == null && groupIds.isEmpty()

    fun encode(): String = json.encodeToString(serializer(), this)

    companion object {
        private val json = Json { ignoreUnknownKeys = true; encodeDefaults = false }
        val EMPTY = WidgetConfig()
        fun decode(raw: String?): WidgetConfig =
            if (raw.isNullOrBlank()) EMPTY else runCatching { json.decodeFromString(serializer(), raw) }.getOrDefault(EMPTY)
    }
}

object WidgetPrefs {
    private const val FILE = "hue_widgets"
    private fun key(appWidgetId: Int) = "widget_$appWidgetId"
    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    /** Bumped on every save/remove so live widget compositions re-read their config. */
    val changes = MutableStateFlow(0)

    fun get(context: Context, appWidgetId: Int): WidgetConfig = WidgetConfig.decode(prefs(context).getString(key(appWidgetId), null))

    fun save(context: Context, appWidgetId: Int, config: WidgetConfig) {
        prefs(context).edit().putString(key(appWidgetId), config.encode()).apply()
        changes.value++
    }

    fun remove(context: Context, appWidgetId: Int) {
        prefs(context).edit().remove(key(appWidgetId)).apply()
        changes.value++
    }
}
