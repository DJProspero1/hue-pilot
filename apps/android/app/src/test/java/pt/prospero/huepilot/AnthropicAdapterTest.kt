package pt.prospero.huepilot

import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Before
import org.junit.Test
import pt.prospero.huepilot.assistant.AnthropicAdapter
import pt.prospero.huepilot.assistant.AssistantEngine
import pt.prospero.huepilot.assistant.AssistantEvent
import pt.prospero.huepilot.assistant.HueTools
import pt.prospero.huepilot.assistant.ProviderConfig
import pt.prospero.huepilot.assistant.StopReason
import pt.prospero.huepilot.data.hue.HueRepository

class AnthropicAdapterTest {
    private val server = MockWebServer()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val tools = HueTools(HueRepository(scope))
    private val json = Json { ignoreUnknownKeys = true }

    @Before fun start() = server.start()
    @After fun stop() = server.shutdown()

    private fun adapter() = AnthropicAdapter(OkHttpClient(), server.url("/").toString().trimEnd('/'))
    private fun json(body: String, code: Int = 200) = MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    private val firstContent = """[{"type":"thinking","thinking":"The user wants the office on.","signature":"sig-ABC"},{"type":"text","text":"Let me check."},{"type":"tool_use","id":"toolu_01","name":"get_home_overview","input":{}},{"type":"tool_use","id":"toolu_02","name":"set_room","input":{"room":"Office","on":true}}]"""

    @Test
    fun `tool_use - single tool_result message - end_turn, assistant content echoed verbatim`(): Unit = runBlocking {
        server.enqueue(json("""{"id":"msg_1","type":"message","role":"assistant","model":"claude-opus-5","content":$firstContent,"stop_reason":"tool_use"}"""))
        server.enqueue(json("""{"id":"msg_2","type":"message","role":"assistant","content":[{"type":"text","text":"All done."}],"stop_reason":"end_turn"}"""))

        val events = ArrayList<AssistantEvent>()
        AssistantEngine(tools).ask("turn on the office", "SYSTEM", adapter(), ProviderConfig("sk-ant-test", "claude-opus-5")) { events += it }

        // --- request 1
        val r1 = server.takeRequest()
        assertThat(r1.path).isEqualTo("/v1/messages")
        assertThat(r1.getHeader("x-api-key")).isEqualTo("sk-ant-test")
        assertThat(r1.getHeader("anthropic-version")).isEqualTo("2023-06-01")
        assertThat(r1.getHeader("content-type")).startsWith("application/json")
        val b1 = json.parseToJsonElement(r1.body.readUtf8()).jsonObject
        assertThat(b1["model"]!!.jsonPrimitive.content).isEqualTo("claude-opus-5")
        assertThat(b1["max_tokens"]!!.jsonPrimitive.content).isEqualTo("16000")
        assertThat(b1["system"]!!.jsonPrimitive.content).isEqualTo("SYSTEM")
        assertThat(b1.containsKey("temperature")).isFalse()
        assertThat(b1.containsKey("thinking")).isFalse()
        assertThat(b1["output_config"]!!.jsonObject["effort"]!!.jsonPrimitive.content).isEqualTo("low")
        val t0 = b1["tools"]!!.jsonArray[0].jsonObject
        assertThat(t0["name"]!!.jsonPrimitive.content).isEqualTo("get_home_overview")
        assertThat(t0["input_schema"]!!.jsonObject["type"]!!.jsonPrimitive.content).isEqualTo("object")
        assertThat(t0["input_schema"]!!.jsonObject["properties"]!!.jsonObject).isEmpty()
        val m1 = b1["messages"]!!.jsonArray
        assertThat(m1).hasSize(1)
        assertThat(m1[0].jsonObject["role"]!!.jsonPrimitive.content).isEqualTo("user")
        assertThat(m1[0].jsonObject["content"]!!.jsonArray[0].jsonObject["text"]!!.jsonPrimitive.content).isEqualTo("turn on the office")

        // --- request 2: user, assistant (verbatim), ONE user message with both tool_results
        val r2 = server.takeRequest()
        val m2 = json.parseToJsonElement(r2.body.readUtf8()).jsonObject["messages"]!!.jsonArray
        assertThat(m2).hasSize(3)
        val assistant = m2[1].jsonObject
        assertThat(assistant["role"]!!.jsonPrimitive.content).isEqualTo("assistant")
        assertThat(assistant["content"]).isEqualTo(json.parseToJsonElement(firstContent))
        val results = m2[2].jsonObject
        assertThat(results["role"]!!.jsonPrimitive.content).isEqualTo("user")
        val blocks = results["content"]!!.jsonArray.map { it.jsonObject }
        assertThat(blocks).hasSize(2)
        assertThat(blocks.map { it["type"]!!.jsonPrimitive.content }).containsExactly("tool_result", "tool_result")
        assertThat(blocks[0]["tool_use_id"]!!.jsonPrimitive.content).isEqualTo("toolu_01")
        assertThat(blocks[1]["tool_use_id"]!!.jsonPrimitive.content).isEqualTo("toolu_02")
        assertThat(blocks[0]["content"]!!.jsonPrimitive.isString).isTrue()
        val res0 = json.parseToJsonElement(blocks[0]["content"]!!.jsonPrimitive.content).jsonObject
        assertThat(res0["error"]!!.jsonPrimitive.content).isEqualTo("not_connected")
        assertThat(blocks[0]["is_error"]!!.jsonPrimitive.content).isEqualTo("true")   // bridge failure
        val res1 = json.parseToJsonElement(blocks[1]["content"]!!.jsonPrimitive.content).jsonObject
        assertThat(res1["error"]!!.jsonPrimitive.content).isEqualTo("not_found")
        assertThat(blocks[1]["is_error"]!!.jsonPrimitive.content).isEqualTo("false")  // semantic answer, not an error

        assertThat(events.filterIsInstance<AssistantEvent.ToolCall>().map { it.name }).containsExactly("get_home_overview", "set_room").inOrder()
        assertThat((events.last() as AssistantEvent.Answer).text).isEqualTo("All done.")
    }

    @Test
    fun `effort is only sent for the newer models`(): Unit = runBlocking {
        for ((model, expected) in listOf("claude-opus-5" to true, "claude-sonnet-5" to true, "claude-opus-4-6" to true, "claude-sonnet-4-6" to true, "claude-fable-1" to true, "claude-haiku-4-5" to false, "claude-sonnet-4-5" to false, "claude-3-5-sonnet-latest" to false)) {
            server.enqueue(json("""{"content":[{"type":"text","text":"ok"}],"stop_reason":"end_turn"}"""))
            adapter().generate(ProviderConfig("k", model), "s", emptyList(), emptyList())
            val body = json.parseToJsonElement(server.takeRequest().body.readUtf8()).jsonObject
            assertThat(AnthropicAdapter.supportsEffort(model)).isEqualTo(expected)
            assertThat(body.containsKey("output_config")).isEqualTo(expected)
            assertThat(body.containsKey("tools")).isFalse()
        }
    }

    @Test
    fun `stop reasons and errors`(): Unit = runBlocking {
        server.enqueue(json("""{"content":[{"type":"text","text":"I cannot"}],"stop_reason":"refusal","stop_details":{"explanation":"Safety policy."}}"""))
        val ev1 = ArrayList<AssistantEvent>()
        AssistantEngine(tools).ask("x", "s", adapter(), ProviderConfig("k", "claude-opus-5")) { ev1 += it }
        assertThat((ev1.single() as AssistantEvent.Answer).text).isEqualTo("The model declined this request. Safety policy.")
        server.takeRequest()

        server.enqueue(json("""{"content":[{"type":"text","text":"Partial"}],"stop_reason":"max_tokens"}"""))
        val reply = adapter().generate(ProviderConfig("k", "claude-opus-5"), "s", emptyList(), emptyList())
        assertThat(reply.stop).isEqualTo(StopReason.MAX_TOKENS)
        assertThat(reply.note).contains("cut short")
        server.takeRequest()

        server.enqueue(json("""{"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}""", 401))
        val ev2 = ArrayList<AssistantEvent>()
        AssistantEngine(tools).ask("x", "s", adapter(), ProviderConfig("bad", "claude-opus-5")) { ev2 += it }
        assertThat((ev2.single() as AssistantEvent.Failure).message).isEqualTo("Invalid Anthropic API key (HTTP 401)")
        server.takeRequest()

        server.enqueue(json("""{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}""", 529))
        val ev3 = ArrayList<AssistantEvent>()
        AssistantEngine(tools).ask("x", "s", adapter(), ProviderConfig("k", "claude-opus-5")) { ev3 += it }
        assertThat((ev3.single() as AssistantEvent.Failure).message).contains("Overloaded")
        assertThat((ev3.single() as AssistantEvent.Failure).message).contains("529")
    }

    @Test
    fun `model listing follows pagination`(): Unit = runBlocking {
        server.enqueue(json("""{"data":[{"id":"claude-opus-5","display_name":"Claude Opus 5"},{"id":"claude-sonnet-5","display_name":"Claude Sonnet 5"}],"has_more":true,"first_id":"claude-opus-5","last_id":"claude-sonnet-5"}"""))
        server.enqueue(json("""{"data":[{"id":"claude-haiku-4-5","display_name":"Claude Haiku 4.5"}],"has_more":false,"last_id":"claude-haiku-4-5"}"""))
        val models = adapter().listModels("sk-ant")
        val r1 = server.takeRequest()
        assertThat(r1.path).isEqualTo("/v1/models?limit=100")
        assertThat(r1.getHeader("x-api-key")).isEqualTo("sk-ant")
        assertThat(r1.getHeader("anthropic-version")).isEqualTo("2023-06-01")
        assertThat(server.takeRequest().path).isEqualTo("/v1/models?limit=100&after_id=claude-sonnet-5")
        assertThat(models.map { it.name }).containsExactly("claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5").inOrder()
        assertThat(models[2].displayName).isEqualTo("Claude Haiku 4.5")
    }
}
