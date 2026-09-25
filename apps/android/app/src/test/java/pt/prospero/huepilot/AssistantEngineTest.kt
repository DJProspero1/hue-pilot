package pt.prospero.huepilot

import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import org.junit.Test
import pt.prospero.huepilot.assistant.AssistantEngine
import pt.prospero.huepilot.assistant.AssistantEvent
import pt.prospero.huepilot.assistant.GeminiPart
import pt.prospero.huepilot.assistant.GeminiReply
import pt.prospero.huepilot.assistant.HueTools
import pt.prospero.huepilot.data.hue.HueRepository

class AssistantEngineTest {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val tools = HueTools(HueRepository(scope)) // not connected: tools answer not_connected / bridge errors

    private fun modelText(text: String) = GeminiReply(
        listOf(GeminiPart.Text(text)),
        buildJsonObject { put("role", "model"); putJsonArray("parts") { add(buildJsonObject { put("text", text) }) } },
    )

    private fun modelCall(name: String, args: Map<String, String>) = GeminiReply(
        listOf(GeminiPart.FunctionCall(name, buildJsonObject { args.forEach { (k, v) -> put(k, v) } })),
        buildJsonObject {
            put("role", "model")
            putJsonArray("parts") { add(buildJsonObject { putJsonObject("functionCall") { put("name", name); putJsonObject("args") { args.forEach { (k, v) -> put(k, v) } } } }) }
        },
    )

    @Test
    fun `function call round trip sends functionResponse with role user and ends with text`(): Unit = runBlocking {
        val seen = ArrayList<JsonArray>()
        var turn = 0
        val engine = AssistantEngine(tools, { _, contents, declarations ->
            seen += contents
            assertThat(declarations.size).isEqualTo(11)
            when (turn++) {
                0 -> modelCall("get_home_overview", emptyMap())
                else -> modelText("The bridge is not connected.")
            }
        })
        val events = ArrayList<AssistantEvent>()
        engine.ask("what is on?", "system") { events += it }

        // 1st request: just the user message. 2nd request: user, model(functionCall), user(functionResponse)
        assertThat(seen[0].size).isEqualTo(1)
        assertThat(seen[1].size).isEqualTo(3)
        val fr = seen[1][2].jsonObject
        assertThat(fr["role"]!!.jsonPrimitive.content).isEqualTo("user")
        val part = fr["parts"]!!.jsonArray[0].jsonObject["functionResponse"]!!.jsonObject
        assertThat(part["name"]!!.jsonPrimitive.content).isEqualTo("get_home_overview")
        assertThat(part["response"]!!.jsonObject["ok"]!!.jsonPrimitive.content).isEqualTo("false")

        assertThat(events).hasSize(2)
        assertThat(events[0]).isInstanceOf(AssistantEvent.ToolCall::class.java)
        assertThat((events[0] as AssistantEvent.ToolCall).ok).isFalse()
        assertThat((events[1] as AssistantEvent.Answer).text).isEqualTo("The bridge is not connected.")
        assertThat(engine.contents).hasSize(4)
    }

    @Test
    fun `loop stops after max iterations`(): Unit = runBlocking {
        val engine = AssistantEngine(tools, { _, _, _ -> modelCall("get_sensor_readings", emptyMap()) }, maxIterations = 3)
        val events = ArrayList<AssistantEvent>()
        engine.ask("loop forever", "system") { events += it }
        assertThat(events.filterIsInstance<AssistantEvent.ToolCall>()).hasSize(3)
        assertThat(events.last()).isInstanceOf(AssistantEvent.Answer::class.java)
    }

    @Test
    fun `model errors become failures and unknown tools are reported`(): Unit = runBlocking {
        val failing = AssistantEngine(tools, { _, _, _ -> throw IllegalStateException("quota exceeded") })
        val events = ArrayList<AssistantEvent>()
        failing.ask("hi", "system") { events += it }
        assertThat((events.single() as AssistantEvent.Failure).message).isEqualTo("quota exceeded")

        var turn = 0
        val unknown = AssistantEngine(tools, { _, _, _ -> if (turn++ == 0) modelCall("fly_to_moon", mapOf("x" to "1")) else modelText("ok") })
        val ev2 = ArrayList<AssistantEvent>()
        unknown.ask("hi", "system") { ev2 += it }
        val call = ev2.first() as AssistantEvent.ToolCall
        assertThat(call.ok).isFalse()
        assertThat(call.result["error"]!!.jsonPrimitive.content).isEqualTo("unknown_tool")
    }

    @Test
    fun `tool declarations match the shared contract`() {
        val names = tools.declarations.map { it.jsonObject["name"]!!.jsonPrimitive.content }
        assertThat(names).containsExactly(
            "get_home_overview", "set_room", "set_light", "set_all_lights", "activate_scene", "set_effect",
            "identify_light", "get_sensor_readings", "list_schedules", "create_schedule", "delete_schedule",
        ).inOrder()
        val setRoom = tools.declarations.first { it.jsonObject["name"]!!.jsonPrimitive.content == "set_room" }.jsonObject
        val props = setRoom["parameters"]!!.jsonObject["properties"]!!.jsonObject.keys
        assertThat(props).containsExactly("room", "on", "brightness", "color", "color_temperature", "transition_seconds")
        val effect = tools.declarations.first { it.jsonObject["name"]!!.jsonPrimitive.content == "set_effect" }.jsonObject
        val enumValues = effect["parameters"]!!.jsonObject["properties"]!!.jsonObject["effect"]!!.jsonObject["enum"]!!.jsonArray.map { it.jsonPrimitive.content }
        assertThat(enumValues).containsExactly("candle", "fire", "prism", "sparkle", "opal", "glisten", "underwater", "cosmos", "sunbeam", "enchant", "no_effect")
    }
}
