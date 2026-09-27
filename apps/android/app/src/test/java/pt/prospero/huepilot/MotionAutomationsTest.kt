package pt.prospero.huepilot

import com.google.common.truth.Truth.assertThat
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import org.junit.Assert.assertThrows
import org.junit.Test
import pt.prospero.huepilot.domain.MotionAutomations
import pt.prospero.huepilot.domain.MotionAutomations.Action
import pt.prospero.huepilot.domain.MotionAutomations.Slot
import pt.prospero.huepilot.domain.MotionAutomations.Spec
import pt.prospero.huepilot.domain.MotionAutomations.Time

class MotionAutomationsTest {
    private val spec = Spec(
        sourceDeviceId = "dev",
        motionServiceId = "svc",
        motionType = "motion",
        where = listOf("room1" to "room"),
        onlyWhenDark = true,
        slots = listOf(
            Slot(Time(22, 0), Action.Scene("sc1"), 5, Action.Off, doNotDisturb = true),
            Slot(Time(7, 0), Action.Nothing, 10, Action.Nothing),
        ),
    )

    private fun slots(cfg: JsonObject): JsonArray = cfg["motion"]!!.jsonObject["when"]!!.jsonObject["timeslots"]!!.jsonArray

    @Test
    fun `configuration matches what the Hue app writes`() {
        val cfg = MotionAutomations.buildConfiguration(spec)
        val ts = slots(cfg)
        assertThat(ts.size).isEqualTo(2)
        // sorted by start time
        assertThat(ts[0].jsonObject["start_time"]!!.jsonObject["time"]!!.jsonObject["hour"]!!.jsonPrimitive.content).isEqualTo("7")
        assertThat(ts[0].jsonObject["on_no_motion"]!!.jsonObject["recall_single"]!!.jsonArray[0].jsonObject["action"]!!.jsonPrimitive.content).isEqualTo("do_nothing")
        val night = ts[1].jsonObject
        assertThat(night["on_motion"]!!.jsonObject["recall_single"]!!.jsonArray[0].jsonObject["action"]!!.jsonObject["recall"]!!.jsonObject["rid"]!!.jsonPrimitive.content).isEqualTo("sc1")
        assertThat(night["on_no_motion"]!!.jsonObject["after"]!!.jsonObject["minutes"]!!.jsonPrimitive.content).isEqualTo("5")
        assertThat(night["on_no_motion"]!!.jsonObject["recall_single"]!!.jsonArray[0].jsonObject["action"]!!.jsonPrimitive.content).isEqualTo("all_off")
        assertThat(night["do_not_disturb"]!!.jsonPrimitive.content).isEqualTo("true")
        assertThat(cfg["source"]!!.jsonObject["rid"]!!.jsonPrimitive.content).isEqualTo("dev")
        assertThat(cfg["motion"]!!.jsonObject["where"]!!.jsonArray[0].jsonObject["group"]!!.jsonObject["rtype"]!!.jsonPrimitive.content).isEqualTo("room")
        assertThat(cfg["light_level"]!!.jsonObject["daylight"]!!.jsonObject["sunrise_sunset"]).isNotNull()
        assertThat(MotionAutomations.buildConfiguration(spec.copy(onlyWhenDark = false))["light_level"]).isNull()
        val kept = buildJsonObject { putJsonObject("daylight") { putJsonObject("daylight_sensitivity") { put("x", 1) } } }
        assertThat(MotionAutomations.buildConfiguration(spec, kept)["light_level"]).isEqualTo(kept)
        val body = MotionAutomations.instanceBody(spec, "Office", enabled = false)
        assertThat(body["script_id"]!!.jsonPrimitive.content).isEqualTo(MotionAutomations.SCRIPT_ID)
        assertThat(body["enabled"]!!.jsonPrimitive.content).isEqualTo("false")
        assertThat(MotionAutomations.instanceBody(spec, "Office", enabled = true, forUpdate = true)["script_id"]).isNull()
    }

    @Test
    fun `parse reads the configuration back`() {
        val back = MotionAutomations.parseConfiguration(MotionAutomations.buildConfiguration(spec))!!
        assertThat(back.onlyWhenDark).isTrue()
        assertThat(back.motionType).isEqualTo("motion")
        assertThat(back.where).containsExactly("room1" to "room")
        assertThat(back.slots).hasSize(2)
        assertThat(back.slots[1].onMotion).isEqualTo(Action.Scene("sc1"))
        assertThat(back.slots[1].onNoMotion).isEqualTo(Action.Off)
        assertThat(back.slots[1].doNotDisturb).isTrue()
        assertThat(back.slots[0].noMotionAfterMinutes).isEqualTo(10)
        assertThat(MotionAutomations.parseConfiguration(buildJsonObject { putJsonObject("source") { put("rid", "x") } })).isNull()
        assertThat(MotionAutomations.describe(back.slots, true) { "Nightlight" }).isEqualTo("07:00 nothing · 22:00 \"Nightlight\", off after 5 min · only when dark")
        assertThat(MotionAutomations.describe(listOf(back.slots[1]), false) { "Nightlight" }).isEqualTo("\"Nightlight\", off after 5 min · any time")
    }

    @Test
    fun `time parsing`() {
        assertThat(MotionAutomations.parseTime("7pm")).isEqualTo(Time(19, 0))
        assertThat(MotionAutomations.parseTime("22:30")).isEqualTo(Time(22, 30))
        assertThat(MotionAutomations.parseTime("19h30")).isEqualTo(Time(19, 30))
        assertThat(MotionAutomations.parseTime("12am")).isEqualTo(Time(0, 0))
        assertThat(MotionAutomations.parseTime("midnight")).isEqualTo(Time(0, 0))
        assertThat(Time(7, 5).toString()).isEqualTo("07:05")
        assertThrows(IllegalArgumentException::class.java) { MotionAutomations.parseTime("25:00") }
    }
}
