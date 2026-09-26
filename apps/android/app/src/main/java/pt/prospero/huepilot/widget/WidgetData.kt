package pt.prospero.huepilot.widget

import android.content.Context
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonObject
import pt.prospero.huepilot.appContainer
import pt.prospero.huepilot.data.hue.HomeSnapshot
import pt.prospero.huepilot.data.hue.RepoStatus
import pt.prospero.huepilot.data.hue.SnapshotBuilder
import pt.prospero.huepilot.data.settings.AppSettings
import java.io.File

/** What a widget renders: the typed snapshot plus where it came from. */
data class WidgetState(
    val snapshot: HomeSnapshot = HomeSnapshot(),
    /** A bridge is paired in the app settings. */
    val paired: Boolean = false,
    /** The snapshot is the last known state from the cache, the bridge could not be reached. */
    val offline: Boolean = false,
    val favouriteRoomIds: List<String> = emptyList(),
) {
    val hasData: Boolean get() = !snapshot.isEmpty
}

/**
 * Snapshot source for the widgets. Everything derives from the app's [pt.prospero.huepilot.data.hue.HueRepository]
 * (connected on demand, so the bridge is fetched even when the app is not running):
 *
 * - [live] is a process-wide [StateFlow] that widget compositions collect, so a Glance session that is still
 *   alive re-renders as soon as the repository changes (event stream, optimistic patches, re-fetches).
 * - [load] is the one-shot variant: it waits up to [FETCH_TIMEOUT_MS] for the first resources and falls back
 *   to the JSON cache written on every successful load (marked `offline`).
 */
object WidgetData {
    private const val TAG = "WidgetData"
    const val FETCH_TIMEOUT_MS = 4000L
    private const val CACHE_FILE = "widget_snapshot.json"
    private const val SAVE_DEBOUNCE_MS = 5000L

    private val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @Volatile private var lastSaved: Map<String, JsonObject>? = null
    @Volatile private var memory: Map<String, JsonObject>? = null
    @Volatile private var cacheLoaded = false
    private var saveJob: Job? = null
    @Volatile private var liveFlow: StateFlow<WidgetState>? = null

    fun cacheFile(context: Context): File = File(context.applicationContext.filesDir, CACHE_FILE)

    /** Live state of this process: settings + repository resources, cache when the repository is empty. */
    fun live(context: Context): StateFlow<WidgetState> {
        liveFlow?.let { return it }
        synchronized(this) {
            liveFlow?.let { return it }
            val app = context.applicationContext
            val container = app.appContainer
            val flow = combine(container.settings.settings, container.repository.resources, container.repository.status) { s, res, st ->
                build(app, s, res, st)
            }.stateIn(container.appScope, SharingStarted.Eagerly, WidgetState())
            liveFlow = flow
            return flow
        }
    }

    /** One-shot state: connects the repository if needed and waits for data (or falls back to the cache). */
    suspend fun load(context: Context, forceRefresh: Boolean = false): WidgetState {
        val app = context.applicationContext
        val container = app.appContainer
        val settings = withTimeoutOrNull(3000) { container.settings.settings.first() } ?: AppSettings()
        val bridge = settings.bridge?.takeIf { it.isPaired }
            ?: return WidgetState(paired = false, favouriteRoomIds = settings.favouriteRoomIds)

        val repo = container.repository
        repo.connect(bridge)
        if (forceRefresh) repo.refresh()
        val live = withTimeoutOrNull(FETCH_TIMEOUT_MS) { repo.resources.first { it.isNotEmpty() } }
        if (live == null && !cacheLoaded) loadCache(app)
        return build(app, settings, live ?: emptyMap(), repo.status.value)
    }

    private fun build(app: Context, settings: AppSettings, resources: Map<String, JsonObject>, status: RepoStatus): WidgetState {
        val favourites = settings.favouriteRoomIds
        if (settings.bridge?.isPaired != true) return WidgetState(paired = false, favouriteRoomIds = favourites)
        if (resources.isNotEmpty()) {
            persist(app, resources)
            return WidgetState(
                snapshot = SnapshotBuilder.build(resources),
                paired = true,
                offline = status.error != null && !status.connected,
                favouriteRoomIds = favourites,
            )
        }
        val cached = memory
        return WidgetState(
            snapshot = cached?.let { SnapshotBuilder.build(it) } ?: HomeSnapshot(),
            paired = true,
            offline = true,
            favouriteRoomIds = favourites,
        )
    }

    private suspend fun loadCache(app: Context) {
        withContext(Dispatchers.IO) {
            runCatching { SnapshotCache(cacheFile(app)).load()?.resources }
                .onFailure { Log.w(TAG, "cache load failed", it) }
                .getOrNull()?.let { if (memory == null) memory = it }
            cacheLoaded = true
        }
    }

    /** Writes the resources to the cache file (debounced, off the caller's thread, skipped when unchanged). */
    private fun persist(context: Context, map: Map<String, JsonObject>) {
        if (map === lastSaved) return
        lastSaved = map
        memory = map
        val file = cacheFile(context)
        synchronized(this) {
            saveJob?.cancel()
            saveJob = ioScope.launch {
                delay(SAVE_DEBOUNCE_MS)
                runCatching { SnapshotCache(file).save(map) }.onFailure { Log.w(TAG, "cache save failed", it) }
            }
        }
    }

    /** Forgets the cached snapshot (e.g. after the bridge is forgotten). */
    fun clearCache(context: Context) {
        memory = null
        lastSaved = null
        runCatching { SnapshotCache(cacheFile(context)).clear() }
    }
}
