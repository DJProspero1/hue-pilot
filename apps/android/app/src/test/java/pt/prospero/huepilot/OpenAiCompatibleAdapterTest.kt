package pt.prospero.huepilot

import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Before
import org.junit.Test
import pt.prospero.huepilot.assistant.AssistantEngine
import pt.prospero.huepilot.assistant.AssistantEvent
import pt.prospero.huepilot.assistant.AssistantProvider
import pt.prospero.huepilot.assistant.HueTools
import pt.prospero.huepilot.assistant.OpenAiCompatibleAdapter
import pt.prospero.huepilot.assistant.ProviderConfig
import pt.prospero.huepilot.data.hue.HueRepository

class OpenAiCompatibleAdapterTest {
    private val server = MockWebServer()
    private val http = OkHttpClient()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val tools = HueTools(HueRepository(scope))
    private val json = Json { ignoreUnknownKeys = true }

    @Before fun start() = server.start()
    @After fun stop() = server.shutdown()

    private fun adapter(provider: AssistantProvider) = OpenAiCompatibleAdapter(provider, http, server.url("/v1").toString().trimEnd('/'))

    private fun json(body: String, code: Int = 200) = MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    @Test
    fun `tool_calls round trip - tool role message - final content`(): Unit = runBlocking {
        server.enqueue(json("""{"id":"c1","choices":[{"index":0,"message":{"role":"assistant","content":null,"tool_calls":[{"id":"call_abc","type":"function","function":{"name":"get_home_overview","arguments":"{}"}},{"id":"call_def","type":"function","function":{"name":"set_room","arguments":"{\"room\":\"Office\",\"on\":true}"}}]},"finish_reason":"tool_calls"}]}"""))
        server.enqueue(json("""{"id":"c2","choices":[{"index":0,"message":{"role":"assistant","content":"Nothing is connected right now."},"finish_reason":"stop"}]}"""))

        val engine = AssistantEngine(tools)
        val events = ArrayList<AssistantEvent>()
        engine.ask("turn on the office", "SYSTEM PROMPT", adapter(AssistantProvider.OPENAI), ProviderConfig("sk-test", "gpt-5-mini")) { events += it }

        // --- request 1
        val r1 = server.takeRequest()
        assertThat(r1.path).isEqualTo("/v1/chat/completions")
        assertThat(r1.getHeader("Authorization")).isEqualTo("Bearer sk-test")
        assertThat(r1.getHeader("HTTP-Referer")).isNull()
        val b1 = json.parseToJsonElement(r1.body.readUtf8()).jsonObject
        assertThat(b1["model"]!!.jsonPrimitive.content).isEqualTo("gpt-5-mini")
        assertThat(b1.containsKey("temperature")).isFalse()
        assertThat(b1["tool_choice"]!!.jsonPrimitive.content).isEqualTo("auto")
        val tools1 = b1["tools"]!!.jsonArray
        assertThat(tools1).hasSize(16)
        assertThat(tools1[0].jsonObject["type"]!!.jsonPrimitive.content).isEqualTo("function")
        val fn0 = tools1[0].jsonObject["function"]!!.jsonObject
        assertThat(fn0["name"]!!.jsonPrimitive.content).isEqualTo("get_home_overview")
        assertThat(fn0["parameters"]!!.jsonObject["type"]!!.jsonPrimitive.content).isEqualTo("object")
        assertThat(fn0["parameters"]!!.jsonObject["properties"]!!.jsonObject).isEmpty()
        val m1 = b1["messages"]!!.jsonArray
        assertThat(m1).hasSize(2)
        assertThat(m1[0].jsonObject["role"]!!.jsonPrimitive.content).isEqualTo("system")
        assertThat(m1[0].jsonObject["content"]!!.jsonPrimitive.content).isEqualTo("SYSTEM PROMPT")
        assertThat(m1[1].jsonObject["role"]!!.jsonPrimitive.content).isEqualTo("user")

        // --- request 2: system, user, assistant(tool_calls), tool, tool
        val r2 = server.takeRequest()
        val m2 = json.parseToJsonElement(r2.body.readUtf8()).jsonObject["messages"]!!.jsonArray
        assertThat(m2).hasSize(5)
        val assistant = m2[2].jsonObject
        assertThat(assistant["role"]!!.jsonPrimitive.content).isEqualTo("assistant")
        assertThat(assistant["content"]).isEqualTo(JsonNull)
        val calls = assistant["tool_calls"]!!.jsonArray
        assertThat(calls).hasSize(2)
        assertThat(calls[0].jsonObject["id"]!!.jsonPrimitive.content).isEqualTo("call_abc")
        assertThat(calls[0].jsonObject["type"]!!.jsonPrimitive.content).isEqualTo("function")
        assertThat(calls[1].jsonObject["function"]!!.jsonObject["name"]!!.jsonPrimitive.content).isEqualTo("set_room")
        // arguments must be a JSON *string*
        val argStr = calls[1].jsonObject["function"]!!.jsonObject["arguments"]!!.jsonPrimitive
        assertThat(argStr.isString).isTrue()
        assertThat(json.parseToJsonElement(argStr.content).jsonObject["room"]!!.jsonPrimitive.content).isEqualTo("Office")
        val tool1 = m2[3].jsonObject
        assertThat(tool1["role"]!!.jsonPrimitive.content).isEqualTo("tool")
        assertThat(tool1["tool_call_id"]!!.jsonPrimitive.content).isEqualTo("call_abc")
        assertThat(tool1["content"]!!.jsonPrimitive.isString).isTrue()
        assertThat(json.parseToJsonElement(tool1["content"]!!.jsonPrimitive.content).jsonObject["ok"]!!.jsonPrimitive.content).isEqualTo("false")
        assertThat(m2[4].jsonObject["tool_call_id"]!!.jsonPrimitive.content).isEqualTo("call_def")

        // --- events
        assertThat(events.filterIsInstance<AssistantEvent.ToolCall>().map { it.name }).containsExactly("get_home_overview", "set_room").inOrder()
        assertThat((events.last() as AssistantEvent.Answer).text).isEqualTo("Nothing is connected right now.")
    }

    @Test
    fun `openrouter sends attribution headers and deepseek uses plain auth`(): Unit = runBlocking {
        server.enqueue(json("""{"choices":[{"message":{"role":"assistant","content":"hi"},"finish_reason":"stop"}]}"""))
        adapter(AssistantProvider.OPENROUTER).generate(ProviderConfig("sk-or", "google/gemini-2.5-flash"), "s", emptyList(), tools.specs)
        val r = server.takeRequest()
        assertThat(r.getHeader("HTTP-Referer")).isEqualTo("https://hue-pilot.local")
        assertThat(r.getHeader("X-Title")).isEqualTo("Hue Pilot")
        assertThat(r.getHeader("Authorization")).isEqualTo("Bearer sk-or")

        server.enqueue(json("""{"choices":[{"message":{"role":"assistant","content":"hi"},"finish_reason":"stop"}]}"""))
        adapter(AssistantProvider.DEEPSEEK).generate(ProviderConfig("sk-ds", "deepseek-chat"), "s", emptyList(), tools.specs)
        val r2 = server.takeRequest()
        assertThat(r2.getHeader("X-Title")).isNull()
        assertThat(r2.getHeader("Authorization")).isEqualTo("Bearer sk-ds")
    }

    @Test
    fun `unparsable arguments become empty objects and api errors are surfaced`(): Unit = runBlocking {
        server.enqueue(json("""{"choices":[{"message":{"role":"assistant","content":null,"tool_calls":[{"id":"x","type":"function","function":{"name":"get_sensor_readings","arguments":"not json"}}]},"finish_reason":"tool_calls"}]}"""))
        val reply = adapter(AssistantProvider.OPENAI).generate(ProviderConfig("k", "gpt-5-mini"), "s", emptyList(), tools.specs)
        assertThat(reply.turn.toolCalls.single().args).isEmpty()

        server.enqueue(json("""{"error":{"message":"Incorrect API key provided","type":"invalid_request_error"}}""", 401))
        val events = ArrayList<AssistantEvent>()
        AssistantEngine(tools).ask("hi", "s", adapter(AssistantProvider.OPENAI), ProviderConfig("bad", "gpt-5-mini")) { events += it }
        val failure = events.single() as AssistantEvent.Failure
        assertThat(failure.message).contains("Incorrect API key provided")
        assertThat(failure.message).contains("401")
    }

    @Test
    fun `model listing filters per provider`(): Unit = runBlocking {
        server.enqueue(json("""{"data":[{"id":"gpt-5-mini"},{"id":"gpt-4o-audio-preview"},{"id":"o3"},{"id":"chatgpt-4o-latest"},{"id":"text-embedding-3-small"},{"id":"gpt-5-codex"},{"id":"dall-e-3"},{"id":"gpt-4o-realtime"},{"id":"o4-mini"}]}"""))
        val openai = adapter(AssistantProvider.OPENAI).listModels("k")
        assertThat(server.takeRequest().path).isEqualTo("/v1/models")
        assertThat(openai.map { it.name }).containsExactly("chatgpt-4o-latest", "gpt-5-mini", "o3", "o4-mini").inOrder()

        server.enqueue(json("""{"data":[{"id":"deepseek-reasoner"},{"id":"deepseek-chat"}]}"""))
        assertThat(adapter(AssistantProvider.DEEPSEEK).listModels("k").map { it.name }).containsExactly("deepseek-chat", "deepseek-reasoner").inOrder()
        server.takeRequest()

        val many = (1..350).joinToString(",") { """{"id":"vendor/model-${it.toString().padStart(3, '0')}","name":"Model $it","supported_parameters":["tools","temperature"]}""" }
        server.enqueue(json("""{"data":[{"id":"z/no-tools","name":"No tools","supported_parameters":["temperature"]},$many]}"""))
        val or = adapter(AssistantProvider.OPENROUTER).listModels("k")
        assertThat(or).hasSize(OpenAiCompatibleAdapter.OPENROUTER_CAP)
        assertThat(or.map { it.name }).doesNotContain("z/no-tools")
        assertThat(or.first().name).isEqualTo("vendor/model-001")
        assertThat(or.first().displayName).isEqualTo("Model 1")
        assertThat(or.map { it.name }).isInOrder()
    }
}
