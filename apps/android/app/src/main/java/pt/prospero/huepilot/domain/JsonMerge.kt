package pt.prospero.huepilot.domain

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject

/** Deep-merge helpers for applying partial SSE updates onto stored resources. */
object JsonMerge {
    /**
     * Returns [base] with every key of [patch] merged in. Nested objects are merged recursively; arrays
     * and primitives from the patch replace the base value. A JSON null in the patch removes the key.
     */
    fun deepMerge(base: JsonObject, patch: JsonObject): JsonObject {
        val out = LinkedHashMap<String, JsonElement>(base)
        for ((k, v) in patch) {
            val existing = out[k]
            if (v is JsonObject && existing is JsonObject) {
                out[k] = deepMerge(existing, v)
            } else if (v is JsonNull) {
                out.remove(k)
            } else {
                out[k] = v
            }
        }
        return JsonObject(out)
    }
}
