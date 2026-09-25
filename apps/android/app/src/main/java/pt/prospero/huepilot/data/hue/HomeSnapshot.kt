package pt.prospero.huepilot.data.hue

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonPrimitive
import pt.prospero.huepilot.domain.ColorMath
import pt.prospero.huepilot.domain.Gamut
import pt.prospero.huepilot.domain.XY
import kotlin.math.pow
import kotlin.math.roundToInt

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
    val motion: Boolean?,
    val motionEnabled: Boolean?,
    val motionUpdated: String?,
    val temperatureId: String?,
    val temperatureC: Double?,
    val temperatureUpdated: String?,
    val lightLevelId: String?,
    val lightLevelRaw: Int?,
    val lightLevelUpdated: String?,
    val buttons: List<ButtonInfo>,
    val connectivity: String?,
) {
    val lux: Double? get() = lightLevelRaw?.let { 10.0.pow((it - 1) / 10000.0) }
    val kind: String
        get() = when {
            isBridge -> "bridge"
            motionId != null -> "motion"
            buttons.isNotEmpty() -> "switch"
            else -> "other"
        }
}

data class BridgeUi(val id: String, val bridgeId: String?, val timeZone: String?, val name: String?, val modelId: String?, val softwareVersion: String?)

data class HomeSnapshot(
    val lights: List<LightUi> = emptyList(),
    val rooms: List<GroupUi> = emptyList(),
    val zones: List<GroupUi> = emptyList(),
    val scenes: List<SceneUi> = emptyList(),
    val accessories: List<AccessoryUi> = emptyList(),
    val bridgeHomeGroupedLightId: String? = null,
    val allOn: Boolean = false,
    val bridge: BridgeUi? = null,
    val resourceCount: Int = 0,
) {
    val groups: List<GroupUi> get() = rooms + zones
    val lightsOn: Int get() = lights.count { it.on }
    val isEmpty: Boolean get() = resourceCount == 0
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
        val lightLevels = LinkedHashMap<String, LightLevel>()
        val temperatures = LinkedHashMap<String, Temperature>()
        val powers = LinkedHashMap<String, DevicePower>()
        val buttons = LinkedHashMap<String, Button>()
        val zigbee = LinkedHashMap<String, ZigbeeConnectivity>()
        var bridgeHome: Group? = null
        var bridge: Bridge? = null

        for ((id, obj) in resources) {
            when (typeOf(obj)) {
                "light" -> decode(obj, Light.serializer())?.let { lights[id] = it }
                "room", "zone" -> decode(obj, Group.serializer())?.let { groups[id] = it }
                "bridge_home" -> decode(obj, Group.serializer())?.let { bridgeHome = it }
                "grouped_light" -> decode(obj, GroupedLight.serializer())?.let { groupedLights[id] = it }
                "scene" -> decode(obj, Scene.serializer())?.let { scenes[id] = it }
                "device" -> decode(obj, Device.serializer())?.let { devices[id] = it }
                "motion", "camera_motion" -> decode(obj, Motion.serializer())?.let { motions[id] = it }
                "light_level" -> decode(obj, LightLevel.serializer())?.let { lightLevels[id] = it }
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
                motion = m?.motion?.report?.motion ?: m?.motion?.motion,
                motionEnabled = m?.enabled,
                motionUpdated = m?.motion?.report?.changed,
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
            resourceCount = resources.size,
        )
    }

    fun percent(v: Double): Int = v.roundToInt().coerceIn(0, 100)
}
