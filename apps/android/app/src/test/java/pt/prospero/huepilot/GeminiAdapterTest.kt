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
import pt.prospero.huepilot.assistant.AssistantEngine
import pt.prospero.huepilot.assistant.AssistantEvent
import pt.prospero.huepilot.assistant.GeminiAdapter
import pt.prospero.huepilot.assistant.HueTools
import pt.prospero.huepilot.assistant.ProviderConfig
import pt.prospero.huepilot.data.hue.HueRepository

class GeminiAdapterTest {
    private val server = MockWebServer()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val tools = HueTools(HueRepository(scope))
    private val json = Json { ignoreUnknownKeys = true }

    @Before fun start() = server.start()
    @After fun stop() = server.shutdown()

    private fun adapter() = GeminiAdapter(OkHttpClient(), server.url("/v1beta").toString().trimEnd('/'))
    private fun json(body: String, code: Int = 200) = MockResponse().setResponseCode(code).setHeader("Content-Type", "application/json").setBody(body)

    @Test
    fun `functionCall - functionResponse (role user) - text, thoughtSignature parts echoed back`(): Unit = runBlocking {
        val modelContent = """{"role":"model","parts":[{"thoughtSignature":"SIG-1","functionCall":{"name":"get_home_overview","args":{}}}]}"""
        server.enqueue(json("""{"candidates":[{"content":$modelContent,"finishReason":"STOP"}]}"""))
        server.enqueue(json("""{"candidates":[{"content":{"role":"model","parts":[{"text":"Nothing is connected."}]},"finishReason":"STOP"}]}"""))

        val events = ArrayList<AssistantEvent>()
        AssistantEngine(tools).ask("what's on?", "SYSTEM", adapter(), ProviderConfig("AIza", "gemini-2.5-flash")) { events += it }

        val r1 = server.takeRequest()
        assertThat(r1.path).isEqualTo("/v1beta/models/gemini-2.5-flash:generateContent?key=AIza")
        val b1 = json.parseToJsonElement(r1.body.readUtf8()).jsonObject
        assertThat(b1["systemInstruction"]!!.jsonObject["parts"]!!.jsonArray[0].jsonObject["text"]!!.jsonPrimitive.content).isEqualTo("SYSTEM")
        assertThat(b1["tools"]!!.jsonArray[0].jsonObject["functionDeclarations"]!!.jsonArray).hasSize(29)
        assertThat(b1["contents"]!!.jsonArray).hasSize(1)

        val r2 = server.takeRequest()
        val contents = json.parseToJsonElement(r2.body.readUtf8()).jsonObject["contents"]!!.jsonArray
        assertThat(contents).hasSize(3)
        assertThat(contents[1]).isEqualTo(json.parseToJsonElement(modelContent)) // verbatim, signature kept
        val fr = contents[2].jsonObject
        assertThat(fr["role"]!!.jsonPrimitive.content).isEqualTo("user")
        val part = fr["parts"]!!.jsonArray[0].jsonObject["functionResponse"]!!.jsonObject
        assertThat(part["name"]!!.jsonPrimitive.content).isEqualTo("get_home_overview")
        assertThat(part["response"]!!.jsonObject["ok"]!!.jsonPrimitive.content).isEqualTo("false")

        assertThat((events.last() as AssistantEvent.Answer).text).isEqualTo("Nothing is connected.")
    }

    @Test
    fun `errors and model filtering`(): Unit = runBlocking {
        server.enqueue(json("""{"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}""", 400))
        val events = ArrayList<AssistantEvent>()
        AssistantEngine(tools).ask("hi", "s", adapter(), ProviderConfig("bad", "gemini-2.5-flash")) { events += it }
        assertThat((events.single() as AssistantEvent.Failure).message).contains("API key not valid")
        server.takeRequest()

        server.enqueue(json("""{"models":[{"name":"models/gemini-2.5-pro","displayName":"Gemini 2.5 Pro","supportedGenerationMethods":["generateContent","countTokens"]},{"name":"models/embedding-001","displayName":"Embedding","supportedGenerationMethods":["embedContent"]},{"name":"models/gemini-2.5-flash","displayName":"Gemini 2.5 Flash","supportedGenerationMethods":["generateContent"]}]}"""))
        val models = adapter().listModels("AIza")
        assertThat(server.takeRequest().path).startsWith("/v1beta/models?key=AIza")
        assertThat(models.map { it.name }).containsExactly("gemini-2.5-flash", "gemini-2.5-pro").inOrder()
        assertThat(models[1].displayName).isEqualTo("Gemini 2.5 Pro")
    }
}
