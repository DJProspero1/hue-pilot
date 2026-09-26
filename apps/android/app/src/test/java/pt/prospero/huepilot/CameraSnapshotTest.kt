package pt.prospero.huepilot

import com.google.common.truth.Truth.assertThat
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Test
import pt.prospero.huepilot.data.hue.HueJson
import pt.prospero.huepilot.data.hue.SnapshotBuilder

/** Hue Secure cameras, shaped exactly like a Hue Bridge Pro (BSB003) reports them. */
class CameraSnapshotTest {
    private fun obj(s: String): JsonObject = HueJson.parseToJsonElement(s).jsonObject

    private val resources = listOf(
        // Battery camera: camera_motion + device_power + light_level
        """{"id":"cam-b","type":"device","product_data":{"model_id":"CMB001","manufacturer_name":"Signify Netherlands B.V.","product_name":"Secure battery camera","product_archetype":"unknown_archetype","certified":true,"software_version":"2.86.1"},"metadata":{"name":"Secure battery camera 1","archetype":"unknown_archetype"},"identify":{},"services":[{"rid":"zb-b","rtype":"zigbee_connectivity"},{"rid":"cm-b","rtype":"camera_motion"},{"rid":"pw-b","rtype":"device_power"},{"rid":"ll-b","rtype":"light_level"}]}""",
        """{"id":"cm-b","type":"camera_motion","owner":{"rid":"cam-b","rtype":"device"},"enabled":true,"motion":{"motion":false,"motion_valid":true,"motion_report":{"changed":"2026-09-26T10:37:55.485Z","motion":false}}}""",
        """{"id":"pw-b","type":"device_power","owner":{"rid":"cam-b","rtype":"device"},"power_state":{"battery_state":"normal","battery_level":55}}""",
        """{"id":"ll-b","type":"light_level","owner":{"rid":"cam-b","rtype":"device"},"enabled":true,"light":{"light_level":11461,"light_level_valid":true,"light_level_report":{"changed":"2026-09-26T10:30:00Z","light_level":11461}}}""",
        """{"id":"zb-b","type":"zigbee_connectivity","owner":{"rid":"cam-b","rtype":"device"},"status":"connected"}""",
        // Floodlight camera: camera_motion + light_level, no battery
        """{"id":"cam-f","type":"device","product_data":{"model_id":"CMW002","manufacturer_name":"Signify Netherlands B.V.","product_name":"Secure floodlight camera","product_archetype":"unknown_archetype","certified":true,"software_version":"2.86.1"},"metadata":{"name":"Secure floodlight camera 1","archetype":"unknown_archetype"},"identify":{},"services":[{"rid":"zb-f","rtype":"zigbee_connectivity"},{"rid":"cm-f","rtype":"camera_motion"},{"rid":"ll-f","rtype":"light_level"}]}""",
        """{"id":"cm-f","type":"camera_motion","owner":{"rid":"cam-f","rtype":"device"},"enabled":false,"motion":{"motion":true,"motion_valid":true,"motion_report":{"changed":"2026-09-26T10:18:42.586Z","motion":true}}}""",
        """{"id":"ll-f","type":"light_level","owner":{"rid":"cam-f","rtype":"device"},"enabled":true,"light":{"light_level":35205,"light_level_valid":true,"light_level_report":{"changed":"2026-09-26T10:30:00Z","light_level":35205}}}""",
        """{"id":"zb-f","type":"zigbee_connectivity","owner":{"rid":"cam-f","rtype":"device"},"status":"connectivity_issue"}""",
        // The floodlight itself is a separate light device
        """{"id":"fl-dev","type":"device","id_v1":"/lights/9","product_data":{"model_id":"442296118491","manufacturer_name":"Signify Netherlands B.V.","product_name":"Secure floodlight camera","product_archetype":"hue_floodlight_camera","certified":true,"software_version":"1.163.1"},"metadata":{"name":"Secure floodlight camera","archetype":"hue_floodlight_camera"},"services":[{"rid":"fl-light","rtype":"light"}]}""",
        """{"id":"fl-light","type":"light","id_v1":"/lights/9","owner":{"rid":"fl-dev","rtype":"device"},"metadata":{"name":"Secure floodlight camera","archetype":"hue_floodlight_camera"},"on":{"on":false},"dimming":{"brightness":50,"min_dim_level":5},"color_temperature":{"mirek":300,"mirek_valid":true,"mirek_schema":{"mirek_minimum":153,"mirek_maximum":500}}}""",
        """{"id":"room-d","type":"room","metadata":{"name":"Driveway","archetype":"driveway"},"children":[{"rid":"fl-dev","rtype":"device"}],"services":[{"rid":"gl-d","rtype":"grouped_light"}]}""",
        """{"id":"gl-d","type":"grouped_light","owner":{"rid":"room-d","rtype":"room"},"on":{"on":false},"dimming":{"brightness":0}}""",
        // A normal motion sensor must stay a sensor
        """{"id":"sensor","type":"device","metadata":{"name":"Hallway Motion Sensor"},"product_data":{"product_name":"Hue motion sensor","model_id":"SML003"},"services":[{"rid":"m1","rtype":"motion"}]}""",
        """{"id":"m1","type":"motion","owner":{"rid":"sensor","rtype":"device"},"enabled":true,"motion":{"motion":false,"motion_report":{"changed":"2026-09-26T09:00:00Z","motion":false}}}""",
    ).map(::obj).associateBy { it["id"]!!.jsonPrimitive.content }

    @Test
    fun `cameras are detected, typed and separated from motion sensors`() {
        val snap = SnapshotBuilder.build(resources)
        assertThat(snap.cameras.map { it.name }).containsExactly("Secure battery camera 1", "Secure floodlight camera 1")
        assertThat(snap.motionSensors.map { it.name }).containsExactly("Hallway Motion Sensor")
        assertThat(snap.accessories.filter { it.kind == "motion" }.none { it.isCamera }).isTrue()

        val battery = snap.cameras.first { it.modelId == "CMB001" }
        assertThat(battery.isFloodlightCamera).isFalse()
        assertThat(battery.motionType).isEqualTo("camera_motion")
        assertThat(battery.motion).isFalse()
        assertThat(battery.motionEnabled).isTrue()
        assertThat(battery.batteryLevel).isEqualTo(55)
        assertThat(battery.lux!!.toInt()).isEqualTo(13)
        assertThat(battery.connectivity).isEqualTo("connected")
        assertThat(battery.floodlightLightId).isNull()

        val flood = snap.cameras.first { it.modelId == "CMW002" }
        assertThat(flood.isFloodlightCamera).isTrue()
        assertThat(flood.motion).isTrue()
        assertThat(flood.motionEnabled).isFalse()
        assertThat(flood.batteryLevel).isNull()
        assertThat(flood.lux!!.toInt()).isEqualTo(3314)
        assertThat(flood.connectivity).isEqualTo("connectivity_issue")
    }

    @Test
    fun `floodlight camera is paired with its floodlight light, which stays a normal light in its room`() {
        val snap = SnapshotBuilder.build(resources)
        val flood = snap.cameras.first { it.modelId == "CMW002" }
        assertThat(flood.floodlightLightId).isEqualTo("fl-light")
        val light = snap.light("fl-light")!!
        assertThat(light.roomName).isEqualTo("Driveway")
        assertThat(light.archetype).isEqualTo("hue_floodlight_camera")
        // The floodlight's device is a light device, so it never shows up as an accessory.
        assertThat(snap.accessories.none { it.deviceId == "fl-dev" }).isTrue()
    }

    @Test
    fun `lit colours are ordered by frequency for the all-lights card`() {
        val extra = resources + listOf(
            """{"id":"d1","type":"device","metadata":{"name":"A"},"product_data":{"product_name":"Hue color lamp"},"services":[{"rid":"a","rtype":"light"}]}""",
            """{"id":"a","type":"light","owner":{"rid":"d1","rtype":"device"},"metadata":{"name":"A"},"on":{"on":true},"dimming":{"brightness":50},"color_temperature":{"mirek":300,"mirek_valid":true}}""",
            """{"id":"d2","type":"device","metadata":{"name":"B"},"product_data":{"product_name":"Hue color lamp"},"services":[{"rid":"b","rtype":"light"}]}""",
            """{"id":"b","type":"light","owner":{"rid":"d2","rtype":"device"},"metadata":{"name":"B"},"on":{"on":true},"dimming":{"brightness":50},"color_temperature":{"mirek":300,"mirek_valid":true}}""",
            """{"id":"d3","type":"device","metadata":{"name":"C"},"product_data":{"product_name":"Hue color lamp"},"services":[{"rid":"c","rtype":"light"}]}""",
            """{"id":"c","type":"light","owner":{"rid":"d3","rtype":"device"},"metadata":{"name":"C"},"on":{"on":true},"dimming":{"brightness":50},"color_temperature":{"mirek":153,"mirek_valid":true}}""",
        ).map(::obj).associateBy { it["id"]!!.jsonPrimitive.content }
        val snap = SnapshotBuilder.build(extra)
        assertThat(snap.litHexes).hasSize(2)
        assertThat(snap.litHexes.first()).isEqualTo(snap.light("a")!!.swatchHex)
    }
}
