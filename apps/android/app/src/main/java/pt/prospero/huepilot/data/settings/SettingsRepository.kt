package pt.prospero.huepilot.data.settings

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import pt.prospero.huepilot.data.hue.BridgeConnection

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "hue_pilot_settings")

enum class ThemeMode { SYSTEM, LIGHT, DARK }

data class AppSettings(
    val bridge: BridgeConnection? = null,
    val geminiApiKey: String = "",
    val geminiModel: String = "gemini-2.5-flash",
    val theme: ThemeMode = ThemeMode.SYSTEM,
    val transitionMs: Int = 400,
    val speakReplies: Boolean = false,
    val favouriteRoomIds: List<String> = emptyList(),
    val loaded: Boolean = false,
)

class SettingsRepository(private val context: Context) {
    private object Keys {
        val HOST = stringPreferencesKey("bridge_host")
        val PORT = intPreferencesKey("bridge_port")
        val HTTPS = booleanPreferencesKey("bridge_https")
        val APP_KEY = stringPreferencesKey("bridge_app_key")
        val CLIENT_KEY = stringPreferencesKey("bridge_client_key")
        val BRIDGE_ID = stringPreferencesKey("bridge_id")
        val BRIDGE_NAME = stringPreferencesKey("bridge_name")
        val GEMINI_KEY = stringPreferencesKey("gemini_api_key")
        val GEMINI_MODEL = stringPreferencesKey("gemini_model")
        val THEME = stringPreferencesKey("theme")
        val TRANSITION = intPreferencesKey("transition_ms")
        val SPEAK = booleanPreferencesKey("speak_replies")
        val FAVOURITES = stringPreferencesKey("favourite_rooms")
    }

    val settings: Flow<AppSettings> = context.dataStore.data.map { p ->
        val host = p[Keys.HOST]
        val bridge = if (!host.isNullOrBlank()) {
            BridgeConnection(
                host = host,
                port = p[Keys.PORT] ?: 443,
                useHttps = p[Keys.HTTPS] ?: true,
                appKey = p[Keys.APP_KEY],
                clientKey = p[Keys.CLIENT_KEY],
                bridgeId = p[Keys.BRIDGE_ID],
                bridgeName = p[Keys.BRIDGE_NAME],
            )
        } else null
        AppSettings(
            bridge = bridge,
            geminiApiKey = p[Keys.GEMINI_KEY] ?: "",
            geminiModel = p[Keys.GEMINI_MODEL]?.ifBlank { null } ?: "gemini-2.5-flash",
            theme = p[Keys.THEME]?.let { runCatching { ThemeMode.valueOf(it) }.getOrNull() } ?: ThemeMode.SYSTEM,
            transitionMs = p[Keys.TRANSITION] ?: 400,
            speakReplies = p[Keys.SPEAK] ?: false,
            favouriteRoomIds = p[Keys.FAVOURITES]?.split(',')?.filter { it.isNotBlank() } ?: emptyList(),
            loaded = true,
        )
    }

    suspend fun current(): AppSettings = settings.first()

    suspend fun saveBridge(conn: BridgeConnection) {
        context.dataStore.edit { p ->
            p[Keys.HOST] = conn.host
            p[Keys.PORT] = conn.port
            p[Keys.HTTPS] = conn.useHttps
            conn.appKey?.let { p[Keys.APP_KEY] = it } ?: p.remove(Keys.APP_KEY)
            conn.clientKey?.let { p[Keys.CLIENT_KEY] = it } ?: p.remove(Keys.CLIENT_KEY)
            conn.bridgeId?.let { p[Keys.BRIDGE_ID] = it } ?: p.remove(Keys.BRIDGE_ID)
            conn.bridgeName?.let { p[Keys.BRIDGE_NAME] = it } ?: p.remove(Keys.BRIDGE_NAME)
        }
    }

    suspend fun forgetBridge() {
        context.dataStore.edit { p ->
            listOf(Keys.HOST, Keys.PORT, Keys.HTTPS, Keys.APP_KEY, Keys.CLIENT_KEY, Keys.BRIDGE_ID, Keys.BRIDGE_NAME, Keys.FAVOURITES)
                .forEach { p.remove(it) }
        }
    }

    suspend fun setGemini(apiKey: String, model: String) {
        context.dataStore.edit { p ->
            p[Keys.GEMINI_KEY] = apiKey.trim()
            p[Keys.GEMINI_MODEL] = model.trim()
        }
    }

    suspend fun setTheme(mode: ThemeMode) { context.dataStore.edit { it[Keys.THEME] = mode.name } }
    suspend fun setTransitionMs(ms: Int) { context.dataStore.edit { it[Keys.TRANSITION] = ms.coerceIn(0, 60_000) } }
    suspend fun setSpeakReplies(on: Boolean) { context.dataStore.edit { it[Keys.SPEAK] = on } }
    suspend fun setFavouriteRooms(ids: List<String>) { context.dataStore.edit { it[Keys.FAVOURITES] = ids.joinToString(",") } }
}
