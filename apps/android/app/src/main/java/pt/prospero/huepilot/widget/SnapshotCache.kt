package pt.prospero.huepilot.widget

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import pt.prospero.huepilot.data.hue.HueJson
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption

/**
 * Last successful bridge snapshot (the raw CLIP v2 resources), persisted as JSON so widgets can render
 * instantly and keep showing the last known state when the bridge is unreachable.
 */
class SnapshotCache(private val file: File) {

    data class Cached(val savedAt: Long, val resources: Map<String, JsonObject>)

    fun save(resources: Map<String, JsonObject>, now: Long = System.currentTimeMillis()) {
        val root = buildJsonObject {
            put("version", 1)
            put("savedAt", now)
            put("data", JsonArray(resources.values.toList()))
        }
        file.parentFile?.mkdirs()
        val tmp = File(file.parentFile, file.name + ".tmp")
        tmp.writeText(root.toString())
        runCatching { Files.move(tmp.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE) }
            .recoverCatching { Files.move(tmp.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING) }
            .getOrThrow()
    }

    fun load(): Cached? {
        if (!file.exists()) return null
        val root = runCatching { HueJson.parseToJsonElement(file.readText()).jsonObject }.getOrNull() ?: return null
        val data = root["data"]?.jsonArray ?: return null
        val map = LinkedHashMap<String, JsonObject>()
        for (el in data) {
            val obj = el as? JsonObject ?: continue
            val id = obj["id"]?.jsonPrimitive?.content ?: continue
            map[id] = obj
        }
        if (map.isEmpty()) return null
        return Cached(savedAt = root["savedAt"]?.jsonPrimitive?.longOrNull ?: 0L, resources = map)
    }

    fun clear() { file.delete() }
}
