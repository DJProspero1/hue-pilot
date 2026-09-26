package pt.prospero.huepilot

import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.Test
import pt.prospero.huepilot.assistant.AssistantEngine
import pt.prospero.huepilot.assistant.AssistantEvent
import pt.prospero.huepilot.assistant.AssistantProvider
import pt.prospero.huepilot.assistant.HueTools
import pt.prospero.huepilot.assistant.LlmAdapter
import pt.prospero.huepilot.assistant.LlmReply
import pt.prospero.huepilot.assistant.ModelInfo
import pt.prospero.huepilot.assistant.ProviderConfig
import pt.prospero.huepilot.assistant.StopReason
import pt.prospero.huepilot.assistant.ToolCall
import pt.prospero.huepilot.assistant.ToolSpec
import pt.prospero.huepilot.assistant.Turn
import pt.prospero.huepilot.data.hue.HueRepository

class AssistantEngineTest {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val tools = HueTools(HueRepository(scope)) // not connected: tools answer not_connected / not_found
    private val config = ProviderConfig("key", "fake-model")

    /** Scripted adapter: returns the given replies in order and records what it was asked. */
    private class FakeAdapter(private val script: List<() -> LlmReply>) : LlmAdapter {
        override val provider = AssistantProvider.GEMINI
        val seenHistories = ArrayList<List<Turn>>()
        val seenTools = ArrayList<List<ToolSpec>>()
        private var i = 0
        override suspend fun generate(config: ProviderConfig, systemInstruction: String, history: List<Turn>, tools: List<ToolSpec>): LlmReply {
            seenHistories += history; seenTools += tools
            return script[minOf(i++, script.size - 1)]()
        }
        override suspend fun listModels(apiKey: String): List<ModelInfo> = emptyList()
    }

    private fun text(t: String) = LlmReply(Turn.Assistant(t, emptyList(), null), StopReason.DONE)
    private fun call(name: String, args: JsonObject = JsonObject(emptyMap()), id: String = "c1") =
        LlmReply(Turn.Assistant(null, listOf(ToolCall(id, name, args)), null), StopReason.TOOL_CALLS)

    @Test
    fun `tool round trip appends assistant and tool-result turns then ends with text`(): Unit = runBlocking {
        val adapter = FakeAdapter(listOf({ call("get_home_overview") }, { text("The bridge is not connected.") }))
        val engine = AssistantEngine(tools)
        val events = ArrayList<AssistantEvent>()
        engine.ask("what is on?", "system", adapter, config) { events += it }

        assertThat(adapter.seenTools[0]).hasSize(12)
        // 1st request: just the user turn. 2nd: user, assistant(tool call), tool results.
        assertThat(adapter.seenHistories[0]).hasSize(1)
        assertThat(adapter.seenHistories[1]).hasSize(3)
        val results = adapter.seenHistories[1][2] as Turn.ToolResults
        assertThat(results.results.single().id).isEqualTo("c1")
        assertThat(results.results.single().name).isEqualTo("get_home_overview")
        assertThat(results.results.single().result["ok"]!!.jsonPrimitive.content).isEqualTo("false")
        assertThat(results.results.single().isError).isTrue() // not_connected counts as a bridge failure

        assertThat(events).hasSize(2)
        val tc = events[0] as AssistantEvent.ToolCall
        assertThat(tc.ok).isFalse()
        assertThat((events[1] as AssistantEvent.Answer).text).isEqualTo("The bridge is not connected.")
        assertThat(engine.history).hasSize(4)
    }

    @Test
    fun `semantic failures are not flagged as bridge errors`(): Unit = runBlocking {
        val adapter = FakeAdapter(listOf({ call("set_room", buildJsonObject { put("room", "garage"); put("on", true) }) }, { text("ok") }))
        val engine = AssistantEngine(tools)
        engine.ask("turn on the garage", "system", adapter, config) {}
        val results = engine.history[2] as Turn.ToolResults
        assertThat(results.results.single().result["error"]!!.jsonPrimitive.content).isEqualTo("not_found")
        assertThat(results.results.single().isError).isFalse()
    }

    @Test
    fun `loop stops after max iterations`(): Unit = runBlocking {
        val adapter = FakeAdapter(listOf({ call("get_sensor_readings") }))
        val engine = AssistantEngine(tools, maxIterations = 3)
        val events = ArrayList<AssistantEvent>()
        engine.ask("loop forever", "system", adapter, config) { events += it }
        assertThat(events.filterIsInstance<AssistantEvent.ToolCall>()).hasSize(3)
        assertThat(events.last()).isInstanceOf(AssistantEvent.Answer::class.java)
    }

    @Test
    fun `refusal max_tokens and errors are surfaced`(): Unit = runBlocking {
        val refusing = FakeAdapter(listOf({ LlmReply(Turn.Assistant(null, emptyList(), null), StopReason.REFUSAL, "Policy X") }))
        val ev1 = ArrayList<AssistantEvent>()
        AssistantEngine(tools).ask("hi", "s", refusing, config) { ev1 += it }
        assertThat((ev1.single() as AssistantEvent.Answer).text).isEqualTo("The model declined this request. Policy X")

        val truncated = FakeAdapter(listOf({ LlmReply(Turn.Assistant("Half an answ", emptyList(), null), StopReason.MAX_TOKENS) }))
        val ev2 = ArrayList<AssistantEvent>()
        AssistantEngine(tools).ask("hi", "s", truncated, config) { ev2 += it }
        assertThat((ev2.single() as AssistantEvent.Answer).text).startsWith("Half an answ")
        assertThat((ev2.single() as AssistantEvent.Answer).text).contains("cut short")

        val failing = FakeAdapter(listOf({ throw IllegalStateException("quota exceeded") }))
        val ev3 = ArrayList<AssistantEvent>()
        AssistantEngine(tools).ask("hi", "s", failing, config) { ev3 += it }
        assertThat((ev3.single() as AssistantEvent.Failure).message).isEqualTo("quota exceeded")

        val unknown = FakeAdapter(listOf({ call("fly_to_moon") }, { text("ok") }))
        val ev4 = ArrayList<AssistantEvent>()
        AssistantEngine(tools).ask("hi", "s", unknown, config) { ev4 += it }
        val callEv = ev4.first() as AssistantEvent.ToolCall
        assertThat(callEv.ok).isFalse()
        assertThat(callEv.result["error"]!!.jsonPrimitive.content).isEqualTo("unknown_tool")
    }

    @Test
    fun `reset clears the history`(): Unit = runBlocking {
        val engine = AssistantEngine(tools)
        engine.ask("hi", "s", FakeAdapter(listOf({ text("hello") })), config) {}
        assertThat(engine.history).hasSize(2)
        engine.reset()
        assertThat(engine.history).isEmpty()
    }

    @Test
    fun `tool declarations match the shared contract`() {
        val names = tools.specs.map { it.name }
        assertThat(names).containsExactly(
            "get_home_overview", "set_room", "set_light", "set_all_lights", "activate_scene", "set_effect",
            "identify_light", "get_sensor_readings", "set_camera_motion_detection", "list_schedules", "create_schedule", "delete_schedule",
        ).inOrder()
        assertThat(tools.declarations.map { it.jsonObject["name"]!!.jsonPrimitive.content }).isEqualTo(names)
        val setRoom = tools.specs.first { it.name == "set_room" }
        assertThat(setRoom.parameters["properties"]!!.jsonObject.keys).containsExactly("room", "on", "brightness", "color", "color_temperature", "transition_seconds")
        val overview = tools.specs.first { it.name == "get_home_overview" }
        assertThat(overview.parameters["type"]!!.jsonPrimitive.content).isEqualTo("object")
        assertThat(overview.parameters["properties"]!!.jsonObject).isEmpty()
        val effect = tools.specs.first { it.name == "set_effect" }
        val enumValues = effect.parameters["properties"]!!.jsonObject["effect"]!!.jsonObject["enum"]!!.jsonArray.map { it.jsonPrimitive.content }
        assertThat(enumValues).containsExactly("candle", "fire", "prism", "sparkle", "opal", "glisten", "underwater", "cosmos", "sunbeam", "enchant", "no_effect")
    }
}
