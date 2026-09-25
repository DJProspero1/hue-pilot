package pt.prospero.huepilot.assistant

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Something that happened while answering one user message. */
sealed class AssistantEvent {
    data class ToolCall(val name: String, val label: String, val ok: Boolean, val args: JsonObject, val result: JsonObject) : AssistantEvent()
    data class Answer(val text: String) : AssistantEvent()
    data class Failure(val message: String) : AssistantEvent()
}

/**
 * The provider-neutral function-calling loop: send the history -> if the model asked for tools, run
 * them locally against the bridge, append the results and repeat -> until a text answer or
 * [maxIterations] tool rounds. The history is provider-specific (assistant turns carry raw payloads),
 * so it is reset whenever the provider or model changes.
 */
class AssistantEngine(
    private val tools: HueTools,
    private val maxIterations: Int = 8,
) {
    val history = ArrayList<Turn>()

    fun reset() = history.clear()

    suspend fun ask(
        userText: String,
        systemInstruction: String,
        adapter: LlmAdapter,
        config: ProviderConfig,
        onEvent: (AssistantEvent) -> Unit,
    ) {
        history += Turn.User(userText)
        try {
            repeat(maxIterations) {
                val reply = adapter.generate(config, systemInstruction, history.toList(), tools.specs)
                history += reply.turn
                if (reply.stop == StopReason.REFUSAL) {
                    onEvent(AssistantEvent.Answer("The model declined this request." + (reply.note?.takeIf { it.isNotBlank() }?.let { " $it" } ?: "")))
                    return
                }
                if (reply.turn.toolCalls.isEmpty()) {
                    var text = reply.turn.text?.trim().orEmpty().ifEmpty { "Done." }
                    if (reply.stop == StopReason.MAX_TOKENS) text += "\n\n(" + (reply.note ?: "The reply was cut short by the model's output limit.") + ")"
                    onEvent(AssistantEvent.Answer(text))
                    return
                }
                val results = reply.turn.toolCalls.map { c ->
                    val result = tools.execute(c.name, c.args)
                    val ok = result["ok"]?.jsonPrimitive?.content == "true"
                    onEvent(AssistantEvent.ToolCall(c.name, tools.summarize(c.name, c.args, result), ok, c.args, result))
                    ToolResult(c.id, c.name, result, isError = HueTools.isBridgeFailure(result))
                }
                history += Turn.ToolResults(results)
            }
            onEvent(AssistantEvent.Answer("I ran out of steps; the actions above were applied."))
        } catch (e: Exception) {
            onEvent(AssistantEvent.Failure(e.message ?: "Something went wrong"))
        }
    }
}
