package pt.prospero.huepilot.data.settings

import android.content.Context
import androidx.datastore.core.DataMigration
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
import pt.prospero.huepilot.assistant.AssistantProvider
import pt.prospero.huepilot.assistant.ProviderConfig
import pt.prospero.huepilot.data.hue.BridgeConnection

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(
    name = "hue_pilot_settings",
    produceMigrations = { listOf(LegacyGeminiMigration) },
)

enum class ThemeMode { SYSTEM, LIGHT, DARK }

data class AppSettings(
    val bridge: BridgeConnection? = null,
    val assistantProvider: AssistantProvider = AssistantProvider.GEMINI,
    val providers: Map<AssistantProvider, ProviderConfig> = defaultProviders(),
    val theme: ThemeMode = ThemeMode.SYSTEM,
    /** Material You (wallpaper) colours instead of the Hue Pilot palette. */
    val wallpaperColors: Boolean = false,
    val transitionMs: Int = 400,
    val speakReplies: Boolean = false,
    val favouriteRoomIds: List<String> = emptyList(),
    val loaded: Boolean = false,
) {
    fun provider(p: AssistantProvider): ProviderConfig = providers[p] ?: ProviderConfig(model = p.defaultModel)
    val activeConfig: ProviderConfig get() = provider(assistantProvider)

    companion object {
        fun defaultProviders(): Map<AssistantProvider, ProviderConfig> =
            AssistantProvider.entries.associateWith { ProviderConfig(model = it.defaultModel) }
    }
}

/** Preference keys (also used by the migration and tests). */
object SettingsKeys {
    val HOST = stringPreferencesKey("bridge_host")
    val PORT = intPreferencesKey("bridge_port")
    val HTTPS = booleanPreferencesKey("bridge_https")
    val APP_KEY = stringPreferencesKey("bridge_app_key")
    val CLIENT_KEY = stringPreferencesKey("bridge_client_key")
    val BRIDGE_ID = stringPreferencesKey("bridge_id")
    val BRIDGE_NAME = stringPreferencesKey("bridge_name")
    val ASSISTANT_PROVIDER = stringPreferencesKey("assistant_provider")
    val THEME = stringPreferencesKey("theme")
    val WALLPAPER = booleanPreferencesKey("wallpaper_colors")
    val TRANSITION = intPreferencesKey("transition_ms")
    val SPEAK = booleanPreferencesKey("speak_replies")
    val FAVOURITES = stringPreferencesKey("favourite_rooms")

    /** Pre-multi-provider keys (single Gemini key/model). */
    val LEGACY_GEMINI_KEY = stringPreferencesKey("gemini_api_key")
    val LEGACY_GEMINI_MODEL = stringPreferencesKey("gemini_model")

    fun providerKey(p: AssistantProvider) = stringPreferencesKey("provider_${p.id}_key")
    fun providerModel(p: AssistantProvider) = stringPreferencesKey("provider_${p.id}_model")
}

/** Moves the old single Gemini key/model into the per-provider gemini slot (runs once, before first read). */
object LegacyGeminiMigration : DataMigration<Preferences> {
    override suspend fun shouldMigrate(currentData: Preferences): Boolean =
        currentData.contains(SettingsKeys.LEGACY_GEMINI_KEY) || currentData.contains(SettingsKeys.LEGACY_GEMINI_MODEL)

    override suspend fun migrate(currentData: Preferences): Preferences = migratePreferences(currentData)

    override suspend fun cleanUp() {}

    /** Pure migration step (unit-tested). Never overwrites values already stored in the new keys. */
    fun migratePreferences(current: Preferences): Preferences {
        val m = current.toMutablePreferences()
        val newKey = SettingsKeys.providerKey(AssistantProvider.GEMINI)
        val newModel = SettingsKeys.providerModel(AssistantProvider.GEMINI)
        current[SettingsKeys.LEGACY_GEMINI_KEY]?.let { if (m[newKey].isNullOrBlank() && it.isNotBlank()) m[newKey] = it }
        current[SettingsKeys.LEGACY_GEMINI_MODEL]?.let { if (m[newModel].isNullOrBlank() && it.isNotBlank()) m[newModel] = it }
        if (!m.contains(SettingsKeys.ASSISTANT_PROVIDER)) m[SettingsKeys.ASSISTANT_PROVIDER] = AssistantProvider.GEMINI.id
        m.remove(SettingsKeys.LEGACY_GEMINI_KEY)
        m.remove(SettingsKeys.LEGACY_GEMINI_MODEL)
        return m.toPreferences()
    }
}

class SettingsRepository(private val context: Context) {

    val settings: Flow<AppSettings> = context.dataStore.data.map { fromPreferences(it) }

    suspend fun current(): AppSettings = settings.first()

    suspend fun saveBridge(conn: BridgeConnection) {
        context.dataStore.edit { p ->
            p[SettingsKeys.HOST] = conn.host
            p[SettingsKeys.PORT] = conn.port
            p[SettingsKeys.HTTPS] = conn.useHttps
            conn.appKey?.let { p[SettingsKeys.APP_KEY] = it } ?: p.remove(SettingsKeys.APP_KEY)
            conn.clientKey?.let { p[SettingsKeys.CLIENT_KEY] = it } ?: p.remove(SettingsKeys.CLIENT_KEY)
            conn.bridgeId?.let { p[SettingsKeys.BRIDGE_ID] = it } ?: p.remove(SettingsKeys.BRIDGE_ID)
            conn.bridgeName?.let { p[SettingsKeys.BRIDGE_NAME] = it } ?: p.remove(SettingsKeys.BRIDGE_NAME)
        }
    }

    suspend fun forgetBridge() {
        context.dataStore.edit { p ->
            listOf(
                SettingsKeys.HOST, SettingsKeys.PORT, SettingsKeys.HTTPS, SettingsKeys.APP_KEY, SettingsKeys.CLIENT_KEY,
                SettingsKeys.BRIDGE_ID, SettingsKeys.BRIDGE_NAME, SettingsKeys.FAVOURITES,
            ).forEach { p.remove(it) }
        }
    }

    suspend fun setAssistantProvider(provider: AssistantProvider) {
        context.dataStore.edit { it[SettingsKeys.ASSISTANT_PROVIDER] = provider.id }
    }

    suspend fun setProviderConfig(provider: AssistantProvider, apiKey: String, model: String) {
        context.dataStore.edit { p ->
            p[SettingsKeys.providerKey(provider)] = apiKey.trim()
            p[SettingsKeys.providerModel(provider)] = model.trim().ifBlank { provider.defaultModel }
        }
    }

    suspend fun setTheme(mode: ThemeMode) { context.dataStore.edit { it[SettingsKeys.THEME] = mode.name } }
    suspend fun setWallpaperColors(on: Boolean) { context.dataStore.edit { it[SettingsKeys.WALLPAPER] = on } }
    suspend fun setTransitionMs(ms: Int) { context.dataStore.edit { it[SettingsKeys.TRANSITION] = ms.coerceIn(0, 60_000) } }
    suspend fun setSpeakReplies(on: Boolean) { context.dataStore.edit { it[SettingsKeys.SPEAK] = on } }
    suspend fun setFavouriteRooms(ids: List<String>) { context.dataStore.edit { it[SettingsKeys.FAVOURITES] = ids.joinToString(",") } }

    companion object {
        /** Pure mapping from stored preferences to [AppSettings] (unit-tested). */
        fun fromPreferences(p: Preferences): AppSettings {
            val host = p[SettingsKeys.HOST]
            val bridge = if (!host.isNullOrBlank()) {
                BridgeConnection(
                    host = host,
                    port = p[SettingsKeys.PORT] ?: 443,
                    useHttps = p[SettingsKeys.HTTPS] ?: true,
                    appKey = p[SettingsKeys.APP_KEY],
                    clientKey = p[SettingsKeys.CLIENT_KEY],
                    bridgeId = p[SettingsKeys.BRIDGE_ID],
                    bridgeName = p[SettingsKeys.BRIDGE_NAME],
                )
            } else null
            val providers = AssistantProvider.entries.associateWith { prov ->
                ProviderConfig(
                    apiKey = p[SettingsKeys.providerKey(prov)] ?: "",
                    model = p[SettingsKeys.providerModel(prov)]?.takeIf { it.isNotBlank() } ?: prov.defaultModel,
                )
            }
            return AppSettings(
                bridge = bridge,
                assistantProvider = AssistantProvider.fromId(p[SettingsKeys.ASSISTANT_PROVIDER]),
                providers = providers,
                theme = p[SettingsKeys.THEME]?.let { runCatching { ThemeMode.valueOf(it) }.getOrNull() } ?: ThemeMode.SYSTEM,
                wallpaperColors = p[SettingsKeys.WALLPAPER] ?: false,
                transitionMs = p[SettingsKeys.TRANSITION] ?: 400,
                speakReplies = p[SettingsKeys.SPEAK] ?: false,
                favouriteRoomIds = p[SettingsKeys.FAVOURITES]?.split(',')?.filter { it.isNotBlank() } ?: emptyList(),
                loaded = true,
            )
        }
    }
}
