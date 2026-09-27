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
import pt.prospero.huepilot.domain.MotionAutomations.Darkness
import pt.prospero.huepilot.domain.MotionAutomations.Slot
import pt.prospero.huepilot.domain.MotionAutomations.Spec
import pt.prospero.huepilot.domain.MotionAutomations.Time
import pt.prospero.huepilot.domain.Routines

class MotionAutomationsTest {
    private val spec = Spec(
        sourceDeviceId = "dev",
        motionServiceId = "svc",
        motionType = "motion",
        where = listOf("room1" to "room"),
        darkness = Darkness.SunsetToSunrise(-30, 30),
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
        assertThat(ts[0].jsonObject["start_time"]!!.jsonObject["time"]!!.jsonObject["hour"]!!.jsonPrimitive.content).isEqualTo("7")
        assertThat(ts[0].jsonObject["on_no_motion"]!!.jsonObject["recall_single"]!!.jsonArray[0].jsonObject["action"]!!.jsonPrimitive.content).isEqualTo("do_nothing")
        val night = ts[1].jsonObject
        assertThat(night["on_motion"]!!.jsonObject["recall_single"]!!.jsonArray[0].jsonObject["action"]!!.jsonObject["recall"]!!.jsonObject["rid"]!!.jsonPrimitive.content).isEqualTo("sc1")
        assertThat(night["on_no_motion"]!!.jsonObject["after"]!!.jsonObject["minutes"]!!.jsonPrimitive.content).isEqualTo("5")
        assertThat(night["on_no_motion"]!!.jsonObject["recall_single"]!!.jsonArray[0].jsonObject["action"]!!.jsonPrimitive.content).isEqualTo("all_off")
        assertThat(night["do_not_disturb"]!!.jsonPrimitive.content).isEqualTo("true")
        assertThat(cfg["source"]!!.jsonObject["rid"]!!.jsonPrimitive.content).isEqualTo("dev")
        assertThat(cfg["motion"]!!.jsonObject["where"]!!.jsonArray[0].jsonObject["group"]!!.jsonObject["rtype"]!!.jsonPrimitive.content).isEqualTo("room")
        val ss = cfg["light_level"]!!.jsonObject["daylight"]!!.jsonObject["sunrise_sunset"]!!.jsonObject
        assertThat(ss["sunset_offset"]!!.jsonObject["minutes"]!!.jsonPrimitive.content).isEqualTo("-30")
        assertThat(MotionAutomations.buildConfiguration(spec.copy(darkness = Darkness.AnyTime))["light_level"]).isNull()
        // Hour offsets, as the Hue app writes them, survive a round trip.
        val hours = MotionAutomations.buildConfiguration(spec.copy(darkness = Darkness.SunsetToSunrise(120, -120)))
        assertThat(hours["light_level"]!!.jsonObject["daylight"]!!.jsonObject["sunrise_sunset"]!!.jsonObject["sunset_offset"]!!.jsonObject["hours"]!!.jsonPrimitive.content).isEqualTo("2")
        assertThat(MotionAutomations.parseConfiguration(hours)!!.darkness).isEqualTo(Darkness.SunsetToSunrise(120, -120))
        // The sensor's own daylight threshold.
        val sensor = MotionAutomations.buildConfiguration(spec.copy(darkness = Darkness.Sensor("ll1", "light_level", 7267, 7000)))
        val ds = sensor["light_level"]!!.jsonObject["daylight"]!!.jsonObject["daylight_sensitivity"]!!.jsonObject
        assertThat(ds["light_level_service"]!!.jsonObject["rid"]!!.jsonPrimitive.content).isEqualTo("ll1")
        assertThat(ds["settings"]!!.jsonObject["offset"]!!.jsonPrimitive.content).isEqualTo("7000")
        assertThat(MotionAutomations.parseConfiguration(sensor)!!.darkness).isEqualTo(Darkness.Sensor("ll1", "light_level", 7267, 7000))
        val body = MotionAutomations.instanceBody(spec, "Office", enabled = false)
        assertThat(body["script_id"]!!.jsonPrimitive.content).isEqualTo(MotionAutomations.SCRIPT_ID)
        assertThat(body["enabled"]!!.jsonPrimitive.content).isEqualTo("false")
        assertThat(MotionAutomations.instanceBody(spec, "Office", enabled = true, forUpdate = true)["script_id"]).isNull()
    }

    @Test
    fun `parse reads the configuration back and describes it`() {
        val back = MotionAutomations.parseConfiguration(MotionAutomations.buildConfiguration(spec))!!
        assertThat(back.darkness).isEqualTo(Darkness.SunsetToSunrise(-30, 30))
        assertThat(back.motionType).isEqualTo("motion")
        assertThat(back.where).containsExactly("room1" to "room")
        assertThat(back.slots).hasSize(2)
        assertThat(back.slots[1].onMotion).isEqualTo(Action.Scene("sc1"))
        assertThat(back.slots[1].onNoMotion).isEqualTo(Action.Off)
        assertThat(back.slots[1].doNotDisturb).isTrue()
        assertThat(back.slots[0].noMotionAfterMinutes).isEqualTo(10)
        assertThat(MotionAutomations.parseConfiguration(buildJsonObject { putJsonObject("source") { put("rid", "x") } })).isNull()
        assertThat(MotionAutomations.describe(back.slots, back.darkness) { "Nightlight" }).isEqualTo("07:00 nothing · 22:00 \"Nightlight\", off after 5 min · only when dark (30 min before sunset → 30 min after sunrise)")
        assertThat(MotionAutomations.describe(listOf(back.slots[1]), Darkness.AnyTime) { "Nightlight" }).isEqualTo("\"Nightlight\", off after 5 min · any time")
        assertThat(MotionAutomations.describeDarkness(Darkness.Sensor("ll1", "light_level", 7267, 7000))).isEqualTo("only when dark (sensor below ~5.3 lx)")
        assertThat(MotionAutomations.describeDarkness(Darkness.SunsetToSunrise(120, 0))).isEqualTo("only when dark (2 h after sunset → sunrise)")
        assertThat(MotionAutomations.luxToLightLevel(5.0)).isEqualTo(6991)
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

    @Test
    fun `routines build, parse and describe`() {
        assertThat(Routines.parseDays(listOf("mon", "Wed", "friday"))).containsExactly("monday", "wednesday", "friday").inOrder()
        assertThat(Routines.parseDays(listOf("weekdays"))).hasSize(5)
        assertThat(Routines.parseDays(null)).hasSize(7)
        assertThrows(IllegalArgumentException::class.java) { Routines.parseDays(listOf("funday")) }
        assertThat(Routines.describeDays(Routines.parseDays(listOf("weekdays")))).isEqualTo("weekdays")
        assertThat(Routines.describeDays(listOf("saturday", "sunday"))).isEqualTo("weekends")
        assertThat(Routines.describeDays(listOf("monday", "thursday"))).isEqualTo("mon, thu")
        val wake = Routines.Spec("wake_up", listOf("z1" to "zone"), Time(7, 15), Routines.parseDays(listOf("weekdays")), 20, endBrightness = 80, turnOffAfterMinutes = 30)
        val wcfg = Routines.buildConfiguration(wake)
        assertThat(wcfg["end_brightness"]!!.jsonPrimitive.content).isEqualTo("80")
        assertThat(wcfg["fade_in_duration"]!!.jsonObject["seconds"]!!.jsonPrimitive.content).isEqualTo("1200")
        assertThat(wcfg["turn_lights_off_after"]!!.jsonObject["minutes"]!!.jsonPrimitive.content).isEqualTo("30")
        assertThat(wcfg["when"]!!.jsonObject["recurrence_days"]!!.jsonArray).hasSize(5)
        assertThat(Routines.parseConfiguration(Routines.WAKE_UP_SCRIPT_ID, wcfg)).isEqualTo(wake)
        assertThat(Routines.describe(wake)).isEqualTo("sunrise over 20 min to 80% at 07:15 weekdays, off 30 min later")
        val gts = Routines.Spec("go_to_sleep", listOf("r1" to "room"), Time(23, 0), Routines.parseDays(null), 30, endState = "turn_off")
        val gcfg = Routines.buildConfiguration(gts)
        assertThat(gcfg["end_state"]!!.jsonPrimitive.content).isEqualTo("turn_off")
        assertThat(Routines.parseConfiguration(Routines.GO_TO_SLEEP_SCRIPT_ID, gcfg)).isEqualTo(gts)
        assertThat(Routines.describe(gts)).isEqualTo("fade out over 30 min at 23:00 every day, then off")
        assertThat(Routines.body(wake, "x", true)["script_id"]!!.jsonPrimitive.content).isEqualTo(Routines.WAKE_UP_SCRIPT_ID)
        assertThat(Routines.body(wake, "x", true, forUpdate = true)["script_id"]).isNull()
        assertThat(Routines.parseConfiguration("other", gcfg)).isNull()
    }
}
