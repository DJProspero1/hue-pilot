package pt.prospero.huepilot.assistant

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive

/** Something that happened while answering one user message. */
sealed class AssistantEvent {
    data class ToolCall(val name: String, val label: String, val ok: Boolean, val args: JsonObject, val result: JsonObject) : AssistantEvent()
    data class Answer(val text: String) : AssistantEvent()
    data class Failure(val message: String) : AssistantEvent()
}

/** Signature of the model call: (systemInstruction, contents, functionDeclarations) -> reply. */
typealias GenerateFn = suspend (systemInstruction: String, contents: JsonArray, declarations: JsonArray) -> GeminiReply

/**
 * The Gemini function-calling loop, independent of Android so it can be unit-tested:
 * send the conversation -> if the model returns functionCall parts, execute them locally and send
 * back functionResponse parts (role user) -> repeat until a text answer or [maxIterations].
 */
class AssistantEngine(
    private val tools: HueTools,
    private val generate: GenerateFn,
    private val maxIterations: Int = 8,
) {
    /** Conversation history in Gemini `contents` format. */
    val contents = ArrayList<JsonObject>()

    fun reset() = contents.clear()

    suspend fun ask(userText: String, systemInstruction: String, onEvent: (AssistantEvent) -> Unit) {
        contents += GeminiClient.userText(userText)
        try {
            var iterations = 0
            while (iterations < maxIterations) {
                iterations++
                val reply = generate(systemInstruction, JsonArray(contents.toList()), tools.declarations)
                contents += reply.rawContent
                val calls = reply.parts.filterIsInstance<GeminiPart.FunctionCall>()
                if (calls.isEmpty()) {
                    val text = reply.parts.filterIsInstance<GeminiPart.Text>().joinToString("\n") { it.text }.trim()
                    onEvent(AssistantEvent.Answer(text.ifEmpty { "Done." }))
                    return
                }
                val responses = ArrayList<Pair<String, JsonObject>>()
                for (c in calls) {
                    val result = tools.execute(c.name, c.args)
                    val ok = result["ok"]?.jsonPrimitive?.content == "true"
                    onEvent(AssistantEvent.ToolCall(c.name, tools.summarize(c.name, c.args, result), ok, c.args, result))
                    responses += c.name to result
                }
                contents += GeminiClient.functionResponses(responses)
            }
            onEvent(AssistantEvent.Answer("I ran out of steps; the actions above were applied."))
        } catch (e: Exception) {
            onEvent(AssistantEvent.Failure(e.message ?: "Something went wrong"))
        }
    }
}
