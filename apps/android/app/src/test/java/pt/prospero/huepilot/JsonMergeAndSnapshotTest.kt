package pt.prospero.huepilot

import com.google.common.truth.Truth.assertThat
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Test
import pt.prospero.huepilot.data.hue.HueJson
import pt.prospero.huepilot.data.hue.SnapshotBuilder
import pt.prospero.huepilot.domain.JsonMerge

class JsonMergeAndSnapshotTest {
    private fun obj(s: String): JsonObject = HueJson.parseToJsonElement(s).jsonObject

    @Test
    fun `nested objects are merged, primitives replaced`() {
        val base = obj("""{"id":"l1","type":"light","on":{"on":false},"dimming":{"brightness":40,"min_dim_level":2},"color":{"xy":{"x":0.3,"y":0.3},"gamut_type":"C"}}""")
        val patch = obj("""{"id":"l1","type":"light","on":{"on":true},"dimming":{"brightness":75.5},"color":{"xy":{"x":0.5,"y":0.4}}}""")
        val merged = JsonMerge.deepMerge(base, patch)
        assertThat(merged["on"]!!.jsonObject["on"]!!.jsonPrimitive.content).isEqualTo("true")
        assertThat(merged["dimming"]!!.jsonObject["brightness"]!!.jsonPrimitive.content).isEqualTo("75.5")
        // untouched sibling keys survive
        assertThat(merged["dimming"]!!.jsonObject["min_dim_level"]!!.jsonPrimitive.content).isEqualTo("2")
        assertThat(merged["color"]!!.jsonObject["gamut_type"]!!.jsonPrimitive.content).isEqualTo("C")
        assertThat(merged["color"]!!.jsonObject["xy"]!!.jsonObject["x"]!!.jsonPrimitive.content).isEqualTo("0.5")
    }

    @Test
    fun `arrays are replaced and nulls remove keys`() {
        val base = obj("""{"a":[1,2,3],"b":{"c":1,"d":2}}""")
        val patch = obj("""{"a":[9],"b":{"c":null}}""")
        val merged = JsonMerge.deepMerge(base, patch)
        assertThat(merged["a"]!!.jsonArray).hasSize(1)
        assertThat(merged["b"]!!.jsonObject.containsKey("c")).isFalse()
        assertThat(merged["b"]!!.jsonObject["d"]!!.jsonPrimitive.content).isEqualTo("2")
    }

    @Test
    fun `merge does not mutate the base`() {
        val base = obj("""{"x":{"y":1}}""")
        JsonMerge.deepMerge(base, obj("""{"x":{"y":2}}"""))
        assertThat(base["x"]!!.jsonObject["y"]!!.jsonPrimitive.content).isEqualTo("1")
    }

    @Test
    fun `snapshot builder resolves rooms, lights, scenes and accessories`() {
        val resources = listOf(
            """{"id":"dev1","type":"device","metadata":{"name":"Desk lamp device"},"product_data":{"product_name":"Hue color lamp","model_id":"LCA001","software_version":"1.2"},"services":[{"rid":"l1","rtype":"light"},{"rid":"z1","rtype":"zigbee_connectivity"}]}""",
            """{"id":"l1","type":"light","id_v1":"/lights/7","owner":{"rid":"dev1","rtype":"device"},"metadata":{"name":"Desk lamp","archetype":"table_shade"},"on":{"on":true},"dimming":{"brightness":80},"color":{"xy":{"x":0.3,"y":0.3},"gamut_type":"C"},"color_temperature":{"mirek":null,"mirek_valid":false,"mirek_schema":{"mirek_minimum":153,"mirek_maximum":500}},"effects_v2":{"action":{"effect_values":["no_effect","candle"]},"status":{"effect":"no_effect"}},"unknown_field":{"weird":true}}""",
            """{"id":"z1","type":"zigbee_connectivity","owner":{"rid":"dev1","rtype":"device"},"status":"connected"}""",
            """{"id":"r1","type":"room","id_v1":"/groups/3","metadata":{"name":"Office","archetype":"office"},"children":[{"rid":"dev1","rtype":"device"}],"services":[{"rid":"gl1","rtype":"grouped_light"}]}""",
            """{"id":"gl1","type":"grouped_light","owner":{"rid":"r1","rtype":"room"},"on":{"on":true},"dimming":{"brightness":80}}""",
            """{"id":"s1","type":"scene","id_v1":"/scenes/AbC","metadata":{"name":"Relax"},"group":{"rid":"r1","rtype":"room"},"actions":[],"palette":{"color":[{"color":{"xy":{"x":0.5,"y":0.4}}}],"color_temperature":[{"color_temperature":{"mirek":400}}],"dimming":[]},"status":{"active":"static"}}""",
            """{"id":"dev2","type":"device","metadata":{"name":"Hall sensor"},"product_data":{"product_name":"Hue motion sensor","model_id":"SML001"},"services":[{"rid":"m1","rtype":"motion"},{"rid":"t1","rtype":"temperature"},{"rid":"ll1","rtype":"light_level"},{"rid":"p1","rtype":"device_power"}]}""",
            """{"id":"m1","type":"motion","owner":{"rid":"dev2","rtype":"device"},"enabled":true,"motion":{"motion":true,"motion_report":{"changed":"2026-01-01T10:00:00Z","motion":true}}}""",
            """{"id":"t1","type":"temperature","owner":{"rid":"dev2","rtype":"device"},"temperature":{"temperature":21.5,"temperature_report":{"changed":"2026-01-01T10:00:00Z","temperature":21.5}}}""",
            """{"id":"ll1","type":"light_level","owner":{"rid":"dev2","rtype":"device"},"light":{"light_level":20001,"light_level_report":{"changed":"2026-01-01T10:00:00Z","light_level":20001}}}""",
            """{"id":"p1","type":"device_power","owner":{"rid":"dev2","rtype":"device"},"power_state":{"battery_state":"normal","battery_level":87}}""",
            """{"id":"bh","type":"bridge_home","children":[],"services":[{"rid":"glh","rtype":"grouped_light"}]}""",
            """{"id":"glh","type":"grouped_light","owner":{"rid":"bh","rtype":"bridge_home"},"on":{"on":true}}""",
            """{"id":"weird","type":"some_future_type","foo":"bar"}""",
        ).map { obj(it) }.associateBy { it["id"]!!.jsonPrimitive.content }

        val snap = SnapshotBuilder.build(resources)
        assertThat(snap.rooms).hasSize(1)
        val office = snap.rooms.first()
        assertThat(office.name).isEqualTo("Office")
        assertThat(office.lights.map { it.name }).containsExactly("Desk lamp")
        assertThat(office.groupedLightId).isEqualTo("gl1")
        assertThat(office.on).isTrue()

        val lamp = snap.lights.first()
        assertThat(lamp.roomName).isEqualTo("Office")
        assertThat(lamp.supportsColor).isTrue()
        assertThat(lamp.supportsCt).isTrue()
        assertThat(lamp.isCtMode).isFalse()
        assertThat(lamp.usesEffectsV2).isTrue()
        assertThat(lamp.effectValues).contains("candle")
        assertThat(lamp.connectivity).isEqualTo("connected")
        assertThat(lamp.productName).isEqualTo("Hue color lamp")

        val scene = snap.scenes.first()
        assertThat(scene.groupName).isEqualTo("Office")
        assertThat(scene.isActive).isTrue()
        assertThat(scene.paletteHexes).hasSize(2)

        val sensor = snap.accessories.first { it.name == "Hall sensor" }
        assertThat(sensor.motion).isTrue()
        assertThat(sensor.temperatureC).isEqualTo(21.5)
        assertThat(sensor.lux!!).isWithin(0.5).of(100.0)
        assertThat(sensor.batteryLevel).isEqualTo(87)
        assertThat(snap.bridgeHomeGroupedLightId).isEqualTo("glh")
        assertThat(snap.allOn).isTrue()
    }

    @Test
    fun `malformed resources are skipped without crashing`() {
        val resources = mapOf(
            "bad" to JsonObject(mapOf("id" to JsonPrimitive("bad"), "type" to JsonPrimitive("light"), "on" to JsonPrimitive("not-an-object"))),
        )
        val snap = SnapshotBuilder.build(resources)
        assertThat(snap.lights).isEmpty()
        assertThat(snap.resourceCount).isEqualTo(1)
    }
}
