package pt.prospero.huepilot

import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.JsonPrimitive
import org.junit.After
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import pt.prospero.huepilot.assistant.HueTools
import pt.prospero.huepilot.data.hue.BridgeConnection
import pt.prospero.huepilot.data.hue.HueClient
import pt.prospero.huepilot.data.hue.HueRepository

/**
 * Integration test of the assistant tool contract against the mock bridge
 * (`node packages/hue-mock-bridge/src/server.mjs --port 8080`). Skipped when the mock is not running.
 */
class HueToolsMockBridgeTest {
    private val host = System.getenv("HUE_MOCK_HOST") ?: "127.0.0.1"
    private val port = (System.getenv("HUE_MOCK_PORT") ?: "8080").toInt()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private lateinit var repo: HueRepository
    private lateinit var tools: HueTools
    private lateinit var client: HueClient

    @Before
    fun setUp(): Unit = runBlocking {
        val reachable = runCatching { HueClient.fetchConfig(host, port, useHttps = false) }.isSuccess
        assumeTrue("mock bridge not reachable at $host:$port", reachable)
        val pair = HueClient.tryPair(host, port, useHttps = false, deviceType = "hue_pilot#test")!!
        val conn = BridgeConnection(host, port, useHttps = false, appKey = pair.username, clientKey = pair.clientKey, bridgeId = "mock")
        repo = HueRepository(scope)
        repo.connect(conn)
        client = repo.client.value!!
        tools = HueTools(repo)
        val ok = withTimeoutOrNull(8000) { while (repo.snapshot.value.isEmpty) delay(50); true }
        assertThat(ok).isTrue()
    }

    @After
    fun tearDown() {
        if (::repo.isInitialized) repo.disconnect()
        scope.cancel()
    }

    private fun args(vararg pairs: Pair<String, Any>) = buildJsonObject {
        for ((k, v) in pairs) when (v) {
            is Boolean -> put(k, v)
            is Number -> put(k, v)
            is List<*> -> putJsonArray(k) { v.forEach { add(JsonPrimitive(it.toString())) } }
            else -> put(k, v.toString())
        }
    }

    private suspend fun lightByName(name: String): JsonObject =
        client.getResources("light").first { it["metadata"]!!.jsonObject["name"]!!.jsonPrimitive.content == name }

    private suspend fun waitFor(timeoutMs: Long = 4000, cond: () -> Boolean): Boolean =
        withTimeoutOrNull(timeoutMs) { while (!cond()) delay(50); true } ?: false

    @Test
    fun `overview lists rooms lights and scenes`(): Unit = runBlocking {
        val r = tools.execute("get_home_overview", JsonObject(emptyMap()))
        assertThat(r["ok"]!!.jsonPrimitive.content).isEqualTo("true")
        val rooms = r["rooms"]!!.jsonArray
        assertThat(rooms.size).isAtLeast(5)
        val office = rooms.map { it.jsonObject }.first { it["name"]!!.jsonPrimitive.content == "Office" }
        assertThat(office["kind"]!!.jsonPrimitive.content).isEqualTo("room")
        assertThat(office["lights"]!!.jsonArray.size).isEqualTo(3)
        assertThat(office["scenes"]!!.jsonArray.size).isAtLeast(1)
        assertThat(r["total_lights_on"]).isNotNull()
    }

    @Test
    fun `set_room applies on brightness and colour temperature to the bridge`(): Unit = runBlocking {
        val r = tools.execute("set_room", args("room" to "office", "brightness" to 42, "color_temperature" to "warm"))
        assertThat(r["ok"]!!.jsonPrimitive.content).isEqualTo("true")
        assertThat(r["message"]!!.jsonPrimitive.content).contains("Office")
        assertThat(waitFor { runBlocking { lightByName("Desk Lamp") }.let { l ->
            l["on"]!!.jsonObject["on"]!!.jsonPrimitive.content == "true" &&
                l["dimming"]!!.jsonObject["brightness"]!!.jsonPrimitive.content.toDouble() in 41.0..43.0 &&
                l["color_temperature"]!!.jsonObject["mirek"]!!.jsonPrimitive.content == "370"
        } }).isTrue()

        val off = tools.execute("set_room", args("room" to "Office", "on" to false))
        assertThat(off["message"]!!.jsonPrimitive.content).isEqualTo("Office turned off")
        assertThat(waitFor { runBlocking { lightByName("Desk Lamp") }["on"]!!.jsonObject["on"]!!.jsonPrimitive.content == "false" }).isTrue()
    }

    @Test
    fun `set_light with colour name and set_all_lights`(): Unit = runBlocking {
        val r = tools.execute("set_light", args("light" to "desk lamp", "color" to "blue", "brightness" to 77))
        assertThat(r["ok"]!!.jsonPrimitive.content).isEqualTo("true")
        assertThat(waitFor { runBlocking { lightByName("Desk Lamp") }.let { l ->
            val xy = l["color"]!!.jsonObject["xy"]!!.jsonObject
            xy["x"]!!.jsonPrimitive.content.toDouble() < 0.2 && xy["y"]!!.jsonPrimitive.content.toDouble() < 0.1
        } }).isTrue()

        val all = tools.execute("set_all_lights", args("on" to false))
        assertThat(all["message"]!!.jsonPrimitive.content).isEqualTo("All lights turned off")
        assertThat(waitFor { runBlocking { client.getResources("light") }.all { it["on"]!!.jsonObject["on"]!!.jsonPrimitive.content == "false" } }).isTrue()
        tools.execute("set_all_lights", args("on" to true, "brightness" to 60))
    }

    @Test
    fun `not found and ambiguous responses follow the contract`(): Unit = runBlocking {
        val nf = tools.execute("set_room", args("room" to "garage", "on" to true))
        assertThat(nf["ok"]!!.jsonPrimitive.content).isEqualTo("false")
        assertThat(nf["error"]!!.jsonPrimitive.content).isEqualTo("not_found")
        assertThat(nf["available"]!!.jsonArray.map { it.jsonPrimitive.content }).contains("Office")

        val amb = tools.execute("set_light", args("light" to "bedside", "on" to true))
        assertThat(amb["error"]!!.jsonPrimitive.content).isEqualTo("ambiguous")
        assertThat(amb["candidates"]!!.jsonArray.map { it.jsonPrimitive.content }).containsExactly("Bedside Left", "Bedside Right")

        val disamb = tools.execute("set_light", args("light" to "bedside left", "room" to "bedroom", "on" to true))
        assertThat(disamb["ok"]!!.jsonPrimitive.content).isEqualTo("true")
    }

    @Test
    fun `activate_scene set_effect identify and sensors`(): Unit = runBlocking {
        val scene = tools.execute("activate_scene", args("scene" to "relax", "room" to "bedroom"))
        assertThat(scene["ok"]!!.jsonPrimitive.content).isEqualTo("true")
        assertThat(scene["room"]!!.jsonPrimitive.content).isEqualTo("Bedroom")
        assertThat(waitFor { repo.snapshot.value.scenes.any { it.name == "Relax" && it.groupName == "Bedroom" && it.isActive } }).isTrue()

        val dyn = tools.execute("activate_scene", args("scene" to "Tropical twilight", "dynamic" to true))
        assertThat(dyn["dynamic"]!!.jsonPrimitive.content).isEqualTo("true")

        val eff = tools.execute("set_effect", args("target" to "Desk Lamp", "effect" to "candle"))
        assertThat(eff["ok"]!!.jsonPrimitive.content).isEqualTo("true")
        assertThat(waitFor { runBlocking { lightByName("Desk Lamp") }["effects_v2"]?.jsonObject?.get("status")?.jsonObject?.get("effect")?.jsonPrimitive?.content == "candle" }).isTrue()
        val roomEff = tools.execute("set_effect", args("target" to "Office", "effect" to "no_effect"))
        assertThat(roomEff["ok"]!!.jsonPrimitive.content).isEqualTo("true")

        val ident = tools.execute("identify_light", args("light" to "Kitchen Spots"))
        assertThat(ident["message"]!!.jsonPrimitive.content).contains("blinking")

        val sensors = tools.execute("get_sensor_readings", JsonObject(emptyMap()))["sensors"]!!.jsonArray.map { it.jsonObject }
        val types = sensors.map { it["type"]!!.jsonPrimitive.content }.toSet()
        assertThat(types).containsAtLeast("motion", "temperature", "light_level", "battery", "button")
        val lux = sensors.first { it["type"]!!.jsonPrimitive.content == "light_level" }
        assertThat(lux["unit"]!!.jsonPrimitive.content).isEqualTo("lux")
    }

    @Test
    fun `schedules can be created listed and deleted`(): Unit = runBlocking {
        val created = tools.execute("create_schedule", args("name" to "Test wake", "time" to "07:30", "days" to listOf("mon", "fri"), "target" to "Office", "on" to true, "brightness" to 40))
        assertThat(created["ok"]!!.jsonPrimitive.content).isEqualTo("true")
        assertThat(created["localtime"]!!.jsonPrimitive.content).isEqualTo("W68/T07:30:00")
        val id = created["id"]!!.jsonPrimitive.content
        val body = created["body"]!!.jsonObject
        assertThat(body["on"]!!.jsonPrimitive.content).isEqualTo("true")
        assertThat(body["bri"]!!.jsonPrimitive.content).isEqualTo("102")

        val withScene = tools.execute("create_schedule", args("time" to "22:00", "target" to "Bedroom", "scene" to "Nightlight"))
        assertThat(withScene["ok"]!!.jsonPrimitive.content).isEqualTo("true")
        assertThat(withScene["body"]!!.jsonObject["scene"]).isNotNull()
        val id2 = withScene["id"]!!.jsonPrimitive.content

        val listed = tools.execute("list_schedules", JsonObject(emptyMap()))
        val ids = listed["schedules"]!!.jsonArray.map { it.jsonObject["id"]!!.jsonPrimitive.content }
        assertThat(ids).containsAtLeast(id, id2)
        val mine = listed["schedules"]!!.jsonArray.map { it.jsonObject }.first { it["id"]!!.jsonPrimitive.content == id }
        assertThat(mine["address"]!!.jsonPrimitive.content).matches("/api/.+/groups/\\d+/action")
        assertThat(mine["when"]!!.jsonPrimitive.content).isEqualTo("Mon, Fri at 07:30")

        assertThat(tools.execute("delete_schedule", args("id" to id))["ok"]!!.jsonPrimitive.content).isEqualTo("true")
        assertThat(tools.execute("delete_schedule", args("id" to id2))["ok"]!!.jsonPrimitive.content).isEqualTo("true")
        val after = tools.execute("list_schedules", JsonObject(emptyMap()))["schedules"]!!.jsonArray.map { it.jsonObject["id"]!!.jsonPrimitive.content }
        assertThat(after).containsNoneOf(id, id2)
    }

    @Test
    fun `save scene from current state then rename and delete`(): Unit = runBlocking {
        val office = repo.snapshot.value.rooms.first { it.name == "Office" }
        val id = repo.saveCurrentAsScene(office, "Test snapshot")
        assertThat(waitFor { repo.snapshot.value.scene(id) != null }).isTrue()
        repo.renameScene(id, "Renamed snapshot")
        assertThat(waitFor { repo.snapshot.value.scene(id)?.name == "Renamed snapshot" }).isTrue()
        repo.deleteScene(id)
        assertThat(waitFor { runBlocking { client.getResources("scene") }.none { it["id"]!!.jsonPrimitive.content == id } }).isTrue()
    }
}
