package pt.prospero.huepilot.domain

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

/**
 * Motion automations: what a motion sensor or Hue Secure camera makes the lights do. On the bridge
 * they are `behavior_instance` resources of the "Hue Accessories" script — the same ones the Hue
 * app creates — so they run on the bridge with every app closed. Mirrors hue-core/automations.ts.
 *
 * Bridge facts (verified on a Bridge Pro): one instance per source device (a POST for a device that
 * already has one updates it); `light_level` absent = any time of day; each timeslot runs from its
 * start until the next slot's start, wrapping past midnight.
 */
object MotionAutomations {
    const val SCRIPT_ID = "67d9395b-4403-42cc-b5f0-740b699d67c6"

    data class Time(val hour: Int, val minute: Int) {
        val minutes: Int get() = hour * 60 + minute
        override fun toString(): String = "%02d:%02d".format(hour, minute)
    }

    sealed class Action {
        object Nothing : Action()
        object Off : Action()
        data class Scene(val sceneId: String) : Action()
    }

    data class Slot(val start: Time, val onMotion: Action, val noMotionAfterMinutes: Int, val onNoMotion: Action, val doNotDisturb: Boolean = false)

    data class Spec(
        val sourceDeviceId: String,
        val motionServiceId: String,
        val motionType: String,
        val where: List<Pair<String, String>>, // id to "room"/"zone"
        val onlyWhenDark: Boolean,
        val slots: List<Slot>,
    )

    /** Default "dark" window: half an hour before sunset until half an hour after sunrise. */
    private fun defaultDark(): JsonObject = buildJsonObject {
        putJsonObject("daylight") {
            putJsonObject("sunrise_sunset") {
                putJsonObject("sunrise_offset") { put("minutes", 30) }
                putJsonObject("sunset_offset") { put("minutes", -30) }
            }
        }
    }

    private fun actionJson(a: Action): kotlinx.serialization.json.JsonElement = when (a) {
        is Action.Scene -> buildJsonObject { putJsonObject("recall") { put("rid", a.sceneId); put("rtype", "scene") } }
        Action.Off -> JsonPrimitive("all_off")
        Action.Nothing -> JsonPrimitive("do_nothing")
    }

    private fun actionFrom(e: kotlinx.serialization.json.JsonElement?): Action = when {
        e == null -> Action.Nothing
        e is JsonPrimitive && e.contentOrNull == "all_off" -> Action.Off
        e is JsonObject -> (e["recall"] as? JsonObject)?.get("rid")?.jsonPrimitive?.contentOrNull?.let { Action.Scene(it) } ?: Action.Nothing
        else -> Action.Nothing
    }

    /** Bridge configuration; [existingLightLevel] keeps a darkness condition made in the Hue app when still wanted. */
    fun buildConfiguration(spec: Spec, existingLightLevel: JsonObject? = null): JsonObject = buildJsonObject {
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
        if (spec.onlyWhenDark) put("light_level", existingLightLevel ?: defaultDark())
    }

    /** POST needs `script_id`; PUT refuses it ("property: script_id not allowed"), so pass [forUpdate] when rewriting a rule. */
    fun instanceBody(spec: Spec, name: String, enabled: Boolean, existingLightLevel: JsonObject? = null, forUpdate: Boolean = false): JsonObject = buildJsonObject {
        if (!forUpdate) {
            put("type", "behavior_instance")
            put("script_id", SCRIPT_ID)
        }
        put("enabled", enabled)
        putJsonObject("metadata") { put("name", name.take(32)) }
        put("configuration", buildConfiguration(spec, existingLightLevel))
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
            onlyWhenDark = cfg["light_level"] != null,
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

    /** One-liner such as `07:00 nothing · 22:00 "Nightlight", off after 5 min · only when dark`. */
    fun describe(slots: List<Slot>, onlyWhenDark: Boolean, sceneName: (String) -> String): String {
        fun act(a: Action) = when (a) { is Action.Scene -> "\"${sceneName(a.sceneId)}\""; Action.Off -> "off"; Action.Nothing -> "nothing" }
        val parts = slots.sortedBy { it.start.minutes }.map { s ->
            val then = if (s.onNoMotion is Action.Nothing) "" else ", ${act(s.onNoMotion)} after ${s.noMotionAfterMinutes} min"
            (if (slots.size > 1) "${s.start} " else "") + act(s.onMotion) + then
        }
        return (parts + (if (onlyWhenDark) "only when dark" else "any time")).joinToString(" · ")
    }
}
