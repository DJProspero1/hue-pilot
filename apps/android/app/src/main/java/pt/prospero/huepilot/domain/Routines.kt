package pt.prospero.huepilot.domain

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

/**
 * Wake-up and go-to-sleep routines: bridge `behavior_instance`s of the Hue app's "Basic wake up
 * routine" and "Go to sleep routines" scripts. Mirrors hue-core/routines.ts. Shapes verified on a
 * Bridge Pro: wake up = { end_brightness, fade_in_duration{seconds}, style: sunrise,
 * turn_lights_off_after?{minutes}, when{recurrence_days, time_point}, where }, go to sleep =
 * { end_state: nightlight | turn_off, fade_out_duration{seconds}, style: sunset, when, where }.
 */
object Routines {
    const val WAKE_UP_SCRIPT_ID = "ff8957e3-2eb9-4699-a0c8-ad2cb3ede704"
    const val GO_TO_SLEEP_SCRIPT_ID = "7e571ac6-f363-42e1-809a-4cbf6523ed72"
    val DAY_NAMES = listOf("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")

    data class Spec(
        val kind: String, // "wake_up" | "go_to_sleep"
        val where: List<Pair<String, String>>,
        val time: MotionAutomations.Time,
        val days: List<String>,
        val fadeMinutes: Int,
        val endBrightness: Int? = null,
        val turnOffAfterMinutes: Int? = null,
        val endState: String? = null, // "nightlight" | "turn_off"
    )

    fun isRoutine(scriptId: String?): Boolean = scriptId == WAKE_UP_SCRIPT_ID || scriptId == GO_TO_SLEEP_SCRIPT_ID

    /** mon/tue/…, full names, weekdays, weekends, daily; empty = every day. */
    fun parseDays(input: List<String>?): List<String> {
        val words = input.orEmpty().flatMap { it.split(Regex("[,\\s/]+")) }.map { it.trim().lowercase() }.filter { it.isNotEmpty() }
        if (words.isEmpty()) return DAY_NAMES
        val out = LinkedHashSet<String>()
        for (w in words) {
            when {
                w in setOf("daily", "everyday", "every", "day", "all", "always") -> return DAY_NAMES
                w == "weekdays" || w == "weekday" -> out.addAll(DAY_NAMES.take(5))
                w == "weekends" || w == "weekend" -> out.addAll(DAY_NAMES.drop(5))
                else -> out.add(DAY_NAMES.firstOrNull { it.startsWith(w.take(3)) } ?: throw IllegalArgumentException("Unknown day \"$w\". Use mon, tue, wed, thu, fri, sat, sun, weekdays or weekends."))
            }
        }
        return DAY_NAMES.filter { it in out }
    }

    fun describeDays(days: List<String>): String {
        val set = days.toSet()
        if (DAY_NAMES.all { it in set }) return "every day"
        if (DAY_NAMES.take(5).all { it in set } && "saturday" !in set && "sunday" !in set) return "weekdays"
        if (set == setOf("saturday", "sunday")) return "weekends"
        return DAY_NAMES.filter { it in set }.joinToString(", ") { it.take(3) }.ifEmpty { "never" }
    }

    fun buildConfiguration(spec: Spec): JsonObject = buildJsonObject {
        val seconds = (spec.fadeMinutes * 60).coerceAtLeast(60)
        if (spec.kind == "wake_up") {
            put("end_brightness", (spec.endBrightness ?: 100).coerceIn(1, 100))
            putJsonObject("fade_in_duration") { put("seconds", seconds) }
            put("style", "sunrise")
            spec.turnOffAfterMinutes?.takeIf { it > 0 }?.let { putJsonObject("turn_lights_off_after") { put("minutes", it) } }
        } else {
            put("end_state", spec.endState ?: "nightlight")
            putJsonObject("fade_out_duration") { put("seconds", seconds) }
            put("style", "sunset")
        }
        putJsonObject("when") {
            putJsonArray("recurrence_days") { for (d in spec.days) add(JsonPrimitive(d)) }
            putJsonObject("time_point") { put("type", "time"); putJsonObject("time") { put("hour", spec.time.hour); put("minute", spec.time.minute) } }
        }
        putJsonArray("where") { for ((id, kind) in spec.where) add(buildJsonObject { putJsonObject("group") { put("rid", id); put("rtype", kind) } }) }
    }

    fun parseConfiguration(scriptId: String?, cfg: JsonObject?): Spec? {
        if (cfg == null) return null
        val kind = when (scriptId) { WAKE_UP_SCRIPT_ID -> "wake_up"; GO_TO_SLEEP_SCRIPT_ID -> "go_to_sleep"; else -> return null }
        val whenObj = cfg["when"] as? JsonObject
        val time = (whenObj?.get("time_point") as? JsonObject)?.get("time") as? JsonObject
        val fade = (if (kind == "wake_up") cfg["fade_in_duration"] else cfg["fade_out_duration"]) as? JsonObject
        val where = (cfg["where"] as? JsonArray ?: JsonArray(emptyList())).mapNotNull { w ->
            val g = (w as? JsonObject)?.get("group") as? JsonObject ?: return@mapNotNull null
            val rid = g["rid"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
            rid to (if (g["rtype"]?.jsonPrimitive?.contentOrNull == "zone") "zone" else "room")
        }
        return Spec(
            kind = kind,
            where = where,
            time = MotionAutomations.Time(time?.get("hour")?.jsonPrimitive?.intOrNull ?: 0, time?.get("minute")?.jsonPrimitive?.intOrNull ?: 0),
            days = (whenObj?.get("recurrence_days") as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }?.filter { it in DAY_NAMES } ?: emptyList(),
            fadeMinutes = ((fade?.get("seconds")?.jsonPrimitive?.intOrNull ?: 1800) / 60.0).let { Math.round(it).toInt() },
            endBrightness = if (kind == "wake_up") cfg["end_brightness"]?.jsonPrimitive?.intOrNull ?: 100 else null,
            turnOffAfterMinutes = if (kind == "wake_up") (cfg["turn_lights_off_after"] as? JsonObject)?.get("minutes")?.jsonPrimitive?.intOrNull else null,
            endState = if (kind == "go_to_sleep") cfg["end_state"]?.jsonPrimitive?.contentOrNull ?: "nightlight" else null,
        )
    }

    fun body(spec: Spec, name: String, enabled: Boolean, forUpdate: Boolean = false): JsonObject = buildJsonObject {
        if (!forUpdate) {
            put("type", "behavior_instance")
            put("script_id", if (spec.kind == "wake_up") WAKE_UP_SCRIPT_ID else GO_TO_SLEEP_SCRIPT_ID)
        }
        put("enabled", enabled)
        putJsonObject("metadata") { put("name", name.take(32)) }
        put("configuration", buildConfiguration(spec))
    }

    fun describe(spec: Spec): String {
        val whenTxt = "${spec.time} ${describeDays(spec.days)}"
        return if (spec.kind == "wake_up") {
            "sunrise over ${spec.fadeMinutes} min to ${spec.endBrightness ?: 100}% at $whenTxt" + (spec.turnOffAfterMinutes?.takeIf { it > 0 }?.let { ", off $it min later" } ?: "")
        } else {
            "fade out over ${spec.fadeMinutes} min at $whenTxt, then ${if (spec.endState == "turn_off") "off" else "nightlight"}"
        }
    }
}
