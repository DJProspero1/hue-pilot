package pt.prospero.huepilot.assistant

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
import okhttp3.OkHttpClient

/**
 * Google Gemini REST (`generateContent` + function calling, no Firebase). Assistant turns are echoed
 * back as the exact `content` object returned by the API, including `thoughtSignature` parts.
 */
class GeminiAdapter(
    private val http: OkHttpClient = LlmHttp.client,
    private val baseUrl: String = DEFAULT_BASE,
) : LlmAdapter {
    override val provider = AssistantProvider.GEMINI

    override suspend fun generate(config: ProviderConfig, systemInstruction: String, history: List<Turn>, tools: List<ToolSpec>): LlmReply {
        val contents = buildJsonArray {
            for (t in history) when (t) {
                is Turn.User -> add(userText(t.text))
                is Turn.Assistant -> add(t.raw as? JsonObject ?: rebuildAssistant(t))
                is Turn.ToolResults -> add(functionResponses(t.results))
            }
        }
        val body = buildJsonObject {
            putJsonObject("systemInstruction") { putJsonArray("parts") { add(buildJsonObject { put("text", systemInstruction) }) } }
            put("contents", contents)
            if (tools.isNotEmpty()) {
                putJsonArray("tools") {
                    add(buildJsonObject {
                        putJsonArray("functionDeclarations") {
                            tools.forEach { add(buildJsonObject { put("name", it.name); put("description", it.description); put("parameters", it.parameters) }) }
                        }
                    })
                }
            }
            putJsonObject("generationConfig") { put("temperature", 0.2) }
        }
        val url = "$baseUrl/models/${config.model.trim()}:generateContent?key=${config.apiKey.trim()}"
        val reply = LlmHttp.execute(http, LlmHttp.postJson(url, body, mapOf("Content-Type" to "application/json")))
        val obj = reply.jsonObject ?: throw ProviderException("Gemini returned an unexpected response (HTTP ${reply.code})", reply.code)
        if (reply.code !in 200..299 || obj.containsKey("error")) throw ProviderException(LlmHttp.errorMessage(reply, provider), reply.code)

        val candidate = obj["candidates"]?.jsonArray?.firstOrNull()?.jsonObject
            ?: run {
                val block = obj["promptFeedback"].objOrNull()?.get("blockReason")?.jsonPrimitive?.content
                throw ProviderException(if (block != null) "Request blocked: $block" else "Gemini returned no candidates")
            }
        val content = candidate["content"].objOrNull() ?: buildJsonObject { put("role", "model"); putJsonArray("parts") {} }
        val texts = ArrayList<String>()
        val calls = ArrayList<ToolCall>()
        content["parts"]?.jsonArray?.forEachIndexed { i, p ->
            val po = p.objOrNull() ?: return@forEachIndexed
            po["functionCall"].objOrNull()?.let { fc ->
                calls += ToolCall(
                    id = "call_${history.size}_$i",
                    name = fc["name"]?.jsonPrimitive?.content ?: "",
                    args = fc["args"] as? JsonObject ?: JsonObject(emptyMap()),
                )
                return@forEachIndexed
            }
            if (po["thought"]?.jsonPrimitive?.content == "true") return@forEachIndexed
            po["text"]?.jsonPrimitive?.content?.let { texts += it }
        }
        val finish = candidate["finishReason"]?.jsonPrimitive?.content
        val stop = when {
            calls.isNotEmpty() -> StopReason.TOOL_CALLS
            finish == "MAX_TOKENS" -> StopReason.MAX_TOKENS
            finish == "SAFETY" || finish == "PROHIBITED_CONTENT" || finish == "BLOCKLIST" -> StopReason.REFUSAL
            else -> StopReason.DONE
        }
        val text = texts.joinToString("\n").trim().ifEmpty { null }
        return LlmReply(Turn.Assistant(text, calls, content), stop, if (stop == StopReason.REFUSAL) "($finish)" else null)
    }

    override suspend fun listModels(apiKey: String): List<ModelInfo> {
        val reply = LlmHttp.execute(http, LlmHttp.get("$baseUrl/models?key=${apiKey.trim()}&pageSize=200", emptyMap()))
        val obj = reply.jsonObject ?: throw ProviderException("Gemini returned an unexpected response (HTTP ${reply.code})", reply.code)
        if (reply.code !in 200..299 || obj.containsKey("error")) throw ProviderException(LlmHttp.errorMessage(reply, provider), reply.code)
        return filterModels(obj["models"]?.jsonArray ?: JsonArray(emptyList()))
    }

    private fun rebuildAssistant(t: Turn.Assistant): JsonObject = buildJsonObject {
        put("role", "model")
        putJsonArray("parts") {
            t.text?.let { add(buildJsonObject { put("text", it) }) }
            t.toolCalls.forEach { c -> add(buildJsonObject { putJsonObject("functionCall") { put("name", c.name); put("args", c.args) } }) }
        }
    }

    companion object {
        const val DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta"

        fun userText(text: String): JsonObject = buildJsonObject {
            put("role", "user")
            putJsonArray("parts") { add(buildJsonObject { put("text", text) }) }
        }

        /** Tool results go back as `functionResponse` parts in a `user` content. */
        fun functionResponses(results: List<ToolResult>): JsonObject = buildJsonObject {
            put("role", "user")
            putJsonArray("parts") {
                results.forEach { r ->
                    add(buildJsonObject { putJsonObject("functionResponse") { put("name", r.name); put("response", r.result) } })
                }
            }
        }

        /** Keeps models whose `supportedGenerationMethods` contains `generateContent`. */
        fun filterModels(models: JsonArray): List<ModelInfo> = models.mapNotNull { m ->
            val o = m.objOrNull() ?: return@mapNotNull null
            val methods = o["supportedGenerationMethods"]?.jsonArray?.map { it.jsonPrimitive.content } ?: emptyList()
            if ("generateContent" !in methods) return@mapNotNull null
            val name = o["name"]?.jsonPrimitive?.content?.removePrefix("models/") ?: return@mapNotNull null
            ModelInfo(name, o["displayName"]?.jsonPrimitive?.content ?: name)
        }.sortedBy { it.name }
    }
}
