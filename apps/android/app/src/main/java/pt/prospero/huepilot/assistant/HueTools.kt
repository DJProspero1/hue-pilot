package pt.prospero.huepilot.assistant

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
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
import pt.prospero.huepilot.data.hue.HueClient
import pt.prospero.huepilot.data.hue.RoutineUi
import pt.prospero.huepilot.domain.Routines

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
        add(decl("set_motion_automation", "Create or replace the automation of a motion sensor or camera (runs on the bridge, app closed or not). Simple form: on_motion (a scene of that room, e.g. \"Bright\", or \"nothing\"), off_after_minutes, optional from/until clock window (outside it the sensor does nothing), darkness. For different day/night behaviour pass slots. Changing an existing rule keeps everything not mentioned (its time slots, rooms, darkness); a new on_motion scene goes to the slots that already recall a scene. To only pause/resume pass just sensor and enabled. When the user does not say, ask whether it should work only when dark.",
            mapOf(
                "sensor" to str("Motion sensor or camera name."),
                "room" to str("Room or zone whose lights it controls. Defaults to the existing automation's rooms."),
                "rooms" to buildJsonObject { put("type", "array"); put("description", "Several rooms/zones to control at once (replaces room)."); putJsonObject("items") { put("type", "string") } },
                "darkness" to enumOf("When the rule may act: \"any\" time; \"sunset_to_sunrise\" by the sun (with offsets); \"sensor\" when the sensor's own light reading is below dark_threshold_lux (the \"daylight sensitivity\" of the Hue app).", listOf("any", "sunset_to_sunrise", "sensor")),
                "sunset_offset_minutes" to num("sunset_to_sunrise: start this many minutes after sunset (negative = before, default -30)."),
                "sunrise_offset_minutes" to num("sunset_to_sunrise: stop this many minutes after sunrise (negative = before, default 30)."),
                "dark_threshold_lux" to num("sensor: counts as dark below this many lux (default about 5)."),
                "on_motion" to str("Scene name to activate when motion starts (must belong to the room), \"on\" for the room's brightest scene, or \"nothing\"."),
                "off_after_minutes" to num("Minutes without motion before on_no_motion happens (default 5)."),
                "on_no_motion" to str("\"off\" (default), \"nothing\", or a scene name."),
                "from" to str("Start of the active window, HH:MM. Omit for all day."),
                "until" to str("End of the active window, HH:MM."),
                "only_when_dark" to bool("Shortcut: true = keep/enable a darkness condition (sunset to sunrise unless one is set), false = any time."),
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
        add(decl("set_sensor_settings", "Settings of a motion sensor or Hue Secure camera: motion sensing on/off, motion sensitivity, name, and the room it belongs to.",
            mapOf(
                "sensor" to str("Motion sensor or camera name."),
                "enabled" to bool("Motion sensing on/off."),
                "sensitivity" to str("\"low\", \"medium\", \"high\", or a number from 0 to the sensor's maximum (see get_sensor_readings). Motion sensors only."),
                "name" to str("New name."),
                "room" to str("Room to move the device into."),
            ), listOf("sensor")))
        add(decl("rename", "Rename a light, room, zone, scene, motion sensor or camera.",
            mapOf(
                "what" to enumOf("What to rename.", listOf("light", "room", "zone", "scene", "sensor", "camera")),
                "name" to str("Current name."),
                "new_name" to str("New name (max 32 characters)."),
                "room" to str("For scenes and lights: the room, to disambiguate."),
            ), listOf("what", "name", "new_name")))
        add(decl("set_light_power_on_behavior", "What a light does when power returns (wall switch / power cut): \"default\" warm white at full brightness, \"power_loss\" (last state after a power cut only, off after a switch), \"last_state\", or \"custom\" with brightness and colour.",
            mapOf(
                "target" to str("Light name, or a room/zone name for all its lights."),
                "mode" to enumOf("Power-on mode.", listOf("default", "power_loss", "last_state", "custom")),
                "brightness" to num("custom: brightness 1-100."),
                "color" to str("custom: colour name or hex."),
                "color_temperature" to str("custom: warm/cool/neutral or Kelvin."),
            ), listOf("target", "mode")))
        add(decl("create_group", "Create a room (a light belongs to one room) or a zone (any lights, across rooms).",
            mapOf(
                "kind" to enumOf("room or zone.", listOf("room", "zone")),
                "name" to str("Name."),
                "lights" to buildJsonObject { put("type", "array"); put("description", "Light names to put in it."); putJsonObject("items") { put("type", "string") } },
                "icon" to str("Room type / icon: living_room, kitchen, dining, bedroom, kids_bedroom, bathroom, nursery, recreation, office, gym, hallway, toilet, front_door, garage, terrace, garden, driveway, carport, home, downstairs, upstairs, top_floor, attic, guest_room, staircase, lounge, man_cave, computer, studio, music, tv, reading, closet, storage, laundry_room, balcony, porch, barbecue, pool, other."),
            ), listOf("kind", "name")))
        add(decl("update_group", "Change a room or zone: rename it, change its icon, add or remove lights, or replace its lights.",
            mapOf(
                "group" to str("Room or zone name."),
                "new_name" to str("New name."),
                "icon" to str("Room type / icon (see create_group)."),
                "add_lights" to buildJsonObject { put("type", "array"); putJsonObject("items") { put("type", "string") } },
                "remove_lights" to buildJsonObject { put("type", "array"); putJsonObject("items") { put("type", "string") } },
                "lights" to buildJsonObject { put("type", "array"); put("description", "Replace the whole light list."); putJsonObject("items") { put("type", "string") } },
            ), listOf("group")))
        add(decl("delete_group", "Delete a room or zone (its lights are kept; a room's lights become unassigned).", mapOf("group" to str("Room or zone name.")), listOf("group")))
        add(decl("create_scene", "Save a scene for a room or zone: by default the current look of its lights; optionally give per-light states.",
            mapOf(
                "name" to str("Scene name."),
                "room" to str("Room or zone."),
                "lights" to lightStatesSchema("Optional per-light states; lights not listed keep their current state."),
                "speed" to num("Dynamic mode speed 0-1."),
                "auto_dynamic" to bool("Start in dynamic mode when activated."),
            ), listOf("name", "room")))
        add(decl("update_scene", "Change a scene: rename, dynamic speed, auto-dynamic, change some lights' states, or re-capture the room's current look.",
            mapOf(
                "scene" to str("Scene name."),
                "room" to str("The scene's room, to disambiguate."),
                "new_name" to str("New name."),
                "speed" to num("Dynamic mode speed 0-1."),
                "auto_dynamic" to bool("Start in dynamic mode when activated."),
                "lights" to lightStatesSchema("Per-light states to change."),
                "from_current_state" to bool("Replace all light states with the current look."),
            ), listOf("scene")))
        add(decl("delete_scene", "Delete a scene.", mapOf("scene" to str("Scene name."), "room" to str("Room, to disambiguate.")), listOf("scene")))
        add(decl("list_routines", "List wake-up and go-to-sleep routines (and other automations the Hue app manages, e.g. coming/leaving home).", emptyMap(), emptyList()))
        add(decl("set_wake_up", "Create or change a wake-up routine: a sunrise that brightens the room over some minutes up to a brightness at a time on chosen days, optionally switching off later. Updates the routine with the same name, or the only one for those rooms.",
            mapOf(
                "rooms" to buildJsonObject { put("type", "array"); put("description", "Rooms/zones."); putJsonObject("items") { put("type", "string") } },
                "time" to str("Alarm time HH:MM (the sunrise ends then)."),
                "days" to buildJsonObject { put("type", "array"); put("description", "mon..sun, weekdays, weekends; omit = every day."); putJsonObject("items") { put("type", "string") } },
                "fade_minutes" to num("Sunrise length (default 30)."),
                "end_brightness" to num("1-100 (default 100)."),
                "turn_off_after_minutes" to num("Switch off this many minutes after the alarm; 0 = stay on."),
                "enabled" to bool("false pauses it."),
                "name" to str("Routine name."),
            ), listOf("rooms", "time")))
        add(decl("set_go_to_sleep", "Create or change a go-to-sleep routine: the room dims over some minutes at a time on chosen days, ending in nightlight or off.",
            mapOf(
                "rooms" to buildJsonObject { put("type", "array"); put("description", "Rooms/zones."); putJsonObject("items") { put("type", "string") } },
                "time" to str("HH:MM when the fade starts."),
                "days" to buildJsonObject { put("type", "array"); putJsonObject("items") { put("type", "string") } },
                "fade_minutes" to num("Default 30."),
                "end" to enumOf("Default nightlight.", listOf("nightlight", "off")),
                "enabled" to bool("false pauses it."),
                "name" to str("Routine name."),
            ), listOf("rooms", "time")))
        add(decl("delete_routine", "Delete a wake-up / go-to-sleep routine by name or id (see list_routines).", mapOf("routine" to str("Routine name or id.")), listOf("routine")))
    }

    private fun lightStatesSchema(description: String): JsonObject = buildJsonObject {
        put("type", "array")
        put("description", description)
        putJsonObject("items") {
            put("type", "object")
            putJsonObject("properties") {
                put("light", str("Light name.")); put("on", bool("On/off.")); put("brightness", num("1-100.")); put("color", str("Colour name or hex.")); put("color_temperature", str("warm/cool/neutral or Kelvin."))
            }
            putJsonArray("required") { add(JsonPrimitive("light")) }
        }
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
            "set_sensor_settings" -> setSensorSettings(args)
            "rename" -> renameThing(args)
            "set_light_power_on_behavior" -> setPowerOn(args)
            "create_group" -> createGroup(args)
            "update_group" -> updateGroup(args)
            "delete_group" -> deleteGroup(args)
            "create_scene" -> createScene(args)
            "update_scene" -> updateScene(args)
            "delete_scene" -> deleteScene(args)
            "list_routines" -> listRoutines()
            "set_wake_up" -> setRoutine("wake_up", args)
            "set_go_to_sleep" -> setRoutine("go_to_sleep", args)
            "delete_routine" -> deleteRoutine(args)
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
                "list_routines" -> "Listed routines"
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
                if (a.motionId != null) add(buildJsonObject {
                    put("device", a.name); put("type", if (a.isCamera) "camera_motion" else "motion"); put("value", a.motion ?: false); put("unit", "boolean"); put("updated", JsonPrimitive(a.motionUpdated))
                    put("enabled", a.motionEnabled ?: true); put("sensitivity", a.motionSensitivity?.let { JsonPrimitive(it) } ?: JsonNull); put("sensitivity_max", a.motionSensitivityMax?.let { JsonPrimitive(it) } ?: JsonNull); put("room", JsonPrimitive(a.roomName))
                })
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
        put("rooms", namesArray(a.whereNames)); put("only_when_dark", a.onlyWhenDark); put("darkness", a.darkness); put("darkness_details", a.darknessDetails)
        (a.darknessSpec as? MotionAutomations.Darkness.SunsetToSunrise)?.let { put("sunset_offset_minutes", it.sunsetOffsetMinutes); put("sunrise_offset_minutes", it.sunriseOffsetMinutes) }
        (a.darknessSpec as? MotionAutomations.Darkness.Sensor)?.let { put("dark_threshold_lux", (MotionAutomations.lightLevelToLux(it.darkThreshold) * 10).roundToInt() / 10.0) }
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
        val onlyEnable = enabledArg != null && listOf("room", "rooms", "on_motion", "off_after_minutes", "on_no_motion", "from", "until", "only_when_dark", "darkness", "sunset_offset_minutes", "sunrise_offset_minutes", "dark_threshold_lux", "do_not_disturb", "slots", "name").none { args.present(it) }
        if (onlyEnable && existing != null) {
            // The bridge refuses an enabled-only PUT ("The instance doesn't support triggers"): send the rule back with it.
            repo.updateBehaviorInstance(existing.id, buildJsonObject { put("enabled", enabledArg); putJsonObject("metadata") { put("name", existing.name) }; put("configuration", existing.configuration) })
            return ok("${existing.sourceName}: motion automation ${if (enabledArg) "resumed" else "paused"} (${existing.summary})", buildJsonObject { put("id", existing.id) })
        }

        var where: List<Pair<String, String>> = existing?.let { it.whereIds.zip(it.whereKinds) } ?: emptyList()
        if (args.present("rooms") || args.present("room")) {
            val (resolved, e) = resolveRooms(args)
            if (resolved == null) return e!!
            where = resolved
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
            } else if (existing != null && !args.present("from") && !args.present("until")) {
                // Keep the existing time slots; apply what was mentioned. A scene for on_motion goes to the
                // slots that already recall a scene (the "do nothing by day" slots are left alone).
                val onM = args.str("on_motion")?.let { q -> val (a, e) = parseAction(q, group, MotionAutomations.Action.Nothing, false); if (a == null) return e!!; a }
                val onN = args.str("on_no_motion")?.let { q -> val (a, e) = parseAction(q, group, MotionAutomations.Action.Off, true); if (a == null) return e!!; a }
                val after = args.num("off_after_minutes")?.roundToInt()
                val sceneSlots = existing.slots.filter { it.onMotion == "scene" }
                val targets = (if (sceneSlots.isNotEmpty()) sceneSlots else listOfNotNull(existing.slots.lastOrNull())).toSet()
                for (sl in existing.slots) {
                    slots.add(MotionAutomations.Slot(
                        MotionAutomations.parseTime(sl.start),
                        if (onM != null && (sl in targets || existing.slots.size == 1)) onM else fromUi(sl.onMotion, sl.onMotionSceneId),
                        after ?: sl.noMotionAfterMinutes,
                        onN ?: fromUi(sl.onNoMotion, sl.onNoMotionSceneId),
                        args.bool("do_not_disturb") ?: sl.doNotDisturb,
                    ))
                }
                if (slots.isEmpty()) return err("invalid_argument", "Say what motion should do: a scene for on_motion and/or \"off\" for on_no_motion.")
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

        val (darkness, darkErr) = darknessFromArgs(args, existing?.darknessSpec ?: MotionAutomations.Darkness.AnyTime, source)
        if (darkness == null) return darkErr!!
        val onlyWhenDark = darkness !is MotionAutomations.Darkness.AnyTime
        val motionType = source.motionType ?: if (source.isCamera) "camera_motion" else "motion"
        val spec = MotionAutomations.Spec(source.deviceId, motionId, motionType, where, darkness, slots)
        val name = args.str("name") ?: existing?.name ?: source.name
        val enabled = enabledArg ?: existing?.enabled ?: true
        val id = if (existing != null) {
            repo.updateBehaviorInstance(existing.id, MotionAutomations.instanceBody(spec, name, enabled, forUpdate = true))
            existing.id
        } else repo.createBehaviorInstance(MotionAutomations.instanceBody(spec, name, enabled))
        val summary = MotionAutomations.describe(slots, darkness) { sid -> snap.scene(sid)?.name ?: "scene" }
        val roomNames = where.map { snap.group(it.first)?.name ?: "room" }
        return ok("${source.name} → ${roomNames.joinToString(", ")}: $summary${if (enabled) "" else " (paused)"}", buildJsonObject {
            put("id", id); put("sensor", source.name); put("rooms", namesArray(roomNames)); put("enabled", enabled); put("only_when_dark", onlyWhenDark); put("darkness", MotionAutomations.describeDarkness(darkness)); put("summary", summary)
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

    // ------------------------------------------------------------------ bridge helpers

    private fun bridge(): HueClient = repo.client.value ?: throw HueException("The bridge is not connected")

    private suspend fun putResource(type: String, id: String, body: JsonObject) {
        bridge().put(type, id, body)
        repo.refresh()
    }

    private suspend fun postResource(type: String, body: JsonObject): String {
        val refs = bridge().post(type, body)
        repo.refresh()
        return refs.firstOrNull()?.get("rid")?.jsonPrimitive?.content ?: ""
    }

    private suspend fun deleteResource(type: String, id: String) {
        bridge().delete(type, id)
        repo.refresh()
    }

    private fun strings(v: JsonElement?): List<String> = when (v) {
        is JsonArray -> v.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.filter { it.isNotBlank() }
        is JsonPrimitive -> v.contentOrNull?.takeIf { it.isNotBlank() }?.let { listOf(it) } ?: emptyList()
        else -> emptyList()
    }

    private fun resolveRooms(args: JsonObject, key: String = "rooms"): Pair<List<Pair<String, String>>?, JsonObject?> {
        val list = strings(args[key]).ifEmpty { strings(args["room"]) }
        val out = ArrayList<Pair<String, String>>()
        for (q in list) {
            val g = matchGroup(q)
            val group = (g as? MatchResult.Found)?.item ?: return null to matchFail(g, "room", q) { it.name }
            if (out.none { it.first == group.id }) out.add(group.id to group.kind.rtype)
        }
        return out to null
    }

    private fun darknessFromArgs(args: JsonObject, current: MotionAutomations.Darkness, source: AccessoryUi): Pair<MotionAutomations.Darkness?, JsonObject?> {
        val mode = args.str("darkness")?.trim()?.lowercase()?.replace(Regex("[\\s-]+"), "_") ?: ""
        val sunset = args.num("sunset_offset_minutes")
        val sunrise = args.num("sunrise_offset_minutes")
        val lux = args.num("dark_threshold_lux")
        val only = args.bool("only_when_dark")
        val wanted: String = when {
            mode.isNotEmpty() -> when {
                mode in setOf("any", "always", "none", "off", "never") -> "any"
                mode.contains("sun") || mode == "night" || mode == "dark" -> "sunset_to_sunrise"
                mode.contains("sensor") || mode.contains("daylight") || mode.contains("light_level") || mode.contains("lux") -> "sensor"
                else -> return null to err("invalid_argument", "darkness must be any, sunset_to_sunrise or sensor.")
            }
            lux != null -> "sensor"
            sunset != null || sunrise != null -> "sunset_to_sunrise"
            only == false -> "any"
            only == true -> if (current is MotionAutomations.Darkness.AnyTime) "sunset_to_sunrise" else current.mode
            else -> current.mode
        }
        return when (wanted) {
            "any" -> MotionAutomations.Darkness.AnyTime to null
            "sunset_to_sunrise" -> {
                val cur = current as? MotionAutomations.Darkness.SunsetToSunrise
                MotionAutomations.Darkness.SunsetToSunrise((sunset ?: cur?.sunsetOffsetMinutes?.toDouble() ?: -30.0).roundToInt(), (sunrise ?: cur?.sunriseOffsetMinutes?.toDouble() ?: 30.0).roundToInt()) to null
            }
            else -> {
                val cur = current as? MotionAutomations.Darkness.Sensor
                val serviceId = cur?.lightLevelServiceId ?: source.lightLevelId
                    ?: return null to err("unsupported", "${source.name} has no light-level sensor, so it cannot decide darkness itself. Use darkness \"sunset_to_sunrise\".")
                MotionAutomations.Darkness.Sensor(serviceId, cur?.lightLevelType ?: "light_level", lux?.let { MotionAutomations.luxToLightLevel(it) } ?: cur?.darkThreshold ?: MotionAutomations.DEFAULT_DARK_THRESHOLD, cur?.offset ?: MotionAutomations.DEFAULT_DARK_OFFSET) to null
            }
        }
    }

    // ------------------------------------------------------------------ routines

    private fun routineJson(r: RoutineUi): JsonObject = buildJsonObject {
        put("id", r.id); put("name", r.name); put("kind", r.kind); put("enabled", r.enabled); put("status", JsonPrimitive(r.status))
        put("rooms", namesArray(r.whereNames)); put("time", JsonPrimitive(r.time)); put("days", JsonPrimitive(r.days?.let { Routines.describeDays(it) }))
        put("fade_minutes", r.fadeMinutes?.let { JsonPrimitive(it) } ?: JsonNull); put("end_brightness", r.endBrightness?.let { JsonPrimitive(it) } ?: JsonNull)
        put("turn_off_after_minutes", r.turnOffAfterMinutes?.let { JsonPrimitive(it) } ?: JsonNull); put("end", JsonPrimitive(r.endState?.let { if (it == "turn_off") "off" else it }))
        put("summary", r.summary)
    }

    private fun listRoutines(): JsonObject = buildJsonObject {
        put("ok", true)
        put("routines", buildJsonArray { for (r in snap.routines) add(routineJson(r)) })
    }

    private fun resolveRoutine(q: String): MatchResult<RoutineUi> {
        snap.routines.firstOrNull { it.id == q.trim() }?.let { return MatchResult.Found(it) }
        val n = q.trim().lowercase()
        val hits = snap.routines.filter { r -> val rn = r.name.lowercase(); rn == n || rn.startsWith(n) || rn.contains(n) }
        return when (hits.size) { 0 -> MatchResult.NotFound(snap.routines); 1 -> MatchResult.Found(hits[0]); else -> MatchResult.Ambiguous(hits) }
    }

    private suspend fun setRoutine(kind: String, args: JsonObject): JsonObject {
        val (rooms, roomErr) = resolveRooms(args)
        if (rooms == null) return roomErr!!
        val sameKind = snap.routines.filter { it.kind == kind }
        var existing = args.str("name")?.let { n -> sameKind.firstOrNull { it.name.equals(n.trim(), ignoreCase = true) } }
        if (existing == null && rooms.isNotEmpty()) {
            val key = rooms.map { it.first }.sorted().joinToString(",")
            val hits = sameKind.filter { it.whereIds.sorted().joinToString(",") == key }
            if (hits.size == 1) existing = hits[0]
        }
        if (rooms.isEmpty() && existing == null) return err("invalid_argument", "rooms is required.")
        val time = try {
            args.str("time")?.let { MotionAutomations.parseTime(it) } ?: existing?.time?.let { MotionAutomations.parseTime(it) } ?: return err("invalid_argument", "time is required (HH:MM).")
        } catch (e: IllegalArgumentException) { return err("invalid_argument", e.message ?: "invalid time") }
        val days = try {
            if (args.present("days")) Routines.parseDays(strings(args["days"])) else existing?.days?.takeIf { it.isNotEmpty() } ?: Routines.parseDays(null)
        } catch (e: IllegalArgumentException) { return err("invalid_argument", e.message ?: "invalid days") }
        val endRaw = args.str("end")?.lowercase() ?: ""
        val turnOffArg = args.num("turn_off_after_minutes")
        val spec = Routines.Spec(
            kind = kind,
            where = if (rooms.isNotEmpty()) rooms else existing!!.whereIds.zip(existing.whereKinds),
            time = time,
            days = days,
            fadeMinutes = args.num("fade_minutes")?.roundToInt() ?: existing?.fadeMinutes ?: 30,
            endBrightness = if (kind == "wake_up") (args.num("end_brightness")?.roundToInt()?.coerceIn(1, 100) ?: existing?.endBrightness ?: 100) else null,
            turnOffAfterMinutes = if (kind == "wake_up") (if (turnOffArg != null) turnOffArg.roundToInt().takeIf { it > 0 } else existing?.turnOffAfterMinutes) else null,
            endState = if (kind == "go_to_sleep") (if (endRaw.isNotEmpty()) (if (endRaw.contains("off")) "turn_off" else "nightlight") else existing?.endState ?: "nightlight") else null,
        )
        val roomNames = spec.where.map { snap.group(it.first)?.name ?: "room" }
        val name = args.str("name") ?: existing?.name ?: (if (kind == "wake_up") "Wake up ${roomNames[0]}" else "Go to sleep ${roomNames[0]}")
        val enabled = args.bool("enabled") ?: existing?.enabled ?: true
        val id = if (existing != null) {
            repo.updateBehaviorInstance(existing.id, Routines.body(spec, name, enabled, forUpdate = true))
            existing.id
        } else repo.createBehaviorInstance(Routines.body(spec, name, enabled))
        return ok("$name → ${roomNames.joinToString(", ")}: ${Routines.describe(spec)}${if (enabled) "" else " (paused)"}", buildJsonObject {
            put("id", id); put("name", name); put("rooms", namesArray(roomNames)); put("summary", Routines.describe(spec)); put("enabled", enabled)
        })
    }

    private suspend fun deleteRoutine(args: JsonObject): JsonObject {
        val q = args.str("routine") ?: throw IllegalArgumentException("routine is required")
        val res = resolveRoutine(q)
        val r = (res as? MatchResult.Found)?.item ?: return matchFail(res, "routine", q) { "${it.name} (${it.kind})" }
        repo.deleteBehaviorInstance(r.id)
        return ok("Routine \"${r.name}\" deleted.", buildJsonObject { put("id", r.id) })
    }

    // ------------------------------------------------------------------ sensor settings, rename, power-on

    private fun sensitivityFromArgs(raw: String?, max: Int): Int? {
        val s = raw?.trim()?.lowercase() ?: return null
        if (s.isEmpty()) return null
        s.toDoubleOrNull()?.let { return it.roundToInt().coerceIn(0, max) }
        return when {
            s.startsWith("low") || s.startsWith("very low") || s.startsWith("min") -> 0
            s.startsWith("med") || s.startsWith("mid") || s.startsWith("normal") -> max / 2
            s.startsWith("high") || s.startsWith("very high") || s.startsWith("max") -> max
            else -> null
        }
    }

    private suspend fun setSensorSettings(args: JsonObject): JsonObject {
        val q = args.str("sensor") ?: throw IllegalArgumentException("sensor is required")
        val res = resolveMotionSource(q)
        val source = (res as? MatchResult.Found)?.item ?: return matchFail(res, "motion sensor or camera", q) { "${it.name} (${it.kind})" }
        val motionId = source.motionId ?: return err("unsupported", "${source.name} has no motion service")
        val done = ArrayList<String>()
        args.bool("enabled")?.let { enabled ->
            repo.setMotionEnabled(motionId, enabled, source.motionType ?: if (source.isCamera) "camera_motion" else "motion")
            done.add("motion sensing ${if (enabled) "on" else "off"}")
        }
        args.str("sensitivity")?.let { raw ->
            if (source.isCamera) return err("unsupported", "${source.name} has no sensitivity setting (cameras do not).")
            val max = source.motionSensitivityMax ?: 2
            val value = sensitivityFromArgs(raw, max) ?: return err("invalid_argument", "sensitivity must be low, medium, high or 0-$max.")
            putResource("motion", motionId, buildJsonObject { putJsonObject("sensitivity") { put("sensitivity", value) } })
            done.add("sensitivity $value/$max")
        }
        args.str("name")?.let { n ->
            repo.renameDevice(source.deviceId, n.trim().take(32))
            done.add("renamed to \"${n.trim().take(32)}\"")
        }
        args.str("room")?.let { roomQ ->
            val g = matchGroup(roomQ)
            val group = (g as? MatchResult.Found)?.item ?: return matchFail(g, "room", roomQ) { it.name }
            if (group.kind.rtype != "room") return err("invalid_argument", "Devices live in rooms, not zones.")
            val current = snap.rooms.firstOrNull { source.deviceId in it.deviceIds }
            if (current != null && current.id != group.id) putResource("room", current.id, buildJsonObject { putJsonArray("children") { for (d in current.deviceIds.filter { it != source.deviceId }) add(buildJsonObject { put("rid", d); put("rtype", "device") }) } })
            if (current == null || current.id != group.id) putResource("room", group.id, buildJsonObject { putJsonArray("children") { for (d in group.deviceIds + source.deviceId) add(buildJsonObject { put("rid", d); put("rtype", "device") }) } })
            done.add("moved to ${group.name}")
        }
        if (done.isEmpty()) return err("invalid_argument", "Give enabled, sensitivity, name or room.")
        return ok("${source.name}: ${done.joinToString(", ")}")
    }

    private suspend fun renameThing(args: JsonObject): JsonObject {
        val what = args.str("what")?.lowercase() ?: throw IllegalArgumentException("what is required")
        val newName = args.str("new_name")?.trim()?.take(32) ?: return err("invalid_argument", "new_name is required.")
        val name = args.str("name") ?: throw IllegalArgumentException("name is required")
        return when (what) {
            "light" -> {
                val res = matchLight(name, args.str("room"))
                val l = (res as? MatchResult.Found)?.item ?: return matchFail(res, "light", name) { it.name }
                repo.renameLight(l.id, newName)
                ok("Light \"${l.name}\" renamed to \"$newName\".")
            }
            "room", "zone" -> {
                val res = matchGroup(name)
                val g = (res as? MatchResult.Found)?.item ?: return matchFail(res, "room", name) { it.name }
                putResource(g.kind.rtype, g.id, buildJsonObject { putJsonObject("metadata") { put("name", newName) } })
                ok("${g.name} renamed to \"$newName\".")
            }
            "scene" -> {
                val res = matchScene(name, args.str("room"))
                val sc = (res as? MatchResult.Found)?.item ?: return matchFail(res, "scene", name) { "${it.name} (${it.groupName})" }
                repo.renameScene(sc.id, newName)
                ok("Scene \"${sc.name}\" renamed to \"$newName\".")
            }
            "sensor", "camera", "device" -> {
                val res = resolveMotionSource(name)
                val src = (res as? MatchResult.Found)?.item ?: return matchFail(res, "motion sensor or camera", name) { "${it.name} (${it.kind})" }
                repo.renameDevice(src.deviceId, newName)
                ok("${src.name} renamed to \"$newName\".")
            }
            else -> err("invalid_argument", "what must be light, room, zone, scene, sensor or camera.")
        }
    }

    private suspend fun setPowerOn(args: JsonObject): JsonObject {
        val target = args.str("target") ?: throw IllegalArgumentException("target is required")
        val lights: List<LightUi> = when (val g = matchGroup(target)) {
            is MatchResult.Found -> g.item.lights
            is MatchResult.Ambiguous -> return matchFail(g, "room", target) { it.name }
            is MatchResult.NotFound -> when (val l = matchLight(target, null)) {
                is MatchResult.Found -> listOf(l.item)
                else -> return matchFail(l, "light", target) { it.name }
            }
        }
        if (lights.isEmpty()) return err("not_found", "No lights in $target.")
        val mode = args.str("mode")?.lowercase()?.replace(Regex("[\\s-]+"), "_") ?: ""
        val preset = when {
            mode == "default" || mode == "safety" -> "safety"
            mode.contains("power") -> "powerfail"
            mode.contains("last") -> "last_on_state"
            mode == "custom" -> "custom"
            else -> return err("invalid_argument", "mode must be default, power_loss, last_state or custom.")
        }
        var describeTxt = when (preset) { "safety" -> "warm white, full brightness"; "powerfail" -> "last state after a power cut, off after the switch"; "last_on_state" -> "last state"; else -> "custom" }
        for (l in lights) {
            val body = if (preset != "custom") buildJsonObject { putJsonObject("powerup") { put("preset", preset) } } else {
                val d = parseDesired(args)
                describeTxt = "custom (${listOfNotNull(d.brightness?.let { "${it.roundToInt()}%" }, d.label).joinToString(", ").ifEmpty { "previous state" }})"
                buildJsonObject {
                    putJsonObject("powerup") {
                        put("preset", "custom")
                        putJsonObject("on") { put("mode", "on"); putJsonObject("on") { put("on", true) } }
                        if (d.brightness != null) putJsonObject("dimming") { put("mode", "dimming"); putJsonObject("dimming") { put("brightness", d.brightness.roundToInt().coerceIn(1, 100)) } } else putJsonObject("dimming") { put("mode", "previous") }
                        when {
                            d.mirek != null -> putJsonObject("color") { put("mode", "color_temperature"); putJsonObject("color_temperature") { put("mirek", d.mirek) } }
                            d.xy != null -> putJsonObject("color") { put("mode", "color"); putJsonObject("color") { putJsonObject("xy") { put("x", d.xy.x); put("y", d.xy.y) } } }
                            else -> putJsonObject("color") { put("mode", "previous") }
                        }
                    }
                }
            }
            bridge().put("light", l.id, body)
        }
        repo.refresh()
        return ok("Power-on behaviour of ${if (lights.size == 1) lights[0].name else "${lights.size} lights in $target"}: $describeTxt.")
    }

    // ------------------------------------------------------------------ rooms and zones

    private fun resolveLightList(v: JsonElement?, roomHint: String?): Pair<List<LightUi>?, JsonObject?> {
        val out = ArrayList<LightUi>()
        for (n in strings(v)) {
            val res = matchLight(n, roomHint)
            val l = (res as? MatchResult.Found)?.item ?: return null to matchFail(res, "light", n) { it.name }
            if (out.none { it.id == l.id }) out.add(l)
        }
        return out to null
    }

    private suspend fun createGroup(args: JsonObject): JsonObject {
        val kind = if (args.str("kind")?.lowercase() == "zone") "zone" else "room"
        val name = args.str("name")?.trim()?.take(32) ?: return err("invalid_argument", "name is required.")
        val (lights, e) = resolveLightList(args["lights"], null)
        if (lights == null) return e!!
        if (kind == "room") {
            val taken = lights.filter { it.roomName != null }
            if (taken.isNotEmpty()) return err("invalid_argument", "A light belongs to one room. Already placed: ${taken.joinToString(", ") { "${it.name} (${it.roomName})" }}. Remove them from their room first, or make a zone.")
        }
        val archetype = args.str("icon")?.trim()?.lowercase()?.replace(Regex("[\\s-]+"), "_") ?: "other"
        val body = buildJsonObject {
            put("type", kind)
            putJsonObject("metadata") { put("name", name); put("archetype", archetype) }
            putJsonArray("children") { for (l in lights) add(buildJsonObject { put("rid", if (kind == "room") (l.deviceId ?: l.id) else l.id); put("rtype", if (kind == "room") "device" else "light") }) }
        }
        val id = postResource(kind, body)
        return ok("${if (kind == "zone") "Zone" else "Room"} \"$name\" created with ${lights.size} light${if (lights.size == 1) "" else "s"}.", buildJsonObject { put("id", id) })
    }

    private suspend fun updateGroup(args: JsonObject): JsonObject {
        val q = args.str("group") ?: throw IllegalArgumentException("group is required")
        val res = matchGroup(q)
        val group = (res as? MatchResult.Found)?.item ?: return matchFail(res, "room", q) { it.name }
        val done = ArrayList<String>()
        val newName = args.str("new_name")?.trim()?.take(32)
        val icon = args.str("icon")?.trim()?.lowercase()?.replace(Regex("[\\s-]+"), "_")
        val (replace, e1) = resolveLightList(args["lights"], null); if (replace == null) return e1!!
        val (add, e2) = resolveLightList(args["add_lights"], null); if (add == null) return e2!!
        val (remove, e3) = resolveLightList(args["remove_lights"], group.name); if (remove == null) return e3!!
        val touchLights = replace.isNotEmpty() || add.isNotEmpty() || remove.isNotEmpty() || (args["lights"] is JsonArray)
        val body = buildJsonObject {
            if (newName != null || icon != null) {
                putJsonObject("metadata") { if (newName != null) put("name", newName); if (icon != null) put("archetype", icon) }
                if (newName != null) done.add("renamed to \"$newName\"")
                if (icon != null) done.add("icon $icon")
            }
            if (touchLights) {
                var ids = if (args["lights"] is JsonArray) replace.map { it.id }.toMutableList() else group.lights.map { it.id }.toMutableList()
                for (l in add) if (l.id !in ids) ids.add(l.id)
                val removeIds = remove.map { it.id }.toSet()
                ids = ids.filter { it !in removeIds }.toMutableList()
                if (group.kind.rtype == "room") {
                    val conflict = ids.mapNotNull { snap.light(it) }.filter { it.roomName != null && it.roomId != group.id }
                    if (conflict.isNotEmpty()) return err("invalid_argument", "A light belongs to one room. Already placed: ${conflict.joinToString(", ") { "${it.name} (${it.roomName})" }}.")
                    val lightDevices = snap.lights.map { it.deviceId ?: it.id }.toSet()
                    val keepOthers = group.deviceIds.filter { it !in lightDevices }
                    putJsonArray("children") { for (d in keepOthers + ids.map { snap.light(it)?.deviceId ?: it }) add(buildJsonObject { put("rid", d); put("rtype", "device") }) }
                } else {
                    putJsonArray("children") { for (id in ids) add(buildJsonObject { put("rid", id); put("rtype", "light") }) }
                }
                done.add("lights: ${ids.joinToString(", ") { snap.light(it)?.name ?: it }.ifEmpty { "none" }}")
            }
        }
        if (body.isEmpty()) return err("invalid_argument", "Give new_name, icon, add_lights, remove_lights or lights.")
        putResource(group.kind.rtype, group.id, body)
        return ok("${group.name}: ${done.joinToString("; ")}")
    }

    private suspend fun deleteGroup(args: JsonObject): JsonObject {
        val q = args.str("group") ?: throw IllegalArgumentException("group is required")
        val res = matchGroup(q)
        val group = (res as? MatchResult.Found)?.item ?: return matchFail(res, "room", q) { it.name }
        deleteResource(group.kind.rtype, group.id)
        return ok("${group.name} deleted; its lights are kept.")
    }

    // ------------------------------------------------------------------ scenes

    private fun sceneActionFromLight(l: LightUi): JsonObject = buildJsonObject {
        putJsonObject("target") { put("rid", l.id); put("rtype", "light") }
        putJsonObject("action") {
            putJsonObject("on") { put("on", l.on) }
            if (l.on) {
                if (l.supportsDimming) putJsonObject("dimming") { put("brightness", l.brightness.roundToInt().coerceIn(1, 100)) }
                if (l.isCtMode && l.mirek != null) putJsonObject("color_temperature") { put("mirek", l.mirek) }
                else if (l.supportsColor && l.xy != null) putJsonObject("color") { putJsonObject("xy") { put("x", l.xy.x); put("y", l.xy.y) } }
            }
        }
    }

    private fun sceneActionFor(lightId: String, on: Boolean, brightness: Int?, xy: XY?, mirek: Int?): JsonObject = buildJsonObject {
        putJsonObject("target") { put("rid", lightId); put("rtype", "light") }
        putJsonObject("action") {
            putJsonObject("on") { put("on", on) }
            if (on) {
                if (brightness != null) putJsonObject("dimming") { put("brightness", brightness.coerceIn(1, 100)) }
                if (xy != null) putJsonObject("color") { putJsonObject("xy") { put("x", xy.x); put("y", xy.y) } }
                else if (mirek != null) putJsonObject("color_temperature") { put("mirek", mirek) }
            }
        }
    }

    /** Per-light states from a lights array; each entry starts from the light's current look. */
    private fun sceneActionsFromArgs(v: JsonElement?, group: GroupUi): Pair<Map<String, JsonObject>?, JsonObject?> {
        val out = LinkedHashMap<String, JsonObject>()
        for (raw in (v as? JsonArray) ?: JsonArray(emptyList())) {
            val o = raw as? JsonObject ?: continue
            val q = o.str("light") ?: continue
            val res = matchLight(q, group.name)
            val l = (res as? MatchResult.Found)?.item ?: return null to matchFail(res, "light", q) { it.name }
            if (group.lights.none { it.id == l.id }) return null to err("invalid_argument", "${l.name} is not in ${group.name}.")
            val d = parseDesired(o)
            val on = d.on ?: l.on
            val brightness = d.brightness?.roundToInt() ?: l.brightness.roundToInt()
            val xy = d.xy ?: if (d.mirek == null && !l.isCtMode) l.xy else null
            val mirek = d.mirek ?: if (d.xy == null && l.isCtMode) l.mirek else null
            out[l.id] = sceneActionFor(l.id, on, brightness, xy, mirek)
        }
        return out to null
    }

    private suspend fun createScene(args: JsonObject): JsonObject {
        val name = args.str("name")?.trim()?.take(32) ?: return err("invalid_argument", "name is required.")
        val roomQ = args.str("room") ?: throw IllegalArgumentException("room is required")
        val res = matchGroup(roomQ)
        val group = (res as? MatchResult.Found)?.item ?: return matchFail(res, "room", roomQ) { it.name }
        val (overrides, e) = sceneActionsFromArgs(args["lights"], group)
        if (overrides == null) return e!!
        val actions = group.lights.map { overrides[it.id] ?: sceneActionFromLight(it) }
        val body = buildJsonObject {
            put("type", "scene")
            putJsonObject("metadata") { put("name", name) }
            putJsonObject("group") { put("rid", group.id); put("rtype", group.kind.rtype) }
            putJsonArray("actions") { for (a in actions) add(a) }
            args.num("speed")?.let { put("speed", it.coerceIn(0.0, 1.0)) }
            args.bool("auto_dynamic")?.let { put("auto_dynamic", it) }
        }
        val id = postResource("scene", body)
        return ok("Scene \"$name\" saved for ${group.name} (${actions.size} lights${if (overrides.isNotEmpty()) ", ${overrides.size} set explicitly" else ", current look"}).", buildJsonObject { put("id", id) })
    }

    private suspend fun updateScene(args: JsonObject): JsonObject {
        val q = args.str("scene") ?: throw IllegalArgumentException("scene is required")
        val res = matchScene(q, args.str("room"))
        val sc = (res as? MatchResult.Found)?.item ?: return matchFail(res, "scene", q) { "${it.name} (${it.groupName})" }
        val group = snap.group(sc.groupId)
        val done = ArrayList<String>()
        val newName = args.str("new_name")?.trim()?.take(32)
        val speed = args.num("speed")?.coerceIn(0.0, 1.0)
        val auto = args.bool("auto_dynamic")
        val fromCurrent = args.bool("from_current_state") == true
        val touchLights = group != null && (fromCurrent || (args["lights"] as? JsonArray)?.isNotEmpty() == true)
        var overrides: Map<String, JsonObject> = emptyMap()
        if (touchLights) {
            val (o, e) = sceneActionsFromArgs(args["lights"], group!!)
            if (o == null) return e!!
            overrides = o
        }
        val body = buildJsonObject {
            if (newName != null) { putJsonObject("metadata") { put("name", newName) }; done.add("renamed to \"$newName\"") }
            if (speed != null) { put("speed", speed); done.add("speed $speed") }
            if (auto != null) { put("auto_dynamic", auto); done.add("auto-dynamic ${if (auto) "on" else "off"}") }
            if (touchLights) {
                val existing = sc.actions.associate { a -> a.target.rid to buildJsonObject { putJsonObject("target") { put("rid", a.target.rid); put("rtype", a.target.rtype) }; put("action", a.action) } }
                val actions = group!!.lights.map { l -> overrides[l.id] ?: (if (fromCurrent) sceneActionFromLight(l) else existing[l.id] ?: sceneActionFromLight(l)) }
                putJsonArray("actions") { for (a in actions) add(a) }
                done.add(if (fromCurrent) "captured the current look" else "${overrides.size} light${if (overrides.size == 1) "" else "s"} changed")
            }
        }
        if (body.isEmpty()) return err("invalid_argument", "Give new_name, speed, auto_dynamic, lights or from_current_state.")
        putResource("scene", sc.id, body)
        return ok("Scene \"${sc.name}\" (${sc.groupName}): ${done.joinToString("; ")}")
    }

    private suspend fun deleteScene(args: JsonObject): JsonObject {
        val q = args.str("scene") ?: throw IllegalArgumentException("scene is required")
        val res = matchScene(q, args.str("room"))
        val sc = (res as? MatchResult.Found)?.item ?: return matchFail(res, "scene", q) { "${it.name} (${it.groupName})" }
        repo.deleteScene(sc.id)
        return ok("Scene \"${sc.name}\" deleted from ${sc.groupName}.")
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
        if (s.routines.isNotEmpty()) {
            sb.append("- routines (set_wake_up / set_go_to_sleep / delete_routine): ")
                .append(s.routines.joinToString("; ") { r -> "${r.name} [${r.kind}] → ${r.whereNames.joinToString(", ")}: ${r.summary}${if (r.enabled) "" else " (paused)"}" })
                .append('\n')
        }
        sb.append("- also on the bridge: rooms/zones (create_group, update_group, delete_group), scenes (create_scene, update_scene, delete_scene), rename, sensor settings (set_sensor_settings: sensitivity, room, name), light power-on behaviour (set_light_power_on_behavior). Never tell the user to use the Hue app for these.\n")
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
