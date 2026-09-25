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
        add(decl("get_sensor_readings", "Read motion, temperature, light level, battery and switch button sensors.", emptyMap(), emptyList()))
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
            "list_schedules" -> listSchedules()
            "create_schedule" -> createSchedule(args)
            "delete_schedule" -> deleteSchedule(args)
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
                "get_sensor_readings" -> "Read sensors"
                "list_schedules" -> "Listed schedules"
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

    private fun sensorReadings(): JsonObject = buildJsonObject {
        put("ok", true)
        put("sensors", buildJsonArray {
            for (a in snap.accessories) {
                if (a.motionId != null) add(buildJsonObject { put("device", a.name); put("type", "motion"); put("value", a.motion ?: false); put("unit", "boolean"); put("updated", JsonPrimitive(a.motionUpdated)) })
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
        val sensors = s.accessories.filter { !it.isBridge }
        if (sensors.isNotEmpty()) sb.append("- accessories: ").append(sensors.joinToString(", ") { "${it.name} (${it.kind})" }).append('\n')
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
