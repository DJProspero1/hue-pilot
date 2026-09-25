package pt.prospero.huepilot.data.hue

import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import pt.prospero.huepilot.domain.JsonMerge
import pt.prospero.huepilot.domain.XY
import kotlin.math.roundToInt

data class RepoStatus(
    val connected: Boolean = false,
    val loading: Boolean = false,
    val error: String? = null,
    val lastRefresh: Long = 0,
)

/**
 * Holds every CLIP v2 resource by id, keeps it up to date through the event stream and exposes a
 * typed [HomeSnapshot]. All write operations apply an optimistic local patch first.
 */
class HueRepository(private val scope: CoroutineScope) {
    private val _client = MutableStateFlow<HueClient?>(null)
    val client: StateFlow<HueClient?> = _client

    private val _resources = MutableStateFlow<Map<String, JsonObject>>(emptyMap())
    val resources: StateFlow<Map<String, JsonObject>> = _resources

    val snapshot: StateFlow<HomeSnapshot> = _resources
        .map { withContext(Dispatchers.Default) { SnapshotBuilder.build(it) } }
        .stateIn(scope, SharingStarted.Eagerly, HomeSnapshot())

    private val _status = MutableStateFlow(RepoStatus())
    val status: StateFlow<RepoStatus> = _status

    private val stream = HueEventStream(scope) { applyEvent(it) }
    val streamState: StateFlow<StreamState> = stream.state

    private var refreshJob: Job? = null

    /** Default transition applied to writes (ms). Updated from settings. */
    @Volatile var defaultTransitionMs: Int = 400

    fun connect(connection: BridgeConnection) {
        val current = _client.value
        if (current != null && current.connection == connection) return
        disconnect()
        if (!connection.isPaired) return
        val client = HueClient(connection)
        _client.value = client
        refreshJob = scope.launch { refresh() }
        stream.start(client)
    }

    fun disconnect() {
        stream.stop()
        refreshJob?.cancel()
        _client.value = null
        _resources.value = emptyMap()
        _status.value = RepoStatus()
    }

    suspend fun refresh() {
        val client = _client.value ?: return
        _status.update { it.copy(loading = true) }
        try {
            val all = client.getAllResources()
            val map = LinkedHashMap<String, JsonObject>()
            for (r in all) {
                val id = r["id"]?.jsonPrimitive?.content ?: continue
                map[id] = r
            }
            _resources.value = map
            _status.value = RepoStatus(connected = true, loading = false, error = null, lastRefresh = System.currentTimeMillis())
        } catch (e: Exception) {
            Log.w(TAG, "refresh failed", e)
            _status.update { it.copy(loading = false, error = e.message ?: "Could not reach the bridge", connected = _resources.value.isNotEmpty()) }
        }
    }

    private fun applyEvent(event: HueEvent) {
        _resources.update { current ->
            val map = LinkedHashMap(current)
            for (partial in event.data) {
                val id = partial["id"]?.jsonPrimitive?.content ?: continue
                when (event.type) {
                    "delete" -> map.remove(id)
                    "add" -> map[id] = partial
                    else -> map[id] = map[id]?.let { JsonMerge.deepMerge(it, partial) } ?: partial
                }
            }
            map
        }
    }

    /** Optimistic local update, later confirmed by the bridge event. */
    fun applyLocalPatch(id: String, patch: JsonObject) {
        _resources.update { current ->
            val existing = current[id] ?: return@update current
            val map = LinkedHashMap(current)
            map[id] = JsonMerge.deepMerge(existing, patch)
            map
        }
    }

    private fun requireClient(): HueClient = _client.value ?: throw HueException("Bridge is not connected")

    private fun withTransition(body: JsonObject, transitionMs: Int?): JsonObject {
        val ms = transitionMs ?: defaultTransitionMs
        if (ms <= 0 || body.containsKey("dynamics") || body.containsKey("alert") || body.containsKey("metadata")) return body
        return JsonObject(body + ("dynamics" to buildJsonObject { put("duration", ms) }))
    }

    private fun stripLocal(body: JsonObject): JsonObject = JsonObject(body.filterKeys { it != "dynamics" && it != "alert" && it != "recall" })

    private suspend fun put(type: String, id: String, body: JsonObject, transitionMs: Int? = null) {
        val client = requireClient()
        applyLocalPatch(id, stripLocal(body))
        try {
            client.put(type, id, withTransition(body, transitionMs))
        } catch (e: Exception) {
            _status.update { it.copy(error = e.message) }
            throw e
        }
    }

    // ---- lights ----

    suspend fun setLightOn(id: String, on: Boolean, transitionMs: Int? = null) =
        put("light", id, buildJsonObject { putJsonObject("on") { put("on", on) } }, transitionMs)

    suspend fun setLightBrightness(id: String, brightness: Double, transitionMs: Int? = null) {
        val b = brightness.coerceIn(0.0, 100.0)
        put("light", id, buildJsonObject {
            putJsonObject("dimming") { put("brightness", round1(b)) }
            if (b > 0) putJsonObject("on") { put("on", true) }
        }, transitionMs)
    }

    suspend fun setLightColor(id: String, xy: XY, transitionMs: Int? = null) =
        put("light", id, buildJsonObject {
            putJsonObject("on") { put("on", true) }
            putJsonObject("color") { putJsonObject("xy") { put("x", round4(xy.x)); put("y", round4(xy.y)) } }
        }, transitionMs)

    suspend fun setLightMirek(id: String, mirek: Int, transitionMs: Int? = null) =
        put("light", id, buildJsonObject {
            putJsonObject("on") { put("on", true) }
            putJsonObject("color_temperature") { put("mirek", mirek.coerceIn(153, 500)) }
        }, transitionMs)

    suspend fun setLightEffect(id: String, effect: String, usesV2: Boolean) =
        put("light", id, buildJsonObject {
            if (effect != "no_effect") putJsonObject("on") { put("on", true) }
            if (usesV2) putJsonObject("effects_v2") { putJsonObject("action") { put("effect", effect) } }
            else putJsonObject("effects") { put("effect", effect) }
        }, 0)

    suspend fun identifyLight(id: String) =
        requireClient().put("light", id, buildJsonObject { putJsonObject("alert") { put("action", "breathe") } })

    suspend fun renameLight(id: String, name: String) =
        put("light", id, buildJsonObject { putJsonObject("metadata") { put("name", name.trim()) } }, 0)

    /** Generic light update built by the assistant. */
    suspend fun updateLight(id: String, body: JsonObject, transitionMs: Int? = null) = put("light", id, body, transitionMs)

    // ---- grouped lights ----

    suspend fun setGroupOn(groupedLightId: String, on: Boolean, transitionMs: Int? = null) =
        put("grouped_light", groupedLightId, buildJsonObject { putJsonObject("on") { put("on", on) } }, transitionMs)

    suspend fun setGroupBrightness(groupedLightId: String, brightness: Double, transitionMs: Int? = null) {
        val b = brightness.coerceIn(0.0, 100.0)
        put("grouped_light", groupedLightId, buildJsonObject {
            putJsonObject("dimming") { put("brightness", round1(b)) }
            if (b > 0) putJsonObject("on") { put("on", true) }
        }, transitionMs)
    }

    suspend fun updateGroupedLight(groupedLightId: String, body: JsonObject, transitionMs: Int? = null) =
        put("grouped_light", groupedLightId, body, transitionMs)

    /**
     * Applies a colour or colour temperature to a whole group; if the bridge rejects it on the
     * grouped_light, falls back to setting each light that supports it.
     */
    suspend fun setGroupColor(group: GroupUi, xy: XY?, mirek: Int?, transitionMs: Int? = null) {
        val body = buildJsonObject {
            putJsonObject("on") { put("on", true) }
            if (xy != null) putJsonObject("color") { putJsonObject("xy") { put("x", round4(xy.x)); put("y", round4(xy.y)) } }
            else if (mirek != null) putJsonObject("color_temperature") { put("mirek", mirek.coerceIn(153, 500)) }
        }
        val glId = group.groupedLightId
        var ok = false
        if (glId != null) {
            ok = runCatching { requireClient().put("grouped_light", glId, withTransition(body, transitionMs)) }.isSuccess
        }
        if (!ok) {
            for (l in group.lights) {
                val supported = (xy != null && l.supportsColor) || (mirek != null && l.supportsCt)
                if (!supported) continue
                runCatching { put("light", l.id, body, transitionMs) }
            }
        } else {
            // Optimistically reflect on member lights.
            for (l in group.lights) {
                val supported = (xy != null && l.supportsColor) || (mirek != null && l.supportsCt)
                if (supported) applyLocalPatch(l.id, stripLocal(body))
            }
        }
    }

    // ---- scenes ----

    suspend fun recallScene(sceneId: String, dynamic: Boolean = false, transitionMs: Int? = null) {
        val body = buildJsonObject {
            putJsonObject("recall") {
                put("action", if (dynamic) "dynamic_palette" else "active")
                val ms = transitionMs ?: defaultTransitionMs
                if (ms > 0) put("duration", ms)
            }
        }
        requireClient().put("scene", sceneId, body)
        // Optimistic: mark this scene active and siblings inactive.
        val scene = snapshot.value.scene(sceneId)
        if (scene != null) {
            snapshot.value.scenesFor(scene.groupId).forEach { s ->
                applyLocalPatch(s.id, buildJsonObject {
                    putJsonObject("status") { put("active", if (s.id == sceneId) (if (dynamic) "dynamic_palette" else "static") else "inactive") }
                })
            }
            for (a in scene.actions) {
                val target = a.target.rid
                if (_resources.value.containsKey(target)) applyLocalPatch(target, JsonObject(a.action.filterKeys { it != "dynamics" }))
            }
        }
    }

    suspend fun renameScene(sceneId: String, name: String) =
        put("scene", sceneId, buildJsonObject { putJsonObject("metadata") { put("name", name.trim()) } }, 0)

    suspend fun deleteScene(sceneId: String) {
        requireClient().delete("scene", sceneId)
        _resources.update { it - sceneId }
    }

    /** Creates a scene from the current state of the lights in [group]. Returns the new scene id. */
    suspend fun saveCurrentAsScene(group: GroupUi, name: String): String {
        val body = buildJsonObject {
            put("type", "scene")
            putJsonObject("metadata") { put("name", name.trim()) }
            putJsonObject("group") { put("rid", group.id); put("rtype", group.kind.rtype) }
            put("actions", buildJsonArray {
                for (l in group.lights) {
                    add(buildJsonObject {
                        putJsonObject("target") { put("rid", l.id); put("rtype", "light") }
                        putJsonObject("action") {
                            putJsonObject("on") { put("on", l.on) }
                            if (l.supportsDimming && l.on) putJsonObject("dimming") { put("brightness", round1(l.brightness)) }
                            if (l.on) {
                                if (l.isCtMode && l.mirek != null) putJsonObject("color_temperature") { put("mirek", l.mirek) }
                                else if (l.supportsColor && l.xy != null) putJsonObject("color") { putJsonObject("xy") { put("x", round4(l.xy.x)); put("y", round4(l.xy.y)) } }
                            }
                        }
                    })
                }
            })
        }
        val result = requireClient().post("scene", body)
        val id = result.firstOrNull()?.get("rid")?.jsonPrimitive?.content ?: throw HueException("Bridge did not return the new scene")
        scope.launch {
            runCatching { requireClient().getResource("scene", id) }.getOrNull()?.let { obj ->
                _resources.update { it + (id to obj) }
            }
        }
        return id
    }

    // ---- accessories ----

    suspend fun setMotionEnabled(motionId: String, enabled: Boolean) =
        put("motion", motionId, buildJsonObject { put("enabled", enabled) }, 0)

    suspend fun renameDevice(deviceId: String, name: String) =
        put("device", deviceId, buildJsonObject { putJsonObject("metadata") { put("name", name.trim()) } }, 0)

    private fun round1(v: Double) = (v * 10).roundToInt() / 10.0
    private fun round4(v: Double) = (v * 10000).roundToInt() / 10000.0

    companion object {
        private const val TAG = "HueRepository"
    }
}
