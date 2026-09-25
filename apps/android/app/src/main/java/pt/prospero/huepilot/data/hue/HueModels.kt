package pt.prospero.huepilot.data.hue

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject

/** Lenient JSON configuration for everything the bridge returns. */
val HueJson: Json = Json {
    ignoreUnknownKeys = true
    isLenient = true
    coerceInputValues = true
    explicitNulls = false
    encodeDefaults = false
}

@Serializable
data class ResourceRef(val rid: String = "", val rtype: String = "")

@Serializable
data class Metadata(val name: String? = null, val archetype: String? = null, @SerialName("control_id") val controlId: Int? = null)

@Serializable
data class OnState(val on: Boolean = false)

@Serializable
data class Dimming(val brightness: Double = 0.0, @SerialName("min_dim_level") val minDimLevel: Double? = null)

@Serializable
data class MirekSchema(@SerialName("mirek_minimum") val min: Int = 153, @SerialName("mirek_maximum") val max: Int = 500)

@Serializable
data class ColorTemperatureState(
    val mirek: Int? = null,
    @SerialName("mirek_valid") val mirekValid: Boolean? = null,
    @SerialName("mirek_schema") val schema: MirekSchema? = null,
)

@Serializable
data class XYJson(val x: Double = 0.0, val y: Double = 0.0)

@Serializable
data class GamutJson(val red: XYJson = XYJson(), val green: XYJson = XYJson(), val blue: XYJson = XYJson())

@Serializable
data class ColorState(val xy: XYJson? = null, val gamut: GamutJson? = null, @SerialName("gamut_type") val gamutType: String? = null)

@Serializable
data class EffectsState(
    val status: String? = null,
    @SerialName("effect_values") val effectValues: List<String> = emptyList(),
    @SerialName("status_values") val statusValues: List<String> = emptyList(),
)

@Serializable
data class EffectsV2Action(val effect: String? = null, @SerialName("effect_values") val effectValues: List<String> = emptyList())

@Serializable
data class EffectsV2Status(val effect: String? = null, @SerialName("effect_values") val effectValues: List<String> = emptyList())

@Serializable
data class EffectsV2State(val action: EffectsV2Action? = null, val status: EffectsV2Status? = null)

@Serializable
data class DynamicsState(val status: String? = null, val speed: Double? = null, @SerialName("speed_valid") val speedValid: Boolean? = null)

@Serializable
data class Light(
    val id: String = "",
    @SerialName("id_v1") val idV1: String? = null,
    val owner: ResourceRef? = null,
    val metadata: Metadata? = null,
    val on: OnState? = null,
    val dimming: Dimming? = null,
    @SerialName("color_temperature") val colorTemperature: ColorTemperatureState? = null,
    val color: ColorState? = null,
    val effects: EffectsState? = null,
    @SerialName("effects_v2") val effectsV2: EffectsV2State? = null,
    val dynamics: DynamicsState? = null,
    val mode: String? = null,
)

/** room, zone and bridge_home share the same shape. */
@Serializable
data class Group(
    val id: String = "",
    @SerialName("id_v1") val idV1: String? = null,
    val type: String = "",
    val metadata: Metadata? = null,
    val children: List<ResourceRef> = emptyList(),
    val services: List<ResourceRef> = emptyList(),
)

@Serializable
data class GroupedLight(
    val id: String = "",
    @SerialName("id_v1") val idV1: String? = null,
    val owner: ResourceRef? = null,
    val on: OnState? = null,
    val dimming: Dimming? = null,
    val color: ColorState? = null,
    @SerialName("color_temperature") val colorTemperature: ColorTemperatureState? = null,
)

@Serializable
data class SceneAction(val target: ResourceRef = ResourceRef(), val action: JsonObject = JsonObject(emptyMap()))

@Serializable
data class ScenePaletteColor(val color: ColorState? = null, val dimming: Dimming? = null)

@Serializable
data class ScenePaletteCt(@SerialName("color_temperature") val colorTemperature: ColorTemperatureState? = null, val dimming: Dimming? = null)

@Serializable
data class ScenePalette(
    val color: List<ScenePaletteColor> = emptyList(),
    val dimming: List<Dimming> = emptyList(),
    @SerialName("color_temperature") val colorTemperature: List<ScenePaletteCt> = emptyList(),
)

@Serializable
data class SceneStatus(val active: String? = null, @SerialName("last_recall") val lastRecall: String? = null)

@Serializable
data class Scene(
    val id: String = "",
    @SerialName("id_v1") val idV1: String? = null,
    val metadata: Metadata? = null,
    val group: ResourceRef? = null,
    val actions: List<SceneAction> = emptyList(),
    val palette: ScenePalette? = null,
    val speed: Double? = null,
    @SerialName("auto_dynamic") val autoDynamic: Boolean? = null,
    val status: SceneStatus? = null,
)

@Serializable
data class ProductData(
    @SerialName("model_id") val modelId: String? = null,
    @SerialName("manufacturer_name") val manufacturerName: String? = null,
    @SerialName("product_name") val productName: String? = null,
    @SerialName("product_archetype") val productArchetype: String? = null,
    val certified: Boolean? = null,
    @SerialName("software_version") val softwareVersion: String? = null,
    @SerialName("hardware_platform_type") val hardwarePlatformType: String? = null,
)

@Serializable
data class Device(
    val id: String = "",
    @SerialName("id_v1") val idV1: String? = null,
    @SerialName("product_data") val productData: ProductData? = null,
    val metadata: Metadata? = null,
    val services: List<ResourceRef> = emptyList(),
)

@Serializable
data class MotionReport(val changed: String? = null, val motion: Boolean? = null)

@Serializable
data class MotionState(
    val motion: Boolean? = null,
    @SerialName("motion_valid") val motionValid: Boolean? = null,
    @SerialName("motion_report") val report: MotionReport? = null,
)

@Serializable
data class Motion(val id: String = "", val owner: ResourceRef? = null, val enabled: Boolean? = null, val motion: MotionState? = null)

@Serializable
data class LightLevelReport(val changed: String? = null, @SerialName("light_level") val lightLevel: Int? = null)

@Serializable
data class LightLevelState(
    @SerialName("light_level") val lightLevel: Int? = null,
    @SerialName("light_level_valid") val valid: Boolean? = null,
    @SerialName("light_level_report") val report: LightLevelReport? = null,
)

@Serializable
data class LightLevel(val id: String = "", val owner: ResourceRef? = null, val enabled: Boolean? = null, val light: LightLevelState? = null)

@Serializable
data class TemperatureReport(val changed: String? = null, val temperature: Double? = null)

@Serializable
data class TemperatureState(
    val temperature: Double? = null,
    @SerialName("temperature_valid") val valid: Boolean? = null,
    @SerialName("temperature_report") val report: TemperatureReport? = null,
)

@Serializable
data class Temperature(val id: String = "", val owner: ResourceRef? = null, val enabled: Boolean? = null, val temperature: TemperatureState? = null)

@Serializable
data class PowerState(@SerialName("battery_state") val batteryState: String? = null, @SerialName("battery_level") val batteryLevel: Int? = null)

@Serializable
data class DevicePower(val id: String = "", val owner: ResourceRef? = null, @SerialName("power_state") val powerState: PowerState? = null)

@Serializable
data class ButtonReport(val updated: String? = null, val event: String? = null)

@Serializable
data class ButtonState(
    @SerialName("last_event") val lastEvent: String? = null,
    @SerialName("button_report") val report: ButtonReport? = null,
    @SerialName("event_values") val eventValues: List<String> = emptyList(),
)

@Serializable
data class Button(val id: String = "", val owner: ResourceRef? = null, val metadata: Metadata? = null, val button: ButtonState? = null)

@Serializable
data class ZigbeeConnectivity(val id: String = "", val owner: ResourceRef? = null, val status: String? = null, @SerialName("mac_address") val macAddress: String? = null)

@Serializable
data class TimeZone(@SerialName("time_zone") val timeZone: String? = null)

@Serializable
data class Bridge(
    val id: String = "",
    @SerialName("id_v1") val idV1: String? = null,
    val owner: ResourceRef? = null,
    @SerialName("bridge_id") val bridgeId: String? = null,
    @SerialName("time_zone") val timeZone: TimeZone? = null,
)

/** `GET /api/0/config` (unauthenticated). */
@Serializable
data class BridgeConfig(
    val name: String? = null,
    val datastoreversion: String? = null,
    val swversion: String? = null,
    val apiversion: String? = null,
    val mac: String? = null,
    val bridgeid: String? = null,
    val factorynew: Boolean? = null,
    val replacesbridgeid: String? = null,
    val modelid: String? = null,
    val starterkitid: String? = null,
)

/** Cloud discovery entry from discovery.meethue.com. */
@Serializable
data class CloudBridge(val id: String = "", val internalipaddress: String = "", val port: Int? = null)

/** v1 schedule (`/api/{key}/schedules`). */
@Serializable
data class V1ScheduleCommand(val address: String? = null, val method: String? = null, val body: JsonObject? = null)

@Serializable
data class V1Schedule(
    val name: String? = null,
    val description: String? = null,
    val command: V1ScheduleCommand? = null,
    val localtime: String? = null,
    val time: String? = null,
    val created: String? = null,
    val status: String? = null,
    val autodelete: Boolean? = null,
    val recycle: Boolean? = null,
)
