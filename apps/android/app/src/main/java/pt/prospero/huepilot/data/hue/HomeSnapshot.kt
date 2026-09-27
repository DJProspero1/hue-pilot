package pt.prospero.huepilot.data.hue

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import pt.prospero.huepilot.domain.ColorMath
import pt.prospero.huepilot.domain.Gamut
import pt.prospero.huepilot.domain.XY
import kotlin.math.pow
import kotlin.math.roundToInt
import pt.prospero.huepilot.domain.MotionAutomations
import kotlinx.serialization.json.JsonPrimitive
import pt.prospero.huepilot.domain.Routines

enum class GroupKind(val rtype: String) { ROOM("room"), ZONE("zone") }

data class LightUi(
    val id: String,
    val idV1: String?,
    val name: String,
    val deviceId: String?,
    val roomId: String?,
    val roomName: String?,
    val on: Boolean,
    val brightness: Double,
    val minDimLevel: Double?,
    val xy: XY?,
    val mirek: Int?,
    val mirekValid: Boolean,
    val mirekMin: Int,
    val mirekMax: Int,
    val gamut: Gamut,
    val gamutType: String?,
    val supportsDimming: Boolean,
    val supportsColor: Boolean,
    val supportsCt: Boolean,
    val effectValues: List<String>,
    val activeEffect: String?,
    val usesEffectsV2: Boolean,
    val archetype: String?,
    val connectivity: String?,
    val productName: String?,
    val modelId: String?,
    val softwareVersion: String?,
    val dynamicsStatus: String?,
) {
    val supportsEffects: Boolean get() = effectValues.any { it != "no_effect" }
    val isCtMode: Boolean get() = supportsCt && mirekValid && mirek != null
    val kelvin: Int? get() = mirek?.let { ColorMath.mirekToKelvin(it) }

    /** Colour to draw for this light at full brightness (never null: white lights get a warm tint). */
    val swatchHex: String
        get() = when {
            isCtMode -> ColorMath.mirekToHex(mirek!!)
            xy != null -> ColorMath.xyToHex(xy)
            supportsCt && mirek != null -> ColorMath.mirekToHex(mirek)
            else -> "#ffd9a3"
        }

    /** The hex the assistant reports: null for white-mode/white-only lights. */
    val colorHexOrNull: String? get() = if (supportsColor && !isCtMode && xy != null) ColorMath.xyToHex(xy) else null
}

data class GroupUi(
    val id: String,
    val idV1: String?,
    val name: String,
    val kind: GroupKind,
    val archetype: String?,
    val groupedLightId: String?,
    val on: Boolean,
    val brightness: Double,
    val lights: List<LightUi>,
    val deviceIds: List<String>,
) {
    val lightsOn: Int get() = lights.count { it.on }
    val colorHexes: List<String> get() = lights.filter { it.on }.map { it.swatchHex }.distinct()
}

data class SceneUi(
    val id: String,
    val idV1: String?,
    val name: String,
    val groupId: String,
    val groupRtype: String,
    val groupName: String,
    val active: String,
    val paletteHexes: List<String>,
    val speed: Double?,
    val autoDynamic: Boolean,
    val actions: List<SceneAction>,
) {
    val isActive: Boolean get() = active == "static" || active == "dynamic_palette"
    val isDynamic: Boolean get() = active == "dynamic_palette"
}

data class ButtonInfo(val id: String, val controlId: Int?, val lastEvent: String?, val updated: String?)

data class AccessoryUi(
    val deviceId: String,
    val idV1: String?,
    val name: String,
    val productName: String?,
    val modelId: String?,
    val archetype: String?,
    val softwareVersion: String?,
    val isBridge: Boolean,
    val batteryLevel: Int?,
    val batteryState: String?,
    val motionId: String?,
    /** Resource type of the motion service: `motion` (sensor) or `camera_motion` (Hue Secure camera). */
    val motionType: String? = null,
    val motion: Boolean?,
    val motionEnabled: Boolean?,
    val motionUpdated: String?,
    /** Light id of the floodlight paired with this camera (floodlight cameras only). */
    val floodlightLightId: String? = null,
    val temperatureId: String?,
    val temperatureC: Double?,
    val temperatureUpdated: String?,
    val lightLevelId: String?,
    val lightLevelRaw: Int?,
    val lightLevelUpdated: String?,
    val buttons: List<ButtonInfo>,
    val connectivity: String?,
    /** Room the device was placed in (rooms hold devices, so sensors have one too). */
    val roomName: String? = null,
    val motionSensitivity: Int? = null,
    val motionSensitivityMax: Int? = null,
) {
    val lux: Double? get() = lightLevelRaw?.let { 10.0.pow((it - 1) / 10000.0) }

    /** Hue Secure cameras report motion through a `camera_motion` service; the product name is the fallback. */
    val isCamera: Boolean
        get() = motionType == "camera_motion" || productName?.contains("camera", ignoreCase = true) == true || modelId?.let { it.startsWith("CMB") || it.startsWith("CMW") } == true
    val isFloodlightCamera: Boolean get() = isCamera && (modelId == "CMW002" || productName?.contains("floodlight", ignoreCase = true) == true)
    val kind: String
        get() = when {
            isBridge -> "bridge"
            isCamera -> "camera"
            motionId != null -> "motion"
            buttons.isNotEmpty() -> "switch"
            else -> "other"
        }
}

data class BridgeUi(val id: String, val bridgeId: String?, val timeZone: String?, val name: String?, val modelId: String?, val softwareVersion: String?)

/** One time slot of a motion automation; kinds are "nothing", "off" or "scene". */
data class MotionSlotUi(val start: String, val onMotion: String, val onMotionSceneId: String?, val noMotionAfterMinutes: Int, val onNoMotion: String, val onNoMotionSceneId: String?, val doNotDisturb: Boolean)

/** A wake-up / go-to-sleep routine (bridge behavior_instance), or another automation the Hue app manages. */
data class RoutineUi(
    val id: String,
    val name: String,
    /** "wake_up", "go_to_sleep" or "other". */
    val kind: String,
    val scriptId: String,
    val enabled: Boolean,
    val status: String?,
    val whereIds: List<String>,
    val whereKinds: List<String>,
    val whereNames: List<String>,
    val time: String?,
    val days: List<String>?,
    val fadeMinutes: Int?,
    val endBrightness: Int?,
    val turnOffAfterMinutes: Int?,
    val endState: String?,
    val summary: String,
    val configuration: JsonObject,
)

/** What a motion sensor or camera makes the lights do: a bridge behavior_instance of the Hue Accessories script. */
data class MotionAutomationUi(
    val id: String,
    val name: String,
    val enabled: Boolean,
    val status: String?,
    val sourceDeviceId: String,
    val sourceName: String,
    /** "sensor" or "camera". */
    val sourceKind: String,
    val motionServiceId: String,
    val motionType: String,
    val whereIds: List<String>,
    val whereKinds: List<String>,
    val whereNames: List<String>,
    val onlyWhenDark: Boolean,
    /** "any", "sunset_to_sunrise" or "sensor". */
    val darkness: String,
    val darknessDetails: String,
    val darknessSpec: MotionAutomations.Darkness,
    /** The bridge's darkness condition as stored (kept when updating). */
    val lightLevel: JsonObject?,
    /** The bridge configuration verbatim: an enabled-only PUT is refused unless it is sent back too. */
    val configuration: JsonObject,
    val slots: List<MotionSlotUi>,
    val summary: String,
)

data class HomeSnapshot(
    val lights: List<LightUi> = emptyList(),
    val rooms: List<GroupUi> = emptyList(),
    val zones: List<GroupUi> = emptyList(),
    val scenes: List<SceneUi> = emptyList(),
    val accessories: List<AccessoryUi> = emptyList(),
    val bridgeHomeGroupedLightId: String? = null,
    val allOn: Boolean = false,
    val bridge: BridgeUi? = null,
    val motionAutomations: List<MotionAutomationUi> = emptyList(),
    val routines: List<RoutineUi> = emptyList(),
    val resourceCount: Int = 0,
) {
    val groups: List<GroupUi> get() = rooms + zones
    val lightsOn: Int get() = lights.count { it.on }
    val isEmpty: Boolean get() = resourceCount == 0
    val cameras: List<AccessoryUi> get() = accessories.filter { it.kind == "camera" }
    val motionSensors: List<AccessoryUi> get() = accessories.filter { it.kind == "motion" }
    val switches: List<AccessoryUi> get() = accessories.filter { it.kind == "switch" }
    /** Colours of every light that is on, most common first (used for the "all lights" ambient card). */
    val litHexes: List<String> get() = lights.filter { it.on }.groupingBy { it.swatchHex }.eachCount().entries.sortedByDescending { it.value }.map { it.key }
    fun group(id: String): GroupUi? = groups.firstOrNull { it.id == id }
    fun light(id: String): LightUi? = lights.firstOrNull { it.id == id }
    fun scene(id: String): SceneUi? = scenes.firstOrNull { it.id == id }
    fun scenesFor(groupId: String): List<SceneUi> = scenes.filter { it.groupId == groupId }
    val lightsWithoutRoom: List<LightUi> get() = lights.filter { it.roomId == null }
}

/** Builds the typed [HomeSnapshot] from the raw resource map. Tolerates any malformed resource. */
object SnapshotBuilder {
    private inline fun <reified T> decode(obj: JsonObject, s: kotlinx.serialization.KSerializer<T>): T? =
        runCatching { HueJson.decodeFromJsonElement(s, obj) }.getOrNull()

    private fun typeOf(obj: JsonObject) = obj["type"]?.jsonPrimitive?.content

    fun build(resources: Map<String, JsonObject>): HomeSnapshot {
        if (resources.isEmpty()) return HomeSnapshot()
        val lights = LinkedHashMap<String, Light>()
        val groups = LinkedHashMap<String, Group>()
        val groupedLights = LinkedHashMap<String, GroupedLight>()
        val scenes = LinkedHashMap<String, Scene>()
        val devices = LinkedHashMap<String, Device>()
        val motions = LinkedHashMap<String, Motion>()
        val motionTypes = HashMap<String, String>()
        val lightLevels = LinkedHashMap<String, LightLevel>()
        val temperatures = LinkedHashMap<String, Temperature>()
        val powers = LinkedHashMap<String, DevicePower>()
        val buttons = LinkedHashMap<String, Button>()
        val zigbee = LinkedHashMap<String, ZigbeeConnectivity>()
        var bridgeHome: Group? = null
        var bridge: Bridge? = null
        val behaviors = ArrayList<JsonObject>()
        val scriptNames = HashMap<String, String>()

        for ((id, obj) in resources) {
            when (typeOf(obj)) {
                "light" -> decode(obj, Light.serializer())?.let { lights[id] = it }
                "room", "zone" -> decode(obj, Group.serializer())?.let { groups[id] = it }
                "bridge_home" -> decode(obj, Group.serializer())?.let { bridgeHome = it }
                "grouped_light" -> decode(obj, GroupedLight.serializer())?.let { groupedLights[id] = it }
                "scene" -> decode(obj, Scene.serializer())?.let { scenes[id] = it }
                "device" -> decode(obj, Device.serializer())?.let { devices[id] = it }
                "motion", "camera_motion" -> decode(obj, Motion.serializer())?.let { motions[id] = it; motionTypes[id] = typeOf(obj) ?: "motion" }
                "light_level" -> decode(obj, LightLevel.serializer())?.let { lightLevels[id] = it }
                "behavior_instance" -> behaviors.add(obj)
                "behavior_script" -> (obj["metadata"] as? JsonObject)?.get("name")?.jsonPrimitive?.content?.let { scriptNames[id] = it }
                "temperature" -> decode(obj, Temperature.serializer())?.let { temperatures[id] = it }
                "device_power" -> decode(obj, DevicePower.serializer())?.let { powers[id] = it }
                "button" -> decode(obj, Button.serializer())?.let { buttons[id] = it }
                "zigbee_connectivity" -> decode(obj, ZigbeeConnectivity.serializer())?.let { zigbee[id] = it }
                "bridge" -> decode(obj, Bridge.serializer())?.let { bridge = it }
                else -> Unit
            }
        }

        // device id -> connectivity status
        val connectivityByDevice = zigbee.values.mapNotNull { z -> z.owner?.rid?.let { it to z.status } }.toMap()

        // light id -> room (rooms own devices, whose services include the light)
        val lightToRoom = HashMap<String, Group>()
        val deviceLightIds = HashMap<String, List<String>>()
        for (d in devices.values) deviceLightIds[d.id] = d.services.filter { it.rtype == "light" }.map { it.rid }
        for (g in groups.values.filter { it.type == "room" }) {
            for (child in g.children) {
                when (child.rtype) {
                    "device" -> deviceLightIds[child.rid]?.forEach { lightToRoom[it] = g }
                    "light" -> lightToRoom[child.rid] = g
                }
            }
        }

        val lightUis = LinkedHashMap<String, LightUi>()
        for (l in lights.values) {
            val room = lightToRoom[l.id]
            val device = l.owner?.rid?.let { devices[it] }
            val colorState = l.color
            val ct = l.colorTemperature
            val gamut = colorState?.gamut?.let { g -> Gamut(XY(g.red.x, g.red.y), XY(g.green.x, g.green.y), XY(g.blue.x, g.blue.y)) }
                ?: ColorMath.gamutForType(colorState?.gamutType)
            val v2 = l.effectsV2
            val effectValues = when {
                v2?.action?.effectValues?.isNotEmpty() == true -> v2.action.effectValues
                l.effects?.effectValues?.isNotEmpty() == true -> l.effects.effectValues
                else -> emptyList()
            }
            val activeEffect = v2?.status?.effect ?: l.effects?.status
            lightUis[l.id] = LightUi(
                id = l.id,
                idV1 = l.idV1,
                name = l.metadata?.name ?: device?.metadata?.name ?: "Light",
                deviceId = l.owner?.rid,
                roomId = room?.id,
                roomName = room?.metadata?.name,
                on = l.on?.on ?: false,
                brightness = l.dimming?.brightness ?: (if (l.on?.on == true) 100.0 else 0.0),
                minDimLevel = l.dimming?.minDimLevel,
                xy = colorState?.xy?.let { XY(it.x, it.y) },
                mirek = ct?.mirek,
                mirekValid = ct?.mirekValid ?: (ct?.mirek != null),
                mirekMin = ct?.schema?.min ?: 153,
                mirekMax = ct?.schema?.max ?: 500,
                gamut = gamut,
                gamutType = colorState?.gamutType,
                supportsDimming = l.dimming != null,
                supportsColor = colorState != null,
                supportsCt = ct != null,
                effectValues = effectValues,
                activeEffect = activeEffect?.takeIf { it != "no_effect" },
                usesEffectsV2 = v2 != null,
                archetype = l.metadata?.archetype ?: device?.productData?.productArchetype,
                connectivity = l.owner?.rid?.let { connectivityByDevice[it] },
                productName = device?.productData?.productName,
                modelId = device?.productData?.modelId,
                softwareVersion = device?.productData?.softwareVersion,
                dynamicsStatus = l.dynamics?.status,
            )
        }

        fun buildGroup(g: Group, kind: GroupKind): GroupUi {
            val glId = g.services.firstOrNull { it.rtype == "grouped_light" }?.rid
            val gl = glId?.let { groupedLights[it] }
            val memberIds = LinkedHashSet<String>()
            val deviceIds = ArrayList<String>()
            for (c in g.children) {
                when (c.rtype) {
                    "device" -> { deviceIds += c.rid; deviceLightIds[c.rid]?.let { memberIds += it } }
                    "light" -> memberIds += c.rid
                }
            }
            val members = memberIds.mapNotNull { lightUis[it] }
            val anyOn = members.any { it.on }
            val memberAvg = members.filter { it.on }.map { it.brightness }.average().takeIf { !it.isNaN() } ?: 0.0
            // grouped_light "on" means "any light on"; combine with member state so a stale group never hides lit lights.
            return GroupUi(
                id = g.id,
                idV1 = g.idV1,
                name = g.metadata?.name ?: kind.name.lowercase().replaceFirstChar { it.uppercase() },
                kind = kind,
                archetype = g.metadata?.archetype,
                groupedLightId = glId,
                on = (gl?.on?.on ?: false) || anyOn,
                brightness = gl?.dimming?.brightness?.takeIf { it > 0 } ?: memberAvg,
                lights = members,
                deviceIds = deviceIds,
            )
        }

        val roomUis = groups.values.filter { it.type == "room" }.map { buildGroup(it, GroupKind.ROOM) }.sortedBy { it.name.lowercase() }
        val zoneUis = groups.values.filter { it.type == "zone" }.map { buildGroup(it, GroupKind.ZONE) }.sortedBy { it.name.lowercase() }
        val groupNames = (roomUis + zoneUis).associate { it.id to it.name }

        val sceneUis = scenes.values.mapNotNull { s ->
            val gid = s.group?.rid ?: return@mapNotNull null
            val hexes = ArrayList<String>()
            s.palette?.color?.forEach { c -> c.color?.xy?.let { hexes += ColorMath.xyToHex(XY(it.x, it.y)) } }
            s.palette?.colorTemperature?.forEach { c -> c.colorTemperature?.mirek?.let { hexes += ColorMath.mirekToHex(it) } }
            if (hexes.isEmpty()) {
                // Fall back to the colours in the actions.
                for (a in s.actions) {
                    val act = a.action
                    val xy = act["color"]?.let { runCatching { HueJson.decodeFromJsonElement(ColorState.serializer(), it) }.getOrNull() }?.xy
                    val mirek = act["color_temperature"]?.let { runCatching { HueJson.decodeFromJsonElement(ColorTemperatureState.serializer(), it) }.getOrNull() }?.mirek
                    when {
                        xy != null -> hexes += ColorMath.xyToHex(XY(xy.x, xy.y))
                        mirek != null -> hexes += ColorMath.mirekToHex(mirek)
                    }
                }
            }
            SceneUi(
                id = s.id,
                idV1 = s.idV1,
                name = s.metadata?.name ?: "Scene",
                groupId = gid,
                groupRtype = s.group.rtype,
                groupName = groupNames[gid] ?: "",
                active = s.status?.active ?: "inactive",
                paletteHexes = hexes.distinct().take(5),
                speed = s.speed,
                autoDynamic = s.autoDynamic ?: false,
                actions = s.actions,
            )
        }.sortedWith(compareBy({ it.groupName.lowercase() }, { it.name.lowercase() }))

        // Accessories: every device that has no light service (plus the bridge itself).
        val motionByDevice = motions.values.associateBy { it.owner?.rid }
        val llByDevice = lightLevels.values.associateBy { it.owner?.rid }
        val tempByDevice = temperatures.values.associateBy { it.owner?.rid }
        val powerByDevice = powers.values.associateBy { it.owner?.rid }
        val buttonsByDevice = buttons.values.groupBy { it.owner?.rid }
        val bridgeDeviceId = bridge?.owner?.rid
        // Floodlight cameras expose their light as a separate device (archetype hue_floodlight_camera).
        val floodlightLights = lightUis.values.filter { it.archetype == "hue_floodlight_camera" }
        val floodlightCameras = devices.values.filter { d -> d.services.none { it.rtype == "light" } && (d.productData?.modelId == "CMW002" || d.productData?.productName?.contains("floodlight", true) == true) }
        val floodlightByCamera = HashMap<String, String>()
        if (floodlightLights.size == 1 && floodlightCameras.size == 1) {
            floodlightByCamera[floodlightCameras[0].id] = floodlightLights[0].id
        } else if (floodlightLights.isNotEmpty() && floodlightCameras.isNotEmpty()) {
            fun norm(s: String?) = (s ?: "").lowercase().replace(Regex("[^a-z]"), "")
            val free = floodlightLights.toMutableList()
            for (cam in floodlightCameras) {
                val camName = norm(cam.metadata?.name)
                val best = free.maxByOrNull { l -> l.name.let { n -> norm(n).commonPrefixWith(camName).length } } ?: break
                floodlightByCamera[cam.id] = best.id
                free.remove(best)
            }
        }
        val roomNameOfDevice = HashMap<String, String>()
        for (g in groups.values) if (g.type == "room") for (c in g.children) if (c.rtype == "device") g.metadata?.name?.let { roomNameOfDevice[c.rid] = it }
        val accessories = devices.values.filter { d ->
            d.services.none { it.rtype == "light" } || d.id == bridgeDeviceId
        }.map { d ->
            val m = motionByDevice[d.id]
            val ll = llByDevice[d.id]
            val t = tempByDevice[d.id]
            val p = powerByDevice[d.id]
            AccessoryUi(
                deviceId = d.id,
                idV1 = d.idV1,
                name = d.metadata?.name ?: d.productData?.productName ?: "Device",
                productName = d.productData?.productName,
                modelId = d.productData?.modelId,
                archetype = d.productData?.productArchetype ?: d.metadata?.archetype,
                softwareVersion = d.productData?.softwareVersion,
                isBridge = d.id == bridgeDeviceId || d.services.any { it.rtype == "bridge" },
                batteryLevel = p?.powerState?.batteryLevel,
                batteryState = p?.powerState?.batteryState,
                motionId = m?.id,
                motionType = m?.id?.let { motionTypes[it] },
                motion = m?.motion?.report?.motion ?: m?.motion?.motion,
                motionEnabled = m?.enabled,
                motionUpdated = m?.motion?.report?.changed,
                floodlightLightId = floodlightByCamera[d.id],
                temperatureId = t?.id,
                temperatureC = t?.temperature?.report?.temperature ?: t?.temperature?.temperature,
                temperatureUpdated = t?.temperature?.report?.changed,
                lightLevelId = ll?.id,
                lightLevelRaw = ll?.light?.report?.lightLevel ?: ll?.light?.lightLevel,
                lightLevelUpdated = ll?.light?.report?.changed,
                buttons = (buttonsByDevice[d.id] ?: emptyList()).sortedBy { it.metadata?.controlId ?: 0 }.map { b ->
                    ButtonInfo(b.id, b.metadata?.controlId, b.button?.report?.event ?: b.button?.lastEvent, b.button?.report?.updated)
                },
                connectivity = connectivityByDevice[d.id],
                roomName = roomNameOfDevice[d.id],
                motionSensitivity = m?.sensitivity?.sensitivity,
                motionSensitivityMax = m?.sensitivity?.sensitivityMax,
            )
        }.sortedWith(compareBy({ !it.isBridge }, { it.name.lowercase() }))

        val bridgeHomeGl = bridgeHome?.services?.firstOrNull { it.rtype == "grouped_light" }?.rid
        val bridgeDevice = bridgeDeviceId?.let { devices[it] }
        val bridgeUi = bridge?.let {
            BridgeUi(
                id = it.id,
                bridgeId = it.bridgeId,
                timeZone = it.timeZone?.timeZone,
                name = bridgeDevice?.metadata?.name,
                modelId = bridgeDevice?.productData?.modelId,
                softwareVersion = bridgeDevice?.productData?.softwareVersion,
            )
        }

        val automationGroupNames = (roomUis + zoneUis).associate { it.id to it.name }
        val sceneNames = sceneUis.associate { it.id to it.name }
        val cameraIds = accessories.filter { it.isCamera }.map { it.deviceId }.toSet()
        val motionAutomations = behaviors.filter { MotionAutomations.isMotionAutomation(it) }.mapNotNull { b ->
            val spec = MotionAutomations.parseConfiguration(b["configuration"] as? JsonObject) ?: return@mapNotNull null
            val id = b["id"]?.jsonPrimitive?.content ?: return@mapNotNull null
            val device = devices[spec.sourceDeviceId]
            fun kind(a: MotionAutomations.Action) = when (a) { is MotionAutomations.Action.Scene -> "scene"; MotionAutomations.Action.Off -> "off"; MotionAutomations.Action.Nothing -> "nothing" }
            fun sceneId(a: MotionAutomations.Action) = (a as? MotionAutomations.Action.Scene)?.sceneId
            MotionAutomationUi(
                id = id,
                name = (b["metadata"] as? JsonObject)?.get("name")?.jsonPrimitive?.content?.trim()?.ifEmpty { null } ?: device?.metadata?.name ?: "Motion automation",
                enabled = b["enabled"]?.jsonPrimitive?.content != "false",
                status = (b["status"] as? JsonPrimitive)?.content,
                sourceDeviceId = spec.sourceDeviceId,
                sourceName = device?.metadata?.name ?: device?.productData?.productName ?: "Sensor",
                sourceKind = if (spec.motionType == "camera_motion" || spec.sourceDeviceId in cameraIds) "camera" else "sensor",
                motionServiceId = spec.motionServiceId,
                motionType = spec.motionType,
                whereIds = spec.where.map { it.first },
                whereKinds = spec.where.map { it.second },
                whereNames = spec.where.map { automationGroupNames[it.first] ?: "room" },
                onlyWhenDark = spec.darkness !is MotionAutomations.Darkness.AnyTime,
                darkness = spec.darkness.mode,
                darknessDetails = MotionAutomations.describeDarkness(spec.darkness),
                darknessSpec = spec.darkness,
                lightLevel = (b["configuration"] as? JsonObject)?.get("light_level") as? JsonObject,
                configuration = (b["configuration"] as? JsonObject) ?: JsonObject(emptyMap()),
                slots = spec.slots.sortedBy { it.start.minutes }.map { sl -> MotionSlotUi(sl.start.toString(), kind(sl.onMotion), sceneId(sl.onMotion), sl.noMotionAfterMinutes, kind(sl.onNoMotion), sceneId(sl.onNoMotion), sl.doNotDisturb) },
                summary = MotionAutomations.describe(spec.slots, spec.darkness) { sceneNames[it] ?: "scene" },
            )
        }.sortedBy { it.sourceName.lowercase() }

        val routines = behaviors.filter { !MotionAutomations.isMotionAutomation(it) }.mapNotNull { b ->
            val id = b["id"]?.jsonPrimitive?.content ?: return@mapNotNull null
            val scriptId = b["script_id"]?.jsonPrimitive?.content ?: ""
            val cfg = b["configuration"] as? JsonObject
            val spec = Routines.parseConfiguration(scriptId, cfg)
            val whereRaw = (cfg?.get("where") as? kotlinx.serialization.json.JsonArray ?: kotlinx.serialization.json.JsonArray(emptyList())).mapNotNull { w ->
                val g = (w as? JsonObject)?.get("group") as? JsonObject ?: return@mapNotNull null
                val rid = g["rid"]?.jsonPrimitive?.content ?: return@mapNotNull null
                rid to (if (g["rtype"]?.jsonPrimitive?.content == "zone") "zone" else "room")
            }
            val where = spec?.where ?: whereRaw
            val scriptName = scriptNames[scriptId]
            RoutineUi(
                id = id,
                name = (b["metadata"] as? JsonObject)?.get("name")?.jsonPrimitive?.content?.trim()?.ifEmpty { null } ?: scriptName ?: "Automation",
                kind = spec?.kind ?: "other",
                scriptId = scriptId,
                enabled = b["enabled"]?.jsonPrimitive?.content != "false",
                status = (b["status"] as? JsonPrimitive)?.content,
                whereIds = where.map { it.first },
                whereKinds = where.map { it.second },
                whereNames = where.map { automationGroupNames[it.first] ?: if (bridgeHome?.id == it.first) "All lights" else "room" },
                time = spec?.time?.toString(),
                days = spec?.days,
                fadeMinutes = spec?.fadeMinutes,
                endBrightness = spec?.endBrightness,
                turnOffAfterMinutes = spec?.turnOffAfterMinutes,
                endState = spec?.endState,
                summary = spec?.let { Routines.describe(it) } ?: "${scriptName ?: "automation"} (managed in the Hue app)",
                configuration = cfg ?: JsonObject(emptyMap()),
            )
        }.sortedWith(compareBy({ it.kind }, { it.name.lowercase() }))

        val sortedLights = lightUis.values.sortedWith(compareBy({ it.roomName?.lowercase() ?: "￿" }, { it.name.lowercase() }))
        return HomeSnapshot(
            lights = sortedLights,
            rooms = roomUis,
            zones = zoneUis,
            scenes = sceneUis,
            accessories = accessories,
            bridgeHomeGroupedLightId = bridgeHomeGl,
            allOn = bridgeHomeGl?.let { groupedLights[it]?.on?.on } ?: sortedLights.any { it.on },
            bridge = bridgeUi,
            motionAutomations = motionAutomations,
            routines = routines,
            resourceCount = resources.size,
        )
    }

    fun percent(v: Double): Int = v.roundToInt().coerceIn(0, 100)
}
