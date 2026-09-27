package pt.prospero.huepilot.assistant

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject
import pt.prospero.huepilot.data.hue.GroupUi
import pt.prospero.huepilot.data.hue.HomeSnapshot
import pt.prospero.huepilot.data.hue.HueException
import pt.prospero.huepilot.data.hue.HueRepository
import pt.prospero.huepilot.data.hue.LightUi
import pt.prospero.huepilot.data.hue.SceneUi
import pt.prospero.huepilot.domain.ColorMath
import pt.prospero.huepilot.domain.ColorNames
import pt.prospero.huepilot.domain.MatchResult
import pt.prospero.huepilot.domain.NameMatcher
import pt.prospero.huepilot.domain.ScheduleBuilder
import pt.prospero.huepilot.domain.XY
import kotlin.math.roundToInt
import pt.prospero.huepilot.data.hue.AccessoryUi
import pt.prospero.huepilot.data.hue.MotionAutomationUi
import pt.prospero.huepilot.domain.MotionAutomations

/**
 * The assistant tool contract shared with the desktop app and the MCP server.
 * Tool names, parameters and result shapes must stay identical across the suite.
 */
class HueTools(private val repo: HueRepository) {

    val effectNames = listOf("candle", "fire", "prism", "sparkle", "opal", "glisten", "underwater", "cosmos", "sunbeam", "enchant", "no_effect")

    /** Provider-neutral tool specs (name, description, JSON-schema parameters). */
    val specs: List<ToolSpec> = buildList {
        add(decl("get_home_overview", "Returns every room and zone with their lights, scenes and current state (on/off, brightness, colour). Call this first when you need to know what exists or the current state.", emptyMap(), emptyList()))
        add(decl("set_room", "Control all lights of a room or zone. Setting brightness or colour implies turning it on unless on=false.",
            mapOf(
                "room" to str("Room or zone name (or id)."),
                "on" to bool("Turn on (true) or off (false)."),
                "brightness" to num("Brightness percent 1..100."),
                "color" to str("Colour name (red, blue, pink...), hex like #ff8800, or white preset (warm, relax, cool, daylight...)."),
                "color_temperature" to str("White colour temperature: preset (warm, cool...), '3000K', Kelvin number or mirek."),
                "transition_seconds" to num("Fade time in seconds."),
            ), listOf("room")))
        add(decl("set_light", "Control a single light.",
            mapOf(
                "light" to str("Light name (or id)."),
                "room" to str("Optional room name to disambiguate."),
                "on" to bool("Turn on/off."),
                "brightness" to num("Brightness percent 1..100."),
                "color" to str("Colour name, hex or white preset."),
                "color_temperature" to str("White colour temperature preset, Kelvin or mirek."),
                "transition_seconds" to num("Fade time in seconds."),
            ), listOf("light")))
        add(decl("set_all_lights", "Turn every light in the home on or off.",
            mapOf("on" to bool("true = on, false = off."), "brightness" to num("Brightness percent 1..100.")), listOf("on")))
        add(decl("activate_scene", "Activate a scene in its room/zone.",
            mapOf(
                "scene" to str("Scene name (or id)."),
                "room" to str("Optional room/zone name to disambiguate."),
                "dynamic" to bool("Start the scene's dynamic (animated) mode."),
            ), listOf("scene")))
        add(decl("set_effect", "Start a light effect on a light or on every light of a room that supports it.",
            mapOf(
                "target" to str("Light or room name."),
                "effect" to enumOf("Effect name.", effectNames),
            ), listOf("target", "effect")))
        add(decl("identify_light", "Make a light blink (breathe) so the user can find it.", mapOf("light" to str("Light name (or id).")), listOf("light")))
        add(decl("get_sensor_readings", "Read motion sensors, Hue Secure cameras (motion, ambient light, battery), temperature, light level, battery and switch button sensors.", emptyMap(), emptyList()))
        add(decl("set_camera_motion_detection", "Enable or disable motion detection on a Hue Secure camera.",
            mapOf("camera" to str("Camera name (or id)."), "enabled" to bool("true = detect motion, false = pause detection.")), listOf("camera", "enabled")))
        add(decl("list_schedules", "List timers/schedules stored on the bridge.", emptyMap(), emptyList()))
        add(decl("create_schedule", "Create a bridge-side schedule that changes a room, zone or light at a time of day.",
            mapOf(
                "name" to str("Schedule name."),
                "time" to str("Time of day HH:MM (24h)."),
                "days" to buildJsonObject { put("type", "array"); put("description", "Days of week: mon,tue,wed,thu,fri,sat,sun. Omit for every day."); putJsonObject("items") { put("type", "string") } },
                "once_date" to str("YYYY-MM-DD for a one-time schedule."),
                "target" to str("Room, zone or light name."),
                "on" to bool("Turn on/off."),
                "brightness" to num("Brightness percent 1..100."),
                "scene" to str("Scene name to activate (rooms/zones only)."),
            ), listOf("time", "target")))
        add(decl("delete_schedule", "Delete a schedule by id.", mapOf("id" to str("Schedule id from list_schedules.")), listOf("id")))
        add(decl("list_motion_automations", "List what each motion sensor and Hue Secure camera makes the lights do on motion (the bridge-side automations, one per sensor): which room, which scene on motion, what happens after no motion, time slots, and whether it only works when dark.", emptyMap(), emptyList()))
        add(decl("set_motion_automation", "Create or replace the automation of a motion sensor or camera (runs on the bridge, app closed or not). Simple form: on_motion (a scene of that room, e.g. \"Bright\", or \"nothing\"), off_after_minutes, optional from/until clock window (outside it the sensor does nothing), only_when_dark. For different day/night behaviour pass slots instead. To only pause/resume an existing automation pass just sensor and enabled. When the user does not say, ask whether it should work only when dark.",
            mapOf(
                "sensor" to str("Motion sensor or camera name."),
                "room" to str("Room or zone whose lights it controls. Defaults to the existing automation's room."),
                "on_motion" to str("Scene name to activate when motion starts (must belong to the room), \"on\" for the room's brightest scene, or \"nothing\"."),
                "off_after_minutes" to num("Minutes without motion before on_no_motion happens (default 5)."),
                "on_no_motion" to str("\"off\" (default), \"nothing\", or a scene name."),
                "from" to str("Start of the active window, HH:MM. Omit for all day."),
                "until" to str("End of the active window, HH:MM."),
                "only_when_dark" to bool("true = only between sunset and sunrise; false = any time of day."),
                "do_not_disturb" to bool("true = leave the lights alone when someone changed them by hand."),
                "enabled" to bool("false pauses the automation, true resumes it."),
                "name" to str("Optional name; defaults to the sensor name."),
                "slots" to buildJsonObject {
                    put("type", "array")
                    put("description", "Advanced: time slots, each active from its \"from\" until the next slot. Replaces on_motion/off_after_minutes/on_no_motion/from/until.")
                    putJsonObject("items") {
                        put("type", "object")
                        putJsonObject("properties") {
                            put("from", str("HH:MM")); put("on_motion", str("Scene name, \"on\" or \"nothing\".")); put("off_after_minutes", num("Minutes.")); put("on_no_motion", str("\"off\", \"nothing\" or a scene name."))
                        }
                        putJsonArray("required") { add(JsonPrimitive("from")) }
                    }
                },
            ), listOf("sensor")))
        add(decl("delete_motion_automation", "Remove the motion automation of a sensor or camera, so motion no longer changes any light.", mapOf("sensor" to str("Motion sensor or camera name (or the automation id from list_motion_automations).")), listOf("sensor")))
        add(decl("set_motion_sensing", "Switch motion sensing itself on or off for a motion sensor or a Hue Secure camera (off = it stops reporting motion; its automation then never fires).",
            mapOf("sensor" to str("Motion sensor or camera name."), "enabled" to bool("true = sensing on, false = off.")), listOf("sensor", "enabled")))
    }

    /** Gemini-style `functionDeclarations` view of [specs] (also the neutral JSON shape). */
    val declarations: JsonArray = JsonArray(specs.map { s ->
        buildJsonObject { put("name", s.name); put("description", s.description); put("parameters", s.parameters) }
    })

    private fun decl(name: String, description: String, props: Map<String, JsonObject>, required: List<String>): ToolSpec = ToolSpec(
        name = name,
        description = description,
        parameters = buildJsonObject {
            put("type", "object")
            putJsonObject("properties") { props.forEach { (k, v) -> put(k, v) } }
            if (required.isNotEmpty()) putJsonArray("required") { required.forEach { add(JsonPrimitive(it)) } }
        },
    )

    private fun str(d: String) = buildJsonObject { put("type", "string"); put("description", d) }
    private fun bool(d: String) = buildJsonObject { put("type", "boolean"); put("description", d) }
    private fun num(d: String) = buildJsonObject { put("type", "number"); put("description", d) }
    private fun enumOf(d: String, values: List<String>) = buildJsonObject {
        put("type", "string"); put("description", d); putJsonArray("enum") { values.forEach { add(JsonPrimitive(it)) } }
    }

    // ------------------------------------------------------------------ execution

    suspend fun execute(name: String, args: JsonObject): JsonObject = try {
        when (name) {
            "get_home_overview" -> homeOverview()
            "set_room" -> setRoom(args)
            "set_light" -> setLight(args)
            "set_all_lights" -> setAllLights(args)
            "activate_scene" -> activateScene(args)
            "set_effect" -> setEffect(args)
            "identify_light" -> identifyLight(args)
            "get_sensor_readings" -> sensorReadings()
            "set_camera_motion_detection" -> setCameraMotionDetection(args)
            "list_schedules" -> listSchedules()
            "create_schedule" -> createSchedule(args)
            "delete_schedule" -> deleteSchedule(args)
            "list_motion_automations" -> listMotionAutomations()
            "set_motion_automation" -> setMotionAutomation(args)
            "delete_motion_automation" -> deleteMotionAutomation(args)
            "set_motion_sensing" -> setMotionSensing(args)
            else -> err("unknown_tool", "Unknown tool: $name")
        }
    } catch (e: HueException) {
        err("bridge_error", e.message ?: "Bridge error")
    } catch (e: IllegalArgumentException) {
        err("invalid_argument", e.message ?: "Invalid argument")
    } catch (e: Exception) {
        err("error", e.message ?: e.toString())
    }

    /** Short human label for the inline chat card, derived from a result. */
    fun summarize(name: String, args: JsonObject, result: JsonObject): String {
        val ok = result["ok"]?.jsonPrimitive?.content == "true"
        result["message"]?.jsonPrimitive?.content?.let { if (ok) return it }
        val error = result["error"]?.jsonPrimitive?.content
        return when {
            !ok && error == "ambiguous" -> "Ambiguous: ${args.values.firstOrNull()?.jsonPrimitive?.content ?: name}"
            !ok && error == "not_found" -> "Not found: ${args.values.firstOrNull()?.jsonPrimitive?.content ?: name}"
            !ok -> "Failed: ${result["message"]?.jsonPrimitive?.content ?: error ?: name}"
            else -> when (name) {
                "get_home_overview" -> "Read home overview"
                "get_sensor_readings" -> "Read sensors and cameras"
                "set_camera_motion_detection" -> "Camera motion detection updated"
                "list_schedules" -> "Listed schedules"
                "list_motion_automations" -> "Listed motion automations"
                else -> name.replace('_', ' ')
            }
        }
    }

    // ------------------------------------------------------------------ helpers

    private val snap: HomeSnapshot get() = repo.snapshot.value

    private fun ok(message: String, extra: JsonObject = JsonObject(emptyMap())) = buildJsonObject {
        put("ok", true); put("message", message); extra.forEach { (k, v) -> put(k, v) }
    }

    private fun err(code: String, message: String, extra: JsonObject = JsonObject(emptyMap())) = buildJsonObject {
        put("ok", false); put("error", code); put("message", message); extra.forEach { (k, v) -> put(k, v) }
    }

    private fun namesArray(items: List<String>) = buildJsonArray { items.forEach { add(JsonPrimitive(it)) } }

    private fun <T> matchFail(res: MatchResult<T>, what: String, query: String?, name: (T) -> String): JsonObject = when (res) {
        is MatchResult.Ambiguous -> err("ambiguous", "Several ${what}s match \"$query\"", buildJsonObject { put("candidates", namesArray(res.candidates.map(name))) })
        is MatchResult.NotFound -> err("not_found", "No $what named \"$query\"", buildJsonObject { put("available", namesArray(res.available.map(name))) })
        is MatchResult.Found -> err("error", "unexpected")
    }

    private fun matchGroup(query: String?): MatchResult<GroupUi> = NameMatcher.match(query, snap.groups, { it.name }, { it.id })

    private fun matchLight(query: String?, room: String?): MatchResult<LightUi> {
        var pool = snap.lights
        if (!room.isNullOrBlank()) {
            (matchGroup(room) as? MatchResult.Found)?.item?.let { g -> pool = g.lights }
        }
        return NameMatcher.match(query, pool, { it.name }, { it.id })
    }

    private fun matchScene(query: String?, room: String?): MatchResult<SceneUi> {
        var pool = snap.scenes
        if (!room.isNullOrBlank()) {
            (matchGroup(room) as? MatchResult.Found)?.item?.let { g -> pool = pool.filter { it.groupId == g.id } }
        }
        return NameMatcher.match(query, pool, { it.name }, { it.id })
    }

    private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content?.takeIf { it.isNotBlank() && it != "null" }
    private fun JsonObject.bool(key: String): Boolean? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content?.let {
        when (it.lowercase()) { "true" -> true; "false" -> false; else -> null }
    }
    private fun JsonObject.num(key: String): Double? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.content?.toDoubleOrNull()
    private fun JsonObject.any(key: String): Any? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.let { p ->
        p.content.toDoubleOrNull() ?: p.content
    }

    private fun transitionMs(args: JsonObject): Int? = args.num("transition_seconds")?.let { (it * 1000).roundToInt().coerceIn(0, 600_000) }

    private data class Desired(val on: Boolean?, val brightness: Double?, val xy: XY?, val mirek: Int?, val label: String?)

    private fun parseDesired(args: JsonObject): Desired {
        val brightness = args.num("brightness")?.coerceIn(1.0, 100.0)
        var xy: XY? = null
        var mirek: Int? = null
        var label: String? = null
        args.str("color")?.let { c ->
            val parsed = ColorNames.parseColor(c) ?: throw IllegalArgumentException("Unknown colour \"$c\"")
            xy = parsed.xy; mirek = parsed.mirek; label = parsed.label
        }
        args.any("color_temperature")?.let { ct ->
            val m = ColorNames.parseColorTemperature(ct) ?: throw IllegalArgumentException("Unknown colour temperature \"$ct\"")
            mirek = m; xy = null; label = ct.toString().let { if (it.endsWith(".0")) it.dropLast(2) else it }
        }
        var on = args.bool("on")
        if (on == null && (brightness != null || xy != null || mirek != null)) on = true
        return Desired(on, brightness, xy, mirek, label)
    }

    private fun describe(name: String, d: Desired): String {
        val parts = ArrayList<String>()
        if (d.on == false) return "$name turned off"
        if (d.on == true) parts += "turned on"
        d.brightness?.let { parts += "at ${it.roundToInt()}%" }
        d.label?.let { parts += "set to $it" }
        if (parts.isEmpty()) return "$name unchanged"
        return "$name ${parts.joinToString(" ")}"
    }

    private fun lightBody(d: Desired): JsonObject = buildJsonObject {
        d.on?.let { putJsonObject("on") { put("on", it) } }
        if (d.on != false) {
            d.brightness?.let { putJsonObject("dimming") { put("brightness", it) } }
            d.xy?.let { putJsonObject("color") { putJsonObject("xy") { put("x", it.x); put("y", it.y) } } }
            d.mirek?.let { putJsonObject("color_temperature") { put("mirek", it.coerceIn(153, 500)) } }
        }
    }

    private fun lightJson(l: LightUi): JsonObject = buildJsonObject {
        put("id", l.id); put("name", l.name); put("on", l.on); put("brightness", l.brightness.roundToInt())
        put("color", l.colorHexOrNull?.let { JsonPrimitive(it) } ?: JsonNull)
        put("color_temperature_kelvin", if (l.isCtMode) JsonPrimitive(l.kelvin) else JsonNull)
        putJsonObject("supports") {
            put("color", l.supportsColor); put("color_temperature", l.supportsCt); put("dimming", l.supportsDimming); put("effects", l.supportsEffects)
        }
    }

    // ------------------------------------------------------------------ tools

    private fun homeOverview(): JsonObject {
        val s = snap
        if (s.isEmpty) return err("not_connected", "The bridge is not connected yet")
        return buildJsonObject {
            put("ok", true)
            put("rooms", buildJsonArray {
                for (g in s.groups) {
                    add(buildJsonObject {
                        put("id", g.id); put("name", g.name); put("kind", g.kind.rtype); put("on", g.on); put("brightness", g.brightness.roundToInt())
                        put("lights", buildJsonArray { g.lights.forEach { add(lightJson(it)) } })
                        put("scenes", buildJsonArray {
                            s.scenesFor(g.id).forEach { sc -> add(buildJsonObject { put("id", sc.id); put("name", sc.name); put("active", sc.isActive) }) }
                        })
                    })
                }
            })
            put("lights_without_room", buildJsonArray { s.lightsWithoutRoom.forEach { add(lightJson(it)) } })
            put("total_lights_on", s.lightsOn)
        }
    }

    private suspend fun setRoom(args: JsonObject): JsonObject {
        val q = args.str("room") ?: throw IllegalArgumentException("room is required")
        val res = matchGroup(q)
        val group = (res as? MatchResult.Found)?.item ?: return matchFail(res, "room", q) { it.name }
        val d = parseDesired(args)
        val t = transitionMs(args)
        if (d.on == null && d.brightness == null && d.xy == null && d.mirek == null) return err("invalid_argument", "Nothing to change for ${group.name}")
        val glId = group.groupedLightId
        val onOffBody = buildJsonObject {
            d.on?.let { putJsonObject("on") { put("on", it) } }
            if (d.on != false) d.brightness?.let { putJsonObject("dimming") { put("brightness", it) } }
        }
        if (onOffBody.isNotEmpty()) {
            if (glId != null) repo.updateGroupedLight(glId, onOffBody, t)
            else group.lights.forEach { runCatching { repo.updateLight(it.id, onOffBody, t) } }
        }
        if (d.on != false && (d.xy != null || d.mirek != null)) repo.setGroupColor(group, d.xy, d.mirek, t)
        return ok(describe(group.name, d), buildJsonObject { put("room", group.name); put("lights", group.lights.size) })
    }

    private suspend fun setLight(args: JsonObject): JsonObject {
        val q = args.str("light") ?: throw IllegalArgumentException("light is required")
        val res = matchLight(q, args.str("room"))
        val light = (res as? MatchResult.Found)?.item ?: return matchFail(res, "light", q) { it.name }
        val d = parseDesired(args)
        if (d.on == null && d.brightness == null && d.xy == null && d.mirek == null) return err("invalid_argument", "Nothing to change for ${light.name}")
        var desired = d
        if (d.xy != null && !light.supportsColor) {
            // White-only light: approximate with a colour temperature if it has one.
            desired = d.copy(xy = null, mirek = if (light.supportsCt) 370 else null)
        }
        if (desired.mirek != null && !light.supportsCt) desired = desired.copy(mirek = null)
        if (desired.xy != null) desired = desired.copy(xy = ColorMath.clipToGamut(desired.xy!!, light.gamut))
        if (desired.mirek != null) desired = desired.copy(mirek = desired.mirek!!.coerceIn(light.mirekMin, light.mirekMax))
        repo.updateLight(light.id, lightBody(desired), transitionMs(args))
        return ok(describe(light.name, d), buildJsonObject { put("light", light.name); light.roomName?.let { put("room", it) } })
    }

    private suspend fun setAllLights(args: JsonObject): JsonObject {
        val on = args.bool("on") ?: throw IllegalArgumentException("on is required")
        val brightness = args.num("brightness")?.coerceIn(1.0, 100.0)
        val body = buildJsonObject {
            putJsonObject("on") { put("on", on) }
            if (on && brightness != null) putJsonObject("dimming") { put("brightness", brightness) }
        }
        val glId = snap.bridgeHomeGroupedLightId
        if (glId != null) repo.updateGroupedLight(glId, body)
        else snap.rooms.forEach { g -> g.groupedLightId?.let { runCatching { repo.updateGroupedLight(it, body) } } }
        val msg = if (on) "All lights turned on" + (brightness?.let { " at ${it.roundToInt()}%" } ?: "") else "All lights turned off"
        return ok(msg, buildJsonObject { put("lights", snap.lights.size) })
    }

    private suspend fun activateScene(args: JsonObject): JsonObject {
        val q = args.str("scene") ?: throw IllegalArgumentException("scene is required")
        val res = matchScene(q, args.str("room"))
        val scene = (res as? MatchResult.Found)?.item ?: return matchFail(res, "scene", q) { "${it.name} (${it.groupName})" }
        val dynamic = args.bool("dynamic") ?: false
        repo.recallScene(scene.id, dynamic)
        val msg = "Scene ${scene.name} activated in ${scene.groupName}" + if (dynamic) " (dynamic)" else ""
        return ok(msg, buildJsonObject { put("scene", scene.name); put("room", scene.groupName); put("dynamic", dynamic) })
    }

    private suspend fun setEffect(args: JsonObject): JsonObject {
        val q = args.str("target") ?: throw IllegalArgumentException("target is required")
        val effect = args.str("effect")?.lowercase() ?: throw IllegalArgumentException("effect is required")
        if (effect !in effectNames) throw IllegalArgumentException("Unknown effect \"$effect\"")
        val lightRes = matchLight(q, null)
        if (lightRes is MatchResult.Found) {
            val l = lightRes.item
            if (effect != "no_effect" && effect !in l.effectValues) return err("unsupported", "${l.name} does not support the $effect effect", buildJsonObject { put("supported", namesArray(l.effectValues)) })
            repo.setLightEffect(l.id, effect, l.usesEffectsV2)
            return ok(if (effect == "no_effect") "Effect stopped on ${l.name}" else "${effect.replaceFirstChar { it.uppercase() }} effect started on ${l.name}")
        }
        val groupRes = matchGroup(q)
        if (groupRes is MatchResult.Found) {
            val g = groupRes.item
            val targets = g.lights.filter { effect == "no_effect" || effect in it.effectValues }
            if (targets.isEmpty()) return err("unsupported", "No light in ${g.name} supports the $effect effect")
            targets.forEach { runCatching { repo.setLightEffect(it.id, effect, it.usesEffectsV2) } }
            return ok(
                if (effect == "no_effect") "Effects stopped in ${g.name}" else "${effect.replaceFirstChar { it.uppercase() }} effect started on ${targets.size} light(s) in ${g.name}",
                buildJsonObject { put("lights", namesArray(targets.map { it.name })) },
            )
        }
        if (lightRes is MatchResult.Ambiguous) return matchFail(lightRes, "light", q) { it.name }
        if (groupRes is MatchResult.Ambiguous) return matchFail(groupRes, "room", q) { it.name }
        return err("not_found", "No light or room named \"$q\"", buildJsonObject { put("available", namesArray(snap.groups.map { it.name } + snap.lights.map { it.name })) })
    }

    private suspend fun identifyLight(args: JsonObject): JsonObject {
        val q = args.str("light") ?: throw IllegalArgumentException("light is required")
        val res = matchLight(q, args.str("room"))
        val light = (res as? MatchResult.Found)?.item ?: return matchFail(res, "light", q) { it.name }
        repo.identifyLight(light.id)
        return ok("${light.name} is blinking")
    }

    private suspend fun setCameraMotionDetection(args: JsonObject): JsonObject {
        val q = args.str("camera") ?: throw IllegalArgumentException("camera is required")
        val enabled = args.bool("enabled") ?: throw IllegalArgumentException("enabled is required")
        val res = NameMatcher.match(q, snap.cameras, { it.name }, { it.deviceId })
        val cam = (res as? MatchResult.Found)?.item ?: return matchFail(res, "camera", q) { it.name }
        val motionId = cam.motionId ?: return err("unsupported", "${cam.name} has no motion detection service")
        repo.setMotionEnabled(motionId, enabled, cam.motionType ?: "camera_motion")
        return ok("Motion detection ${if (enabled) "enabled" else "paused"} on ${cam.name}")
    }

    private fun sensorReadings(): JsonObject = buildJsonObject {
        put("ok", true)
        put("cameras", buildJsonArray {
            for (c in snap.cameras) {
                add(buildJsonObject {
                    put("device", c.name); put("model", JsonPrimitive(c.modelId)); put("kind", if (c.isFloodlightCamera) "floodlight" else "battery")
                    put("motion", c.motion ?: false); put("motion_detection_enabled", c.motionEnabled ?: true); put("last_motion_update", JsonPrimitive(c.motionUpdated))
                    put("lux", c.lux?.let { JsonPrimitive(it.roundToInt()) } ?: JsonNull); put("battery", c.batteryLevel?.let { JsonPrimitive(it) } ?: JsonNull)
                    put("connectivity", JsonPrimitive(c.connectivity)); put("floodlight", c.floodlightLightId?.let { id -> JsonPrimitive(snap.light(id)?.name) } ?: JsonNull)
                    put("note", "Live video is not available through the bridge API; only the Philips Hue app can show the stream.")
                })
            }
        })
        put("sensors", buildJsonArray {
            for (a in snap.accessories) {
                if (a.motionId != null) add(buildJsonObject { put("device", a.name); put("type", if (a.isCamera) "camera_motion" else "motion"); put("value", a.motion ?: false); put("unit", "boolean"); put("updated", JsonPrimitive(a.motionUpdated)) })
                a.temperatureC?.let { add(buildJsonObject { put("device", a.name); put("type", "temperature"); put("value", (it * 10).roundToInt() / 10.0); put("unit", "°C"); put("updated", JsonPrimitive(a.temperatureUpdated)) }) }
                a.lux?.let { add(buildJsonObject { put("device", a.name); put("type", "light_level"); put("value", it.roundToInt()); put("unit", "lux"); put("updated", JsonPrimitive(a.lightLevelUpdated)) }) }
                a.batteryLevel?.let { add(buildJsonObject { put("device", a.name); put("type", "battery"); put("value", it); put("unit", "%"); put("updated", JsonNull) }) }
                for (b in a.buttons) {
                    add(buildJsonObject {
                        put("device", a.name + (b.controlId?.let { " button $it" } ?: ""))
                        put("type", "button"); put("value", JsonPrimitive(b.lastEvent)); put("unit", "event"); put("updated", JsonPrimitive(b.updated))
                    })
                }
            }
        })
    }

    private suspend fun listSchedules(): JsonObject {
        val client = repo.client.value ?: return err("not_connected", "The bridge is not connected")
        val schedules = client.listSchedules()
        return buildJsonObject {
            put("ok", true)
            put("schedules", buildJsonArray {
                for ((id, s) in schedules) {
                    add(buildJsonObject {
                        put("id", id); put("name", s.name ?: ""); put("description", s.description ?: "")
                        put("localtime", s.localtime ?: s.time ?: ""); put("when", ScheduleBuilder.describe(s.localtime ?: s.time))
                        put("status", s.status ?: ""); put("address", s.command?.address ?: "")
                        put("body", s.command?.body ?: JsonObject(emptyMap()))
                    })
                }
            })
            put("count", schedules.size)
        }
    }

    private suspend fun createSchedule(args: JsonObject): JsonObject {
        val client = repo.client.value ?: return err("not_connected", "The bridge is not connected")
        val appKey = client.connection.appKey ?: return err("not_connected", "The bridge is not paired")
        val time = args.str("time") ?: throw IllegalArgumentException("time is required")
        val targetQ = args.str("target") ?: throw IllegalArgumentException("target is required")
        val days = (args["days"] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.content }
        val localtime = ScheduleBuilder.localtime(time, days, args.str("once_date"))

        val on = args.bool("on")
        val brightness = args.num("brightness")
        val sceneQ = args.str("scene")

        // Resolve target: group first, then light.
        var address: String? = null
        var targetName = ""
        var groupForScene: GroupUi? = null
        when (val g = matchGroup(targetQ)) {
            is MatchResult.Found -> {
                val v1 = ScheduleBuilder.v1Id(g.item.idV1) ?: return err("unsupported", "${g.item.name} has no v1 group id; the bridge cannot schedule it")
                address = "/api/$appKey/groups/$v1/action"; targetName = g.item.name; groupForScene = g.item
            }
            is MatchResult.Ambiguous -> return matchFail(g, "room", targetQ) { it.name }
            is MatchResult.NotFound -> when (val l = matchLight(targetQ, null)) {
                is MatchResult.Found -> {
                    val v1 = ScheduleBuilder.v1Id(l.item.idV1) ?: return err("unsupported", "${l.item.name} has no v1 id")
                    address = "/api/$appKey/lights/$v1/state"; targetName = l.item.name
                }
                is MatchResult.Ambiguous -> return matchFail(l, "light", targetQ) { it.name }
                is MatchResult.NotFound -> return err("not_found", "No room or light named \"$targetQ\"", buildJsonObject { put("available", namesArray(snap.groups.map { it.name } + snap.lights.map { it.name })) })
            }
        }

        var sceneV1: String? = null
        if (sceneQ != null) {
            val sres = matchScene(sceneQ, groupForScene?.name)
            val scene = (sres as? MatchResult.Found)?.item ?: return matchFail(sres, "scene", sceneQ) { "${it.name} (${it.groupName})" }
            sceneV1 = ScheduleBuilder.v1Id(scene.idV1) ?: return err("unsupported", "Scene ${scene.name} has no v1 id")
        }
        if (on == null && brightness == null && sceneV1 == null) return err("invalid_argument", "Nothing to do: give on, brightness or scene")
        val body = buildJsonObject {
            sceneV1?.let { put("scene", it) }
            put("on", on ?: true)
            if (brightness != null) put("bri", ScheduleBuilder.percentToBri(brightness))
        }

        val name = args.str("name") ?: "Hue Pilot ${ScheduleBuilder.describe(localtime)}"
        val schedule = buildJsonObject {
            put("name", name.take(32))
            put("description", "Created by Hue Pilot")
            putJsonObject("command") { put("address", address!!); put("method", "PUT"); put("body", body) }
            put("localtime", localtime)
            put("status", "enabled")
        }
        val id = client.createSchedule(schedule)
        return ok("Schedule \"$name\" created for $targetName (${ScheduleBuilder.describe(localtime)})", buildJsonObject {
            put("id", id); put("name", name); put("localtime", localtime); put("target", targetName); put("body", body)
        })
    }

    private suspend fun deleteSchedule(args: JsonObject): JsonObject {
        val client = repo.client.value ?: return err("not_connected", "The bridge is not connected")
        val id = args.str("id") ?: throw IllegalArgumentException("id is required")
        client.deleteSchedule(id)
        return ok("Schedule $id deleted", buildJsonObject { put("id", id) })
    }

    // ------------------------------------------------------------------ motion automations

    private fun motionSources(): List<AccessoryUi> = snap.accessories.filter { it.motionId != null && !it.isBridge }

    /** Words that name the kind of device rather than the device: ignored when matching a sensor or camera. */
    private val genericSourceWords = setOf("sensor", "sensors", "camera", "cameras", "cam", "motion", "detector", "hue", "secure", "camara", "sensores", "movimento")

    /**
     * Sensors and cameras are matched more strictly than rooms: one shared word ("garage sensor" vs
     * "Office motion sensor") is not a match, because the caller may be about to delete a rule.
     */
    private fun resolveMotionSource(q: String): MatchResult<AccessoryUi> {
        val sources = motionSources()
        fun norm(s: String) = s.trim().lowercase().replace(Regex("[^a-z0-9]+"), " ").trim()
        fun strong(query: String, item: AccessoryUi): Boolean {
            val n = norm(item.name)
            val qq = norm(query)
            if (qq.isEmpty()) return false
            if (n == qq || n.startsWith(qq) || n.contains(qq) || item.deviceId == query.trim()) return true
            val qw = qq.split(" ").filter { it.isNotBlank() }
            val nw = n.split(" ").filter { it.isNotBlank() }
            return qw.isNotEmpty() && qw.all { it in nw }
        }
        fun attempt(query: String): MatchResult<AccessoryUi>? {
            if (query.isBlank()) return null
            return when (val r = NameMatcher.match(query, sources, { it.name }, { it.deviceId })) {
                is MatchResult.Found -> if (strong(query, r.item)) r else null
                is MatchResult.Ambiguous -> if (r.candidates.all { strong(query, it) }) r else null
                is MatchResult.NotFound -> null
            }
        }
        val stripped = norm(q).split(" ").filter { it.isNotBlank() && it !in genericSourceWords }.joinToString(" ")
        return attempt(stripped) ?: attempt(q) ?: MatchResult.NotFound(sources)
    }

    private fun JsonObject.present(key: String): Boolean = when (val v = this[key]) {
        null, is JsonNull -> false
        is JsonPrimitive -> v.content.isNotBlank() && v.content != "null"
        is JsonArray -> v.isNotEmpty()
        else -> true
    }

    private fun actLabel(kind: String, sceneId: String?): String = if (kind == "scene") "scene \"${sceneId?.let { snap.scene(it)?.name } ?: "scene"}\"" else kind

    private fun automationJson(a: MotionAutomationUi): JsonObject = buildJsonObject {
        put("id", a.id); put("name", a.name); put("sensor", a.sourceName); put("kind", a.sourceKind); put("enabled", a.enabled); put("status", JsonPrimitive(a.status))
        put("rooms", namesArray(a.whereNames)); put("only_when_dark", a.onlyWhenDark)
        put("slots", buildJsonArray {
            for (s in a.slots) add(buildJsonObject {
                put("from", s.start); put("on_motion", actLabel(s.onMotion, s.onMotionSceneId)); put("off_after_minutes", s.noMotionAfterMinutes)
                put("on_no_motion", actLabel(s.onNoMotion, s.onNoMotionSceneId)); put("do_not_disturb", s.doNotDisturb)
            })
        })
        put("summary", a.summary)
    }

    private fun listMotionAutomations(): JsonObject = buildJsonObject {
        put("ok", true)
        put("automations", buildJsonArray { for (a in snap.motionAutomations) add(automationJson(a)) })
        put("sensors_without_automation", namesArray(motionSources().filter { src -> snap.motionAutomations.none { it.sourceDeviceId == src.deviceId } }.map { it.name }))
    }

    private fun parseAction(raw: String?, group: GroupUi, fallback: MotionAutomations.Action, allowOff: Boolean): Pair<MotionAutomations.Action?, JsonObject?> {
        val q = raw?.trim().orEmpty()
        if (q.isEmpty()) return fallback to null
        val lc = q.lowercase()
        if (lc in setOf("nothing", "none", "no", "do nothing", "keep", "leave", "nada")) return MotionAutomations.Action.Nothing to null
        if (allowOff && lc in setOf("off", "all off", "turn off", "lights off", "desligar", "apagar")) return MotionAutomations.Action.Off to null
        val roomScenes = snap.scenesFor(group.id)
        if (lc in setOf("on", "true", "turn on", "lights on", "bright", "ligar", "acender")) {
            val preferred = listOf("bright", "concentrate", "energize", "read", "normal", "relax")
            val pick = preferred.firstNotNullOfOrNull { p -> roomScenes.firstOrNull { it.name.equals(p, ignoreCase = true) } } ?: roomScenes.firstOrNull()
                ?: return null to err("not_found", "${group.name} has no scenes; the bridge turns lights on by recalling a scene. Create one first (e.g. save the current state as \"Bright\").")
            return MotionAutomations.Action.Scene(pick.id) to null
        }
        val res = matchScene(q, group.name)
        val scene = (res as? MatchResult.Found)?.item ?: return null to matchFail(res, "scene", q) { "${it.name} (${it.groupName})" }
        if (scene.groupId != group.id) return null to err("invalid_argument", "Scene \"${scene.name}\" belongs to ${scene.groupName}, not ${group.name}. Pick a scene of ${group.name}: ${roomScenes.joinToString(", ") { it.name }.ifEmpty { "none" }}.")
        return MotionAutomations.Action.Scene(scene.id) to null
    }

    private fun fromUi(kind: String, sceneId: String?): MotionAutomations.Action = when {
        kind == "scene" && sceneId != null -> MotionAutomations.Action.Scene(sceneId)
        kind == "off" -> MotionAutomations.Action.Off
        else -> MotionAutomations.Action.Nothing
    }

    private suspend fun setMotionAutomation(args: JsonObject): JsonObject {
        val q = args.str("sensor") ?: throw IllegalArgumentException("sensor is required")
        val res = resolveMotionSource(q)
        val source = (res as? MatchResult.Found)?.item ?: return matchFail(res, "motion sensor or camera", q) { "${it.name} (${it.kind})" }
        val motionId = source.motionId ?: return err("unsupported", "${source.name} has no motion service")
        val existing = snap.motionAutomations.firstOrNull { it.sourceDeviceId == source.deviceId }
        val enabledArg = args.bool("enabled")
        val onlyEnable = enabledArg != null && listOf("room", "on_motion", "off_after_minutes", "on_no_motion", "from", "until", "only_when_dark", "do_not_disturb", "slots").none { args.present(it) }
        if (onlyEnable && existing != null) {
            // The bridge refuses an enabled-only PUT ("The instance doesn't support triggers"): send the rule back with it.
            repo.updateBehaviorInstance(existing.id, buildJsonObject { put("enabled", enabledArg); putJsonObject("metadata") { put("name", existing.name) }; put("configuration", existing.configuration) })
            return ok("${existing.sourceName}: motion automation ${if (enabledArg) "resumed" else "paused"} (${existing.summary})", buildJsonObject { put("id", existing.id) })
        }

        var where: List<Pair<String, String>> = existing?.let { it.whereIds.zip(it.whereKinds) } ?: emptyList()
        args.str("room")?.let { roomQ ->
            val g = matchGroup(roomQ)
            val group = (g as? MatchResult.Found)?.item ?: return matchFail(g, "room", roomQ) { it.name }
            where = listOf(group.id to group.kind.rtype)
        }
        if (where.isEmpty()) return err("invalid_argument", "Which room or zone should ${source.name} control? Pass room.")
        val group = snap.group(where[0].first) ?: return err("not_found", "The room of this automation no longer exists; pass room.")

        val defaultAfter = args.num("off_after_minutes")?.roundToInt() ?: existing?.slots?.firstOrNull()?.noMotionAfterMinutes ?: 5
        val dnd = args.bool("do_not_disturb") ?: existing?.slots?.any { it.doNotDisturb } ?: false
        val slots = ArrayList<MotionAutomations.Slot>()
        val rawSlots = args["slots"] as? JsonArray
        try {
            if (rawSlots != null && rawSlots.isNotEmpty()) {
                for (r in rawSlots) {
                    val o = r as? JsonObject ?: continue
                    val (onM, e1) = parseAction(o.str("on_motion"), group, MotionAutomations.Action.Nothing, false)
                    if (onM == null) return e1!!
                    val (onN, e2) = parseAction(o.str("on_no_motion"), group, MotionAutomations.Action.Off, true)
                    if (onN == null) return e2!!
                    slots.add(MotionAutomations.Slot(MotionAutomations.parseTime(o.str("from")), onM, o.num("off_after_minutes")?.roundToInt() ?: defaultAfter, onN, dnd))
                }
            } else {
                val first = existing?.slots?.firstOrNull()
                val (onM, e1) = parseAction(args.str("on_motion"), group, first?.let { fromUi(it.onMotion, it.onMotionSceneId) } ?: MotionAutomations.Action.Nothing, false)
                if (onM == null) return e1!!
                val (onN, e2) = parseAction(args.str("on_no_motion"), group, first?.let { fromUi(it.onNoMotion, it.onNoMotionSceneId) } ?: MotionAutomations.Action.Off, true)
                if (onN == null) return e2!!
                if (onM is MotionAutomations.Action.Nothing && onN is MotionAutomations.Action.Nothing) return err("invalid_argument", "Say what motion should do: a scene for on_motion and/or \"off\" for on_no_motion.")
                val from = args.str("from")?.let { MotionAutomations.parseTime(it) } ?: MotionAutomations.Time(0, 0)
                slots.add(MotionAutomations.Slot(from, onM, defaultAfter, onN, dnd))
                args.str("until")?.let { slots.add(MotionAutomations.Slot(MotionAutomations.parseTime(it), MotionAutomations.Action.Nothing, defaultAfter, MotionAutomations.Action.Nothing, dnd)) }
            }
        } catch (e: IllegalArgumentException) {
            return err("invalid_argument", e.message ?: "invalid time")
        }
        if (slots.map { it.start.minutes }.toSet().size != slots.size) return err("invalid_argument", "from and until must be different times.")

        val onlyWhenDark = args.bool("only_when_dark") ?: existing?.onlyWhenDark ?: false
        val motionType = source.motionType ?: if (source.isCamera) "camera_motion" else "motion"
        val spec = MotionAutomations.Spec(source.deviceId, motionId, motionType, where, onlyWhenDark, slots)
        val name = args.str("name") ?: existing?.name ?: source.name
        val enabled = enabledArg ?: existing?.enabled ?: true
        val id = if (existing != null) {
            repo.updateBehaviorInstance(existing.id, MotionAutomations.instanceBody(spec, name, enabled, if (onlyWhenDark) existing.lightLevel else null, forUpdate = true))
            existing.id
        } else repo.createBehaviorInstance(MotionAutomations.instanceBody(spec, name, enabled))
        val summary = MotionAutomations.describe(slots, onlyWhenDark) { sid -> snap.scene(sid)?.name ?: "scene" }
        val roomNames = where.map { snap.group(it.first)?.name ?: "room" }
        return ok("${source.name} → ${roomNames.joinToString(", ")}: $summary${if (enabled) "" else " (paused)"}", buildJsonObject {
            put("id", id); put("sensor", source.name); put("rooms", namesArray(roomNames)); put("enabled", enabled); put("only_when_dark", onlyWhenDark); put("summary", summary)
        })
    }

    private suspend fun deleteMotionAutomation(args: JsonObject): JsonObject {
        val q = args.str("sensor") ?: args.str("id") ?: throw IllegalArgumentException("sensor is required")
        var auto = snap.motionAutomations.firstOrNull { it.id == q }
        if (auto == null) {
            val res = resolveMotionSource(q)
            val source = (res as? MatchResult.Found)?.item ?: return matchFail(res, "motion sensor or camera", q) { "${it.name} (${it.kind})" }
            auto = snap.motionAutomations.firstOrNull { it.sourceDeviceId == source.deviceId } ?: return err("not_found", "${source.name} has no motion automation.")
        }
        repo.deleteBehaviorInstance(auto.id)
        return ok("Removed the motion automation of ${auto.sourceName}; motion no longer changes the lights.", buildJsonObject { put("id", auto.id) })
    }

    private suspend fun setMotionSensing(args: JsonObject): JsonObject {
        val q = args.str("sensor") ?: throw IllegalArgumentException("sensor is required")
        val enabled = args.bool("enabled") ?: throw IllegalArgumentException("enabled is required")
        val res = resolveMotionSource(q)
        val source = (res as? MatchResult.Found)?.item ?: return matchFail(res, "motion sensor or camera", q) { "${it.name} (${it.kind})" }
        val motionId = source.motionId ?: return err("unsupported", "${source.name} has no motion service")
        repo.setMotionEnabled(motionId, enabled, source.motionType ?: if (source.isCamera) "camera_motion" else "motion")
        return ok("${source.name}: motion sensing ${if (enabled) "on" else "off"}", buildJsonObject { put("sensor", source.name); put("kind", source.kind); put("enabled", enabled) })
    }

    // ------------------------------------------------------------------ system prompt

    /** Describes the home for the system instruction. */
    fun homeDescription(): String {
        val s = snap
        if (s.isEmpty) return "The bridge is not connected right now."
        val sb = StringBuilder()
        for (g in s.groups) {
            sb.append("- ${g.kind.rtype} \"${g.name}\": ${if (g.on) "on" else "off"}, ${g.brightness.roundToInt()}%")
            if (g.lights.isNotEmpty()) sb.append("; lights: ").append(g.lights.joinToString(", ") { "${it.name} (${if (it.on) "on ${it.brightness.roundToInt()}%" else "off"})" })
            val scenes = s.scenesFor(g.id)
            if (scenes.isNotEmpty()) sb.append("; scenes: ").append(scenes.joinToString(", ") { it.name })
            sb.append('\n')
        }
        if (s.lightsWithoutRoom.isNotEmpty()) sb.append("- lights without room: ").append(s.lightsWithoutRoom.joinToString(", ") { it.name }).append('\n')
        val sensors = s.accessories.filter { !it.isBridge && !it.isCamera }
        if (sensors.isNotEmpty()) sb.append("- accessories: ").append(sensors.joinToString(", ") { "${it.name} (${it.kind})" }).append('\n')
        if (s.motionAutomations.isNotEmpty()) {
            sb.append("- motion automations (bridge rules; change them with set_motion_automation): ")
                .append(s.motionAutomations.joinToString("; ") { a -> "${a.sourceName} → ${a.whereNames.joinToString(", ")}: ${a.summary}${if (a.enabled) "" else " (paused)"}" })
                .append('\n')
        }
        if (s.cameras.isNotEmpty()) {
            sb.append("- cameras (Hue Secure; motion/light/battery only, no video through the bridge): ")
                .append(s.cameras.joinToString(", ") { c -> "${c.name} (${if (c.motion == true) "motion detected" else "clear"}${if (c.motionEnabled == false) ", detection paused" else ""}${c.batteryLevel?.let { ", battery $it%" } ?: ""})" })
                .append('\n')
        }
        return sb.toString()
    }

    companion object {
        fun JsonElement?.asStringOrNull(): String? = (this as? JsonPrimitive)?.content

        /** True for bridge/exception failures (not for semantic answers such as ambiguous / not_found). */
        fun isBridgeFailure(result: JsonObject): Boolean {
            if (result["ok"]?.jsonPrimitive?.content == "true") return false
            return result["error"]?.jsonPrimitive?.content in setOf("bridge_error", "not_connected", "error")
        }
    }
}
