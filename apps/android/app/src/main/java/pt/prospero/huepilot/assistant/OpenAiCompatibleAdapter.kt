package pt.prospero.huepilot.assistant

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import okhttp3.OkHttpClient

/**
 * Chat Completions adapter used for OpenAI, DeepSeek and OpenRouter.
 * `POST {base}/chat/completions` with `tools` / `tool_calls` / `tool` messages. No `temperature` is sent
 * (GPT-5 models reject it).
 */
class OpenAiCompatibleAdapter(
    override val provider: AssistantProvider,
    private val http: OkHttpClient = LlmHttp.client,
    private val baseUrl: String = defaultBase(provider),
) : LlmAdapter {

    private fun headers(apiKey: String): Map<String, String> {
        val h = linkedMapOf("Authorization" to "Bearer ${apiKey.trim()}", "Content-Type" to "application/json")
        if (provider == AssistantProvider.OPENROUTER) {
            h["HTTP-Referer"] = "https://hue-pilot.local"
            h["X-Title"] = "Hue Pilot"
        }
        return h
    }

    override suspend fun generate(config: ProviderConfig, systemInstruction: String, history: List<Turn>, tools: List<ToolSpec>): LlmReply {
        val messages = buildJsonArray {
            add(buildJsonObject { put("role", "system"); put("content", systemInstruction) })
            for (t in history) when (t) {
                is Turn.User -> add(buildJsonObject { put("role", "user"); put("content", t.text) })
                is Turn.Assistant -> add(assistantMessage(t))
                is Turn.ToolResults -> t.results.forEach { r ->
                    add(buildJsonObject { put("role", "tool"); put("tool_call_id", r.id); put("content", r.result.toString()) })
                }
            }
        }
        val body = buildJsonObject {
            put("model", config.model.trim())
            put("messages", messages)
            if (tools.isNotEmpty()) {
                putJsonArray("tools") {
                    tools.forEach { s ->
                        add(buildJsonObject {
                            put("type", "function")
                            putJsonObject("function") { put("name", s.name); put("description", s.description); put("parameters", s.parameters) }
                        })
                    }
                }
                put("tool_choice", "auto")
            }
        }
        val reply = LlmHttp.execute(http, LlmHttp.postJson("$baseUrl/chat/completions", body, headers(config.apiKey)))
        val obj = reply.jsonObject ?: throw ProviderException("${provider.label} returned an unexpected response (HTTP ${reply.code})", reply.code)
        if (reply.code !in 200..299 || obj.containsKey("error")) throw ProviderException(LlmHttp.errorMessage(reply, provider), reply.code)

        val choice = obj["choices"]?.jsonArray?.firstOrNull().objOrNull()
            ?: throw ProviderException("${provider.label} returned no choices")
        val message = choice["message"].objOrNull() ?: JsonObject(emptyMap())
        val content = message["content"]?.let { if (it is JsonNull) null else runCatching { it.jsonPrimitive.content }.getOrNull() }
        val calls = message["tool_calls"]?.let { runCatching { it.jsonArray }.getOrNull() }?.mapIndexedNotNull { i, tc ->
            val o = tc.objOrNull() ?: return@mapIndexedNotNull null
            val fn = o["function"].objOrNull() ?: return@mapIndexedNotNull null
            val argsText = fn["arguments"]?.let { runCatching { it.jsonPrimitive.content }.getOrNull() } ?: "{}"
            val args = runCatching { LlmHttp.json.parseToJsonElement(argsText) as? JsonObject }.getOrNull() ?: JsonObject(emptyMap())
            ToolCall(
                id = o["id"]?.jsonPrimitive?.content ?: "call_${history.size}_$i",
                name = fn["name"]?.jsonPrimitive?.content ?: "",
                args = args,
            )
        } ?: emptyList()
        val finish = choice["finish_reason"]?.let { if (it is JsonNull) null else it.jsonPrimitive.content }
        val stop = when {
            finish == "tool_calls" || calls.isNotEmpty() -> StopReason.TOOL_CALLS
            finish == "length" -> StopReason.MAX_TOKENS
            finish == "content_filter" -> StopReason.REFUSAL
            else -> StopReason.DONE
        }
        return LlmReply(Turn.Assistant(content?.trim()?.ifEmpty { null }, calls, message), stop)
    }

    override suspend fun listModels(apiKey: String): List<ModelInfo> {
        val reply = LlmHttp.execute(http, LlmHttp.get("$baseUrl/models", headers(apiKey)))
        val obj = reply.jsonObject ?: throw ProviderException("${provider.label} returned an unexpected response (HTTP ${reply.code})", reply.code)
        if (reply.code !in 200..299 || obj.containsKey("error")) throw ProviderException(LlmHttp.errorMessage(reply, provider), reply.code)
        return filterModels(provider, obj["data"]?.let { runCatching { it.jsonArray }.getOrNull() } ?: JsonArray(emptyList()))
    }

    companion object {
        fun defaultBase(provider: AssistantProvider): String = when (provider) {
            AssistantProvider.OPENAI -> "https://api.openai.com/v1"
            AssistantProvider.DEEPSEEK -> "https://api.deepseek.com/v1"
            AssistantProvider.OPENROUTER -> "https://openrouter.ai/api/v1"
            else -> throw IllegalArgumentException("${provider.id} is not an OpenAI-compatible provider")
        }

        private val openAiPrefixes = listOf("gpt-", "o1", "o3", "o4", "chatgpt-")
        private val openAiExcluded = listOf("audio", "realtime", "tts", "transcribe", "embedding", "image", "search", "instruct", "moderation", "codex")
        const val OPENROUTER_CAP = 300

        /** Builds the `assistant` message from a neutral turn (content or null + tool_calls). */
        fun assistantMessage(t: Turn.Assistant): JsonObject = buildJsonObject {
            put("role", "assistant")
            put("content", t.text?.let { JsonPrimitive(it) } ?: JsonNull)
            if (t.toolCalls.isNotEmpty()) {
                putJsonArray("tool_calls") {
                    t.toolCalls.forEach { c ->
                        add(buildJsonObject {
                            put("id", c.id)
                            put("type", "function")
                            putJsonObject("function") { put("name", c.name); put("arguments", c.args.toString()) }
                        })
                    }
                }
            }
        }

        /** Provider-specific filtering of `GET /models` → `data[]`. */
        fun filterModels(provider: AssistantProvider, data: JsonArray): List<ModelInfo> {
            val entries = data.mapNotNull { it.objOrNull() }
            return when (provider) {
                AssistantProvider.OPENAI -> entries.mapNotNull { o -> o["id"]?.jsonPrimitive?.content }
                    .filter { id -> openAiPrefixes.any { id.startsWith(it) } && openAiExcluded.none { id.contains(it) } }
                    .distinct().sorted().map { ModelInfo(it, it) }
                AssistantProvider.OPENROUTER -> entries.mapNotNull { o ->
                    val id = o["id"]?.jsonPrimitive?.content ?: return@mapNotNull null
                    val params = o["supported_parameters"]?.let { runCatching { it.jsonArray }.getOrNull() }?.map { it.jsonPrimitive.content } ?: emptyList()
                    if ("tools" !in params) return@mapNotNull null
                    ModelInfo(id, o["name"]?.jsonPrimitive?.content?.takeIf { it.isNotBlank() } ?: id)
                }.sortedBy { it.name }.take(OPENROUTER_CAP)
                else -> entries.mapNotNull { o -> o["id"]?.jsonPrimitive?.content }.distinct().sorted().map { ModelInfo(it, it) }
            }
        }
    }
}
