package pt.prospero.huepilot.assistant

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

/**
 * Assistant back-ends. Metadata (labels, defaults, key links) is identical to the desktop app's
 * `providers.ts` so both apps behave the same.
 */
enum class AssistantProvider(
    val id: String,
    val label: String,
    val defaultModel: String,
    val keyUrl: String,
    val keyPlaceholder: String,
    val modelHint: String,
) {
    GEMINI("gemini", "Google Gemini", "gemini-2.5-flash", "https://aistudio.google.com/apikey", "AIza…", "gemini-2.5-flash is fast and cheap."),
    OPENAI("openai", "OpenAI", "gpt-5-mini", "https://platform.openai.com/api-keys", "sk-…", "gpt-5-mini balances speed and cost; gpt-5 for the best quality."),
    ANTHROPIC("anthropic", "Anthropic Claude", "claude-opus-5", "https://console.anthropic.com/settings/keys", "sk-ant-…", "claude-opus-5 by default; claude-sonnet-5 or claude-haiku-4-5 are cheaper."),
    DEEPSEEK("deepseek", "DeepSeek", "deepseek-chat", "https://platform.deepseek.com/api_keys", "sk-…", "deepseek-chat supports tool calling."),
    OPENROUTER("openrouter", "OpenRouter", "google/gemini-2.5-flash", "https://openrouter.ai/keys", "sk-or-…", "Any OpenRouter model that supports tools, e.g. anthropic/claude-sonnet-4.5 or openai/gpt-5-mini.");

    companion object {
        fun fromId(id: String?): AssistantProvider = entries.firstOrNull { it.id == id } ?: GEMINI
    }
}

/** API key + model for one provider. */
data class ProviderConfig(val apiKey: String = "", val model: String) {
    val hasKey: Boolean get() = apiKey.isNotBlank()
}

data class ModelInfo(val name: String, val displayName: String)

class ProviderException(message: String, val statusCode: Int = 0) : Exception(message)

/** A tool the model may call: name, description and JSON-schema parameters (provider neutral). */
data class ToolSpec(val name: String, val description: String, val parameters: JsonObject)

data class ToolCall(val id: String, val name: String, val args: JsonObject)

data class ToolResult(val id: String, val name: String, val result: JsonObject, val isError: Boolean)

/** Provider-neutral conversation history. */
sealed class Turn {
    data class User(val text: String) : Turn()

    /**
     * An assistant turn. [raw] is the provider-specific payload (Gemini `content`, Anthropic `content`
     * array, OpenAI `message`) that is echoed back verbatim on the next request so that signatures,
     * thinking blocks etc. survive. It is only meaningful for the provider that produced it.
     */
    data class Assistant(val text: String?, val toolCalls: List<ToolCall>, val raw: JsonElement?) : Turn()

    data class ToolResults(val results: List<ToolResult>) : Turn()
}

enum class StopReason { TOOL_CALLS, DONE, MAX_TOKENS, REFUSAL }

data class LlmReply(val turn: Turn.Assistant, val stop: StopReason, val note: String? = null)

/** Converts the neutral history into a provider request and the response back into a [Turn.Assistant]. */
interface LlmAdapter {
    val provider: AssistantProvider

    suspend fun generate(config: ProviderConfig, systemInstruction: String, history: List<Turn>, tools: List<ToolSpec>): LlmReply

    suspend fun listModels(apiKey: String): List<ModelInfo>
}

/** Shared HTTP plumbing for cloud LLM APIs: a normal, certificate-verifying client (never the bridge one). */
object LlmHttp {
    val json: Json = Json { ignoreUnknownKeys = true; isLenient = true; explicitNulls = false }
    val jsonType = "application/json; charset=utf-8".toMediaType()

    val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(120, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    data class Reply(val code: Int, val body: String) {
        val jsonOrNull: JsonElement? get() = runCatching { json.parseToJsonElement(body) }.getOrNull()
        val jsonObject: JsonObject? get() = jsonOrNull as? JsonObject
    }

    suspend fun execute(http: OkHttpClient, request: Request): Reply = withContext(Dispatchers.IO) {
        http.newCall(request).execute().use { resp -> Reply(resp.code, resp.body?.string().orEmpty()) }
    }

    fun postJson(url: String, body: JsonObject, headers: Map<String, String>): Request {
        val b = Request.Builder().url(url).post(body.toString().toRequestBody(jsonType))
        headers.forEach { (k, v) -> b.header(k, v) }
        return b.build()
    }

    fun get(url: String, headers: Map<String, String>): Request {
        val b = Request.Builder().url(url).get()
        headers.forEach { (k, v) -> b.header(k, v) }
        return b.build()
    }

    /** Extracts `error.message` from a failed reply, or a generic message. */
    fun errorMessage(reply: Reply, provider: AssistantProvider): String {
        val err = reply.jsonObject?.get("error")
        val msg = when (err) {
            is JsonObject -> err["message"]?.jsonPrimitive?.content
            null -> null
            else -> runCatching { err.jsonPrimitive.content }.getOrNull()
        }
        val base = msg?.takeIf { it.isNotBlank() } ?: "${provider.label} error"
        return "$base (HTTP ${reply.code})"
    }
}

/** Helper so adapters can read `obj["x"]` as an object without exceptions. */
internal fun JsonElement?.objOrNull(): JsonObject? = runCatching { this?.jsonObject }.getOrNull()
