package pt.prospero.huepilot.assistant

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import okhttp3.OkHttpClient

/**
 * Anthropic Messages API over REST. Assistant turns echo the response `content` array verbatim
 * (including `thinking` blocks); all tool results of a round go back in ONE user message.
 */
class AnthropicAdapter(
    private val http: OkHttpClient = LlmHttp.client,
    private val baseUrl: String = DEFAULT_BASE,
) : LlmAdapter {
    override val provider = AssistantProvider.ANTHROPIC

    private fun headers(apiKey: String) = mapOf(
        "x-api-key" to apiKey.trim(),
        "anthropic-version" to API_VERSION,
        "content-type" to "application/json",
    )

    override suspend fun generate(config: ProviderConfig, systemInstruction: String, history: List<Turn>, tools: List<ToolSpec>): LlmReply {
        val messages = buildJsonArray {
            for (t in history) when (t) {
                is Turn.User -> add(buildJsonObject {
                    put("role", "user")
                    putJsonArray("content") { add(buildJsonObject { put("type", "text"); put("text", t.text) }) }
                })
                is Turn.Assistant -> add(buildJsonObject {
                    put("role", "assistant")
                    put("content", t.raw as? JsonArray ?: rebuildContent(t))
                })
                is Turn.ToolResults -> add(toolResultsMessage(t.results))
            }
        }
        val model = config.model.trim()
        val body = buildJsonObject {
            put("model", model)
            put("max_tokens", MAX_TOKENS)
            put("system", systemInstruction)
            put("messages", messages)
            if (tools.isNotEmpty()) {
                putJsonArray("tools") {
                    tools.forEach { s -> add(buildJsonObject { put("name", s.name); put("description", s.description); put("input_schema", s.parameters) }) }
                }
            }
            if (supportsEffort(model)) putJsonObject("output_config") { put("effort", "low") }
        }
        val reply = LlmHttp.execute(http, LlmHttp.postJson("$baseUrl/v1/messages", body, headers(config.apiKey)))
        val obj = reply.jsonObject ?: throw ProviderException("Anthropic returned an unexpected response (HTTP ${reply.code})", reply.code)
        if (reply.code !in 200..299 || obj["type"]?.jsonPrimitive?.content == "error") throw ProviderException(errorText(reply), reply.code)

        val content = obj["content"]?.let { runCatching { it.jsonArray }.getOrNull() } ?: JsonArray(emptyList())
        val texts = ArrayList<String>()
        val calls = ArrayList<ToolCall>()
        content.forEachIndexed { i, block ->
            val b = block.objOrNull() ?: return@forEachIndexed
            when (b["type"]?.jsonPrimitive?.content) {
                "text" -> b["text"]?.jsonPrimitive?.content?.let { texts += it }
                "tool_use" -> calls += ToolCall(
                    id = b["id"]?.jsonPrimitive?.content ?: "toolu_${history.size}_$i",
                    name = b["name"]?.jsonPrimitive?.content ?: "",
                    args = b["input"] as? JsonObject ?: JsonObject(emptyMap()),
                )
            }
        }
        val stopReason = obj["stop_reason"]?.jsonPrimitive?.content
        var note: String? = null
        val stop = when (stopReason) {
            "tool_use" -> StopReason.TOOL_CALLS
            "max_tokens" -> { note = "The reply was cut short by the model's output limit."; StopReason.MAX_TOKENS }
            "refusal" -> {
                note = obj["stop_details"].objOrNull()?.get("explanation")?.jsonPrimitive?.content
                StopReason.REFUSAL
            }
            else -> if (calls.isNotEmpty()) StopReason.TOOL_CALLS else StopReason.DONE
        }
        val text = texts.joinToString("\n").trim().ifEmpty { null }
        return LlmReply(Turn.Assistant(text, calls, content), stop, note)
    }

    override suspend fun listModels(apiKey: String): List<ModelInfo> {
        val out = ArrayList<ModelInfo>()
        var afterId: String? = null
        repeat(20) {
            val url = "$baseUrl/v1/models?limit=100" + (afterId?.let { "&after_id=$it" } ?: "")
            val reply = LlmHttp.execute(http, LlmHttp.get(url, headers(apiKey)))
            val obj = reply.jsonObject ?: throw ProviderException("Anthropic returned an unexpected response (HTTP ${reply.code})", reply.code)
            if (reply.code !in 200..299 || obj["type"]?.jsonPrimitive?.content == "error") throw ProviderException(errorText(reply), reply.code)
            val data = obj["data"]?.let { runCatching { it.jsonArray }.getOrNull() } ?: JsonArray(emptyList())
            for (m in data) {
                val o = m.objOrNull() ?: continue
                val id = o["id"]?.jsonPrimitive?.content ?: continue
                out += ModelInfo(id, o["display_name"]?.jsonPrimitive?.content ?: id)
            }
            val hasMore = obj["has_more"]?.jsonPrimitive?.content == "true"
            val lastId = obj["last_id"]?.jsonPrimitive?.content
            if (!hasMore || lastId.isNullOrBlank() || data.isEmpty()) return out.distinctBy { it.name }
            afterId = lastId
        }
        return out.distinctBy { it.name }
    }

    private fun errorText(reply: LlmHttp.Reply): String {
        if (reply.code == 401) return "Invalid Anthropic API key (HTTP 401)"
        val err = reply.jsonObject?.get("error").objOrNull()
        val msg = err?.get("message")?.jsonPrimitive?.content
        val type = err?.get("type")?.jsonPrimitive?.content
        return listOfNotNull(msg ?: "Anthropic error", type?.let { "[$it]" }).joinToString(" ") + " (HTTP ${reply.code})"
    }

    private fun rebuildContent(t: Turn.Assistant): JsonArray = buildJsonArray {
        t.text?.let { add(buildJsonObject { put("type", "text"); put("text", it) }) }
        t.toolCalls.forEach { c -> add(buildJsonObject { put("type", "tool_use"); put("id", c.id); put("name", c.name); put("input", c.args) }) }
    }

    companion object {
        const val DEFAULT_BASE = "https://api.anthropic.com"
        const val API_VERSION = "2023-06-01"
        const val MAX_TOKENS = 16000
        private val effortModels = Regex("claude-(opus-(4-[5678]|5)|sonnet-(4-6|5)|fable|mythos)")

        /** Models that accept `output_config.effort` (Haiku and older models reject it). */
        fun supportsEffort(model: String): Boolean = effortModels.containsMatchIn(model)

        /** One user message carrying every tool_result of the round. */
        fun toolResultsMessage(results: List<ToolResult>): JsonObject = buildJsonObject {
            put("role", "user")
            putJsonArray("content") {
                results.forEach { r ->
                    add(buildJsonObject {
                        put("type", "tool_result")
                        put("tool_use_id", r.id)
                        put("content", r.result.toString())
                        put("is_error", r.isError)
                    })
                }
            }
        }
    }
}
