package pt.prospero.huepilot.domain

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.roundToInt

/**
 * Motion automations: what a motion sensor or Hue Secure camera makes the lights do. On the bridge
 * they are `behavior_instance` resources of the "Hue Accessories" script — the same ones the Hue
 * app creates — so they run on the bridge with every app closed. Mirrors hue-core/automations.ts.
 *
 * Bridge facts (verified on a Bridge Pro): one instance per source device (a POST for a device that
 * already has one updates it); PUT must not carry `script_id` and must include the configuration;
 * `light_level` absent = any time of day, `sunrise_sunset` = by the sun (offsets in hours or
 * minutes), `daylight_sensitivity` = the sensor's own light level below `dark_threshold` (needs
 * `offset` too); each timeslot runs from its start until the next slot's start, wrapping past midnight.
 */
object MotionAutomations {
    const val SCRIPT_ID = "67d9395b-4403-42cc-b5f0-740b699d67c6"

    /** What the Hue app stores for its default "daylight sensitivity" (about 5 lux). */
    const val DEFAULT_DARK_THRESHOLD = 7267
    const val DEFAULT_DARK_OFFSET = 7000

    data class Time(val hour: Int, val minute: Int) {
        val minutes: Int get() = hour * 60 + minute
        override fun toString(): String = "%02d:%02d".format(hour, minute)
    }

    sealed class Action {
        object Nothing : Action()
        object Off : Action()
        data class Scene(val sceneId: String) : Action()
    }

    /** When the rule may act. */
    sealed class Darkness {
        object AnyTime : Darkness()
        data class SunsetToSunrise(val sunsetOffsetMinutes: Int, val sunriseOffsetMinutes: Int) : Darkness()
        data class Sensor(val lightLevelServiceId: String, val lightLevelType: String, val darkThreshold: Int, val offset: Int) : Darkness()

        val mode: String
            get() = when (this) {
                is AnyTime -> "any"
                is SunsetToSunrise -> "sunset_to_sunrise"
                is Sensor -> "sensor"
            }
    }

    data class Slot(val start: Time, val onMotion: Action, val noMotionAfterMinutes: Int, val onNoMotion: Action, val doNotDisturb: Boolean = false)

    data class Spec(
        val sourceDeviceId: String,
        val motionServiceId: String,
        val motionType: String,
        val where: List<Pair<String, String>>, // id to "room"/"zone"
        val darkness: Darkness,
        val slots: List<Slot>,
    )

    /** The bridge's light-level scale: 10000 · log10(lux) + 1. */
    fun luxToLightLevel(lux: Double): Int = max(0, (10000 * log10(max(0.01, lux)) + 1).roundToInt())

    fun lightLevelToLux(level: Int): Double = 10.0.pow((level - 1) / 10000.0)

    private fun actionJson(a: Action): JsonElement = when (a) {
        is Action.Scene -> buildJsonObject { putJsonObject("recall") { put("rid", a.sceneId); put("rtype", "scene") } }
        Action.Off -> JsonPrimitive("all_off")
        Action.Nothing -> JsonPrimitive("do_nothing")
    }

    private fun actionFrom(e: JsonElement?): Action = when {
        e == null -> Action.Nothing
        e is JsonPrimitive && e.contentOrNull == "all_off" -> Action.Off
        e is JsonObject -> (e["recall"] as? JsonObject)?.get("rid")?.jsonPrimitive?.contentOrNull?.let { Action.Scene(it) } ?: Action.Nothing
        else -> Action.Nothing
    }

    private fun offsetJson(minutes: Int): JsonObject =
        if (minutes != 0 && minutes % 60 == 0) buildJsonObject { put("hours", minutes / 60) } else buildJsonObject { put("minutes", minutes) }

    private fun offsetFrom(o: JsonElement?): Int {
        val obj = o as? JsonObject ?: return 0
        return (obj["hours"]?.jsonPrimitive?.intOrNull ?: 0) * 60 + (obj["minutes"]?.jsonPrimitive?.intOrNull ?: 0)
    }

    fun buildLightLevel(d: Darkness): JsonObject? = when (d) {
        is Darkness.AnyTime -> null
        is Darkness.SunsetToSunrise -> buildJsonObject {
            putJsonObject("daylight") { putJsonObject("sunrise_sunset") { put("sunrise_offset", offsetJson(d.sunriseOffsetMinutes)); put("sunset_offset", offsetJson(d.sunsetOffsetMinutes)) } }
        }
        is Darkness.Sensor -> buildJsonObject {
            putJsonObject("daylight") {
                putJsonObject("daylight_sensitivity") {
                    putJsonObject("light_level_service") { put("rid", d.lightLevelServiceId); put("rtype", d.lightLevelType) }
                    putJsonObject("settings") { put("dark_threshold", d.darkThreshold); put("offset", d.offset) }
                }
            }
        }
    }

    fun parseLightLevel(v: JsonObject?): Darkness {
        val daylight = v?.get("daylight") as? JsonObject ?: return Darkness.AnyTime
        (daylight["sunrise_sunset"] as? JsonObject)?.let { ss -> return Darkness.SunsetToSunrise(offsetFrom(ss["sunset_offset"]), offsetFrom(ss["sunrise_offset"])) }
        (daylight["daylight_sensitivity"] as? JsonObject)?.let { ds ->
            val service = ds["light_level_service"] as? JsonObject
            val rid = service?.get("rid")?.jsonPrimitive?.contentOrNull ?: return@let
            val settings = ds["settings"] as? JsonObject
            return Darkness.Sensor(
                rid,
                if (service["rtype"]?.jsonPrimitive?.contentOrNull == "grouped_light_level") "grouped_light_level" else "light_level",
                settings?.get("dark_threshold")?.jsonPrimitive?.intOrNull ?: DEFAULT_DARK_THRESHOLD,
                settings?.get("offset")?.jsonPrimitive?.intOrNull ?: DEFAULT_DARK_OFFSET,
            )
        }
        return Darkness.SunsetToSunrise(-30, 30)
    }

    /** Bridge configuration (round-trips what the Hue app writes). */
    fun buildConfiguration(spec: Spec): JsonObject = buildJsonObject {
        putJsonObject("source") { put("rid", spec.sourceDeviceId); put("rtype", "device") }
        putJsonObject("motion") {
            putJsonObject("motion_service") { put("rid", spec.motionServiceId); put("rtype", spec.motionType) }
            putJsonArray("where") { for ((id, kind) in spec.where) add(buildJsonObject { putJsonObject("group") { put("rid", id); put("rtype", kind) } }) }
            putJsonObject("when") {
                putJsonArray("timeslots") {
                    for (s in spec.slots.sortedBy { it.start.minutes }) add(buildJsonObject {
                        putJsonObject("start_time") { put("type", "time"); putJsonObject("time") { put("hour", s.start.hour); put("minute", s.start.minute) } }
                        putJsonObject("on_motion") { putJsonArray("recall_single") { add(buildJsonObject { put("action", actionJson(if (s.onMotion is Action.Off) Action.Nothing else s.onMotion)) }) } }
                        putJsonObject("on_no_motion") {
                            putJsonObject("after") { put("minutes", s.noMotionAfterMinutes.coerceAtLeast(1)) }
                            putJsonArray("recall_single") { add(buildJsonObject { put("action", actionJson(s.onNoMotion)) }) }
                        }
                        if (s.doNotDisturb) put("do_not_disturb", true)
                    })
                }
            }
        }
        buildLightLevel(spec.darkness)?.let { put("light_level", it) }
    }

    /** POST needs `script_id`; PUT refuses it ("property: script_id not allowed"), so pass [forUpdate] when rewriting a rule. */
    fun instanceBody(spec: Spec, name: String, enabled: Boolean, forUpdate: Boolean = false): JsonObject = buildJsonObject {
        if (!forUpdate) {
            put("type", "behavior_instance")
            put("script_id", SCRIPT_ID)
        }
        put("enabled", enabled)
        putJsonObject("metadata") { put("name", name.take(32)) }
        put("configuration", buildConfiguration(spec))
    }

    /** Reads a bridge configuration back; null when it is not a motion automation. */
    fun parseConfiguration(cfg: JsonObject?): Spec? {
        val motion = cfg?.get("motion") as? JsonObject ?: return null
        val service = motion["motion_service"] as? JsonObject ?: return null
        val serviceId = service["rid"]?.jsonPrimitive?.contentOrNull ?: return null
        val sourceId = (cfg["source"] as? JsonObject)?.get("rid")?.jsonPrimitive?.contentOrNull ?: return null
        val slots = ((motion["when"] as? JsonObject)?.get("timeslots") as? JsonArray ?: JsonArray(emptyList())).mapNotNull { t ->
            val slot = t as? JsonObject ?: return@mapNotNull null
            val time = (slot["start_time"] as? JsonObject)?.get("time") as? JsonObject
            val onMotion = ((slot["on_motion"] as? JsonObject)?.get("recall_single") as? JsonArray)?.firstOrNull()?.jsonObject?.get("action")
            val noMotion = slot["on_no_motion"] as? JsonObject
            val after = noMotion?.get("after") as? JsonObject
            val minutes = after?.get("minutes")?.jsonPrimitive?.intOrNull ?: after?.get("seconds")?.jsonPrimitive?.intOrNull?.let { (it / 60).coerceAtLeast(1) } ?: 5
            Slot(
                start = Time(time?.get("hour")?.jsonPrimitive?.intOrNull ?: 0, time?.get("minute")?.jsonPrimitive?.intOrNull ?: 0),
                onMotion = actionFrom(onMotion),
                noMotionAfterMinutes = minutes,
                onNoMotion = actionFrom((noMotion?.get("recall_single") as? JsonArray)?.firstOrNull()?.jsonObject?.get("action")),
                doNotDisturb = slot["do_not_disturb"]?.jsonPrimitive?.contentOrNull == "true",
            )
        }
        val where = (motion["where"] as? JsonArray ?: JsonArray(emptyList())).mapNotNull { w ->
            val g = (w as? JsonObject)?.get("group") as? JsonObject ?: return@mapNotNull null
            val rid = g["rid"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
            rid to (if (g["rtype"]?.jsonPrimitive?.contentOrNull == "zone") "zone" else "room")
        }
        return Spec(
            sourceDeviceId = sourceId,
            motionServiceId = serviceId,
            motionType = if (service["rtype"]?.jsonPrimitive?.contentOrNull == "camera_motion") "camera_motion" else "motion",
            where = where,
            darkness = parseLightLevel(cfg["light_level"] as? JsonObject),
            slots = slots,
        )
    }

    fun isMotionAutomation(instance: JsonObject): Boolean =
        instance["script_id"]?.jsonPrimitive?.contentOrNull == SCRIPT_ID && (instance["configuration"] as? JsonObject)?.get("motion") != null

    private val timeRegex = Regex("^(\\d{1,2})(?:[:h.](\\d{2}))?\\s*(am|pm|h)?$")

    /** "HH:MM", "7:30", "7pm", "19h30", "noon", "midnight". */
    fun parseTime(text: String?): Time {
        val s = text?.trim()?.lowercase().orEmpty()
        require(s.isNotEmpty()) { "Time is missing (use HH:MM)." }
        if (s == "noon" || s == "midday") return Time(12, 0)
        if (s == "midnight") return Time(0, 0)
        val m = timeRegex.matchEntire(s) ?: throw IllegalArgumentException("Invalid time \"$text\", expected HH:MM.")
        var hour = m.groupValues[1].toInt()
        val minute = m.groupValues[2].ifEmpty { "0" }.toInt()
        if (m.groupValues[3] == "pm" && hour < 12) hour += 12
        if (m.groupValues[3] == "am" && hour == 12) hour = 0
        require(hour <= 23 && minute <= 59) { "Invalid time \"$text\", expected HH:MM." }
        return Time(hour, minute)
    }

    private fun fmtOffset(minutes: Int, base: String): String {
        if (minutes == 0) return base
        val abs = kotlin.math.abs(minutes)
        val txt = if (abs % 60 == 0) "${abs / 60} h" else "$abs min"
        return "$txt ${if (minutes < 0) "before" else "after"} $base"
    }

    fun describeDarkness(d: Darkness): String = when (d) {
        is Darkness.AnyTime -> "any time"
        is Darkness.SunsetToSunrise -> "only when dark (${fmtOffset(d.sunsetOffsetMinutes, "sunset")} → ${fmtOffset(d.sunriseOffsetMinutes, "sunrise")})"
        is Darkness.Sensor -> {
            val lux = lightLevelToLux(d.darkThreshold)
            val txt = if (lux >= 10) lux.roundToInt().toString() else ((lux * 10).roundToInt() / 10.0).toString()
            "only when dark (sensor below ~$txt lx)"
        }
    }

    /** One-liner such as `07:00 nothing · 22:00 "Nightlight", off after 5 min · only when dark (…)`. */
    fun describe(slots: List<Slot>, darkness: Darkness, sceneName: (String) -> String): String {
        fun act(a: Action) = when (a) { is Action.Scene -> "\"${sceneName(a.sceneId)}\""; Action.Off -> "off"; Action.Nothing -> "nothing" }
        val parts = slots.sortedBy { it.start.minutes }.map { s ->
            val then = if (s.onNoMotion is Action.Nothing) "" else ", ${act(s.onNoMotion)} after ${s.noMotionAfterMinutes} min"
            (if (slots.size > 1) "${s.start} " else "") + act(s.onMotion) + then
        }
        return (parts + describeDarkness(darkness)).joinToString(" · ")
    }
}
