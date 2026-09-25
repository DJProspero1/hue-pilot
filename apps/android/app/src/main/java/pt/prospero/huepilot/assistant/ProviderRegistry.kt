package pt.prospero.huepilot.assistant

import okhttp3.OkHttpClient

/** Creates one adapter per provider (cached). Tests can pass their own clients/base URLs directly. */
class ProviderRegistry(private val http: OkHttpClient = LlmHttp.client) {
    private val adapters = HashMap<AssistantProvider, LlmAdapter>()

    @Synchronized
    fun adapter(provider: AssistantProvider): LlmAdapter = adapters.getOrPut(provider) {
        when (provider) {
            AssistantProvider.GEMINI -> GeminiAdapter(http)
            AssistantProvider.ANTHROPIC -> AnthropicAdapter(http)
            AssistantProvider.OPENAI, AssistantProvider.DEEPSEEK, AssistantProvider.OPENROUTER -> OpenAiCompatibleAdapter(provider, http)
        }
    }
}
