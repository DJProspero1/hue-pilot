package pt.prospero.huepilot.assistant

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

data class GeminiModel(val name: String, val displayName: String, val description: String?)

class GeminiException(message: String) : Exception(message)

/** One part of a model reply: either text or a function call. */
sealed class GeminiPart {
    data class Text(val text: String) : GeminiPart()
    data class FunctionCall(val name: String, val args: JsonObject) : GeminiPart()
}

data class GeminiReply(val parts: List<GeminiPart>, val rawContent: JsonObject)

/**
 * Minimal Google Gemini REST client (generateContent + function calling). Uses a regular,
 * certificate-verifying OkHttp client; never the bridge's trust-all client.
 */
class GeminiClient {
    private val json = Json { ignoreUnknownKeys = true; isLenient = true; explicitNulls = false }
    private val jsonType = "application/json; charset=utf-8".toMediaType()
    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(90, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    suspend fun listModels(apiKey: String): List<GeminiModel> = withContext(Dispatchers.IO) {
        val req = Request.Builder().url("$BASE/models?key=${apiKey.trim()}&pageSize=200").get().build()
        http.newCall(req).execute().use { resp ->
            val text = resp.body?.string().orEmpty()
            val obj = parseOrThrow(text, resp.code)
            val models = obj["models"]?.jsonArray ?: JsonArray(emptyList())
            models.mapNotNull { m ->
                val o = m.jsonObject
                val methods = o["supportedGenerationMethods"]?.jsonArray?.map { it.jsonPrimitive.content } ?: emptyList()
                if ("generateContent" !in methods) return@mapNotNull null
                val name = o["name"]?.jsonPrimitive?.content?.removePrefix("models/") ?: return@mapNotNull null
                GeminiModel(name, o["displayName"]?.jsonPrimitive?.content ?: name, o["description"]?.jsonPrimitive?.content)
            }.sortedBy { it.name }
        }
    }

    suspend fun generateContent(
        apiKey: String,
        model: String,
        systemInstruction: String,
        contents: JsonArray,
        functionDeclarations: JsonArray,
    ): GeminiReply = withContext(Dispatchers.IO) {
        val body = buildJsonObject {
            putJsonObject("systemInstruction") {
                putJsonArray("parts") { add(buildJsonObject { put("text", systemInstruction) }) }
            }
            put("contents", contents)
            if (functionDeclarations.isNotEmpty()) {
                putJsonArray("tools") { add(buildJsonObject { put("functionDeclarations", functionDeclarations) }) }
            }
            putJsonObject("generationConfig") { put("temperature", 0.2) }
        }
        val req = Request.Builder()
            .url("$BASE/models/${model.trim()}:generateContent?key=${apiKey.trim()}")
            .post(body.toString().toRequestBody(jsonType))
            .build()
        http.newCall(req).execute().use { resp ->
            val text = resp.body?.string().orEmpty()
            val obj = parseOrThrow(text, resp.code)
            val candidate = obj["candidates"]?.jsonArray?.firstOrNull()?.jsonObject
                ?: run {
                    val block = obj["promptFeedback"]?.jsonObject?.get("blockReason")?.jsonPrimitive?.content
                    throw GeminiException(if (block != null) "Request blocked: $block" else "Gemini returned no candidates")
                }
            val content = candidate["content"]?.jsonObject ?: buildJsonObject { put("role", "model"); putJsonArray("parts") {} }
            val parts = content["parts"]?.jsonArray?.mapNotNull { p ->
                val po = p.jsonObject
                po["functionCall"]?.jsonObject?.let { fc ->
                    return@mapNotNull GeminiPart.FunctionCall(
                        fc["name"]?.jsonPrimitive?.content ?: "",
                        fc["args"] as? JsonObject ?: JsonObject(emptyMap()),
                    )
                }
                po["text"]?.jsonPrimitive?.content?.let { return@mapNotNull GeminiPart.Text(it) }
                null
            } ?: emptyList()
            GeminiReply(parts, content)
        }
    }

    private fun parseOrThrow(text: String, code: Int): JsonObject {
        val el = runCatching { json.parseToJsonElement(text) }.getOrNull() as? JsonObject
            ?: throw GeminiException("Gemini returned an unexpected response (HTTP $code)")
        el["error"]?.jsonObject?.let { err ->
            val msg = err["message"]?.jsonPrimitive?.content ?: "Gemini error"
            throw GeminiException("$msg (HTTP $code)")
        }
        if (code !in 200..299) throw GeminiException("Gemini error HTTP $code")
        return el
    }

    companion object {
        const val BASE = "https://generativelanguage.googleapis.com/v1beta"

        /** Helper to build a `user` content with a text part. */
        fun userText(text: String): JsonObject = buildJsonObject {
            put("role", "user")
            putJsonArray("parts") { add(buildJsonObject { put("text", text) }) }
        }

        /** Helper to build the `functionResponse` content sent back after executing tools (role user). */
        fun functionResponses(responses: List<Pair<String, JsonObject>>): JsonObject = buildJsonObject {
            put("role", "user")
            put("parts", buildJsonArray {
                for ((name, response) in responses) {
                    add(buildJsonObject {
                        putJsonObject("functionResponse") {
                            put("name", name)
                            put("response", response)
                        }
                    })
                }
            })
        }
    }
}
