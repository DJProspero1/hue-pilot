package pt.prospero.huepilot

import com.google.common.truth.Truth.assertThat
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import pt.prospero.huepilot.data.hue.AccessoryUi
import pt.prospero.huepilot.data.hue.GroupKind
import pt.prospero.huepilot.data.hue.GroupUi
import pt.prospero.huepilot.data.hue.SceneUi
import pt.prospero.huepilot.data.hue.SnapshotBuilder
import pt.prospero.huepilot.widget.SnapshotCache
import pt.prospero.huepilot.widget.WidgetConfig
import pt.prospero.huepilot.widget.WidgetLogic
import java.io.File

class WidgetLogicTest {

    @get:Rule
    val tmp = TemporaryFolder()

    // ---- colours ----

    @Test
    fun parseHex_acceptsSixAndEightDigits() {
        assertThat(WidgetLogic.parseHex("#ff8800")).isEqualTo(0xFFFF8800.toInt())
        assertThat(WidgetLogic.parseHex("ff8800")).isEqualTo(0xFFFF8800.toInt())
        assertThat(WidgetLogic.parseHex("#80ff8800")).isEqualTo(0x80FF8800.toInt())
        assertThat(WidgetLogic.parseHex("nope")).isNull()
        assertThat(WidgetLogic.parseHex(null)).isNull()
    }

    @Test
    fun blend_interpolatesEachChannel() {
        val black = 0xFF000000.toInt()
        val white = 0xFFFFFFFF.toInt()
        assertThat(WidgetLogic.blend(black, white, 0f)).isEqualTo(black)
        assertThat(WidgetLogic.blend(black, white, 1f)).isEqualTo(white)
        assertThat(WidgetLogic.blend(black, white, 0.5f)).isEqualTo(0xFF808080.toInt())
        // Alpha is clamped and the result is always opaque.
        assertThat(WidgetLogic.blend(black, 0x00FF0000, 2f)).isEqualTo(0xFFFF0000.toInt())
    }

    @Test
    fun tileTint_offIsNeutral_onBlendsAt28Percent_andStaysDarkEnoughForLightText() {
        assertThat(WidgetLogic.tileTint(false, "#00ffff")).isEqualTo(WidgetLogic.TILE)
        val cyan = WidgetLogic.tileTint(true, "#00ffff")
        assertThat(cyan).isEqualTo(WidgetLogic.blend(WidgetLogic.TILE, 0xFF00FFFF.toInt(), 0.28f))
        // No colour → warm white.
        assertThat(WidgetLogic.tileTint(true, null)).isEqualTo(WidgetLogic.blend(WidgetLogic.TILE, WidgetLogic.WARM_WHITE, 0.28f))
        // Even the brightest tint keeps the tile dark: contrast with #F5EFE6 text stays above 4.5:1.
        val brightest = WidgetLogic.tileTint(true, "#ffffff")
        val contrast = (WidgetLogic.luminance(0xFFF5EFE6.toInt()) + 0.05) / (WidgetLogic.luminance(brightest) + 0.05)
        assertThat(contrast).isGreaterThan(4.5)
    }

    @Test
    fun gradientStops_alwaysAtLeastTwo_andEvenlySpaced() {
        assertThat(WidgetLogic.gradientStops(emptyList())).hasSize(2)
        val single = WidgetLogic.gradientStops(listOf("#ff0000"))
        assertThat(single[0]).isEqualTo(0xFFFF0000.toInt())
        assertThat(single[1]).isEqualTo(WidgetLogic.blend(0xFFFF0000.toInt(), 0xFF000000.toInt(), 0.45f))
        val many = WidgetLogic.gradientStops(listOf("#ff0000", "#00ff00", "#0000ff", "bad", "#ffffff", "#000000", "#123456"))
        assertThat(many).containsExactly(0xFFFF0000.toInt(), 0xFF00FF00.toInt(), 0xFF0000FF.toInt(), 0xFFFFFFFF.toInt(), 0xFF000000.toInt()).inOrder()
        assertThat(WidgetLogic.stopPositions(3).toList()).containsExactly(0f, 0.5f, 1f).inOrder()
        assertThat(WidgetLogic.stopPositions(1).toList()).containsExactly(0f)
    }

    // ---- text ----

    @Test
    fun relativeTime_formatsMinutesHoursDays() {
        val now = 1_700_000_000_000L
        val iso = java.time.Instant.ofEpochMilli(now - 5 * 60_000).toString()
        assertThat(WidgetLogic.relativeTime(iso, now)).isEqualTo("5 min ago")
        assertThat(WidgetLogic.relativeTime(java.time.Instant.ofEpochMilli(now - 3 * 3_600_000).toString(), now)).isEqualTo("3 h ago")
        assertThat(WidgetLogic.relativeTime(java.time.Instant.ofEpochMilli(now - 2 * 86_400_000).toString(), now)).isEqualTo("2 d ago")
        assertThat(WidgetLogic.relativeTime(java.time.Instant.ofEpochMilli(now - 10_000).toString(), now)).isEqualTo("just now")
        // Hue timestamps without a zone are treated as UTC.
        assertThat(WidgetLogic.relativeTime("2023-11-14T22:03:20", now)).isEqualTo("10 min ago")
        assertThat(WidgetLogic.relativeTime("garbage", now)).isEmpty()
        assertThat(WidgetLogic.relativeTime(null, now)).isEmpty()
    }

    @Test
    fun onLabel() {
        assertThat(WidgetLogic.onLabel(0, 4)).isEqualTo("Off")
        assertThat(WidgetLogic.onLabel(3, 4)).isEqualTo("3 of 4 on")
        assertThat(WidgetLogic.onLabel(4, 4)).isEqualTo("All 4 on")
        assertThat(WidgetLogic.onLabel(1, 1)).isEqualTo("On")
        assertThat(WidgetLogic.onLabel(0, 0)).isEqualTo("No lights")
    }

    // ---- selection rules ----

    private fun group(id: String, name: String = id, kind: GroupKind = GroupKind.ROOM) =
        GroupUi(id, null, name, kind, null, "gl-$id", false, 0.0, emptyList(), emptyList())

    private fun scene(id: String, groupId: String) = SceneUi(id, null, id, groupId, "room", groupId, "inactive", emptyList(), null, false, emptyList())

    @Test
    fun chooseGroups_prefersConfig_thenFavourites_thenAll() {
        val groups = listOf(group("a"), group("b"), group("c"))
        assertThat(WidgetLogic.chooseGroups(groups, listOf("c", "a", "missing"), listOf("b")).map { it.id }).containsExactly("c", "a").inOrder()
        assertThat(WidgetLogic.chooseGroups(groups, emptyList(), listOf("b")).map { it.id }).containsExactly("b")
        assertThat(WidgetLogic.chooseGroups(groups, emptyList(), emptyList()).map { it.id }).containsExactly("a", "b", "c").inOrder()
        assertThat(WidgetLogic.defaultGroup(groups, listOf("zzz", "b"))?.id).isEqualTo("b")
        assertThat(WidgetLogic.defaultGroup(groups, emptyList())?.id).isEqualTo("a")
    }

    @Test
    fun chooseScenes_byGroup_thenFavourites_thenAll() {
        val scenes = listOf(scene("s1", "a"), scene("s2", "b"), scene("s3", "b"))
        assertThat(WidgetLogic.chooseScenes(scenes, "b", emptyList()).map { it.id }).containsExactly("s2", "s3")
        assertThat(WidgetLogic.chooseScenes(scenes, null, listOf("a")).map { it.id }).containsExactly("s1")
        assertThat(WidgetLogic.chooseScenes(scenes, null, emptyList())).hasSize(3)
    }

    @Test
    fun sensorDevices_camerasFirst_bridgeExcluded() {
        fun acc(name: String, product: String?, motionId: String?, bridge: Boolean = false) = AccessoryUi(
            deviceId = name, idV1 = null, name = name, productName = product, modelId = null, archetype = null, softwareVersion = null, isBridge = bridge,
            batteryLevel = null, batteryState = null, motionId = motionId, motion = null, motionEnabled = null, motionUpdated = null,
            temperatureId = null, temperatureC = null, temperatureUpdated = null, lightLevelId = null, lightLevelRaw = null, lightLevelUpdated = null,
            buttons = emptyList(), connectivity = null,
        )
        val list = listOf(acc("Zeta sensor", "Hue motion sensor", "m1"), acc("Bridge", "Hue Bridge", null, bridge = true), acc("Front camera", "Hue Secure camera", "m2"), acc("Dimmer", "Hue dimmer switch", null))
        assertThat(WidgetLogic.sensorDevices(list).map { it.name }).containsExactly("Front camera", "Zeta sensor").inOrder()
        assertThat(WidgetLogic.isCamera("Hue Secure Camera")).isTrue()
        assertThat(WidgetLogic.isCamera(null)).isFalse()
    }

    @Test
    fun gridDimensionsFollowTheSizeBuckets() {
        assertThat(WidgetLogic.cellsWide(110f)).isEqualTo(2)
        assertThat(WidgetLogic.cellsWide(250f)).isEqualTo(4)
        assertThat(WidgetLogic.cellsTall(40f)).isEqualTo(1)
        assertThat(WidgetLogic.cellsTall(120f)).isEqualTo(2)
        assertThat(WidgetLogic.cellsTall(280f)).isEqualTo(4)
        assertThat(WidgetLogic.gridColumns(40f)).isEqualTo(2)
        assertThat(WidgetLogic.gridRows(200f)).isEqualTo(3)
        // 7 rooms: 4×4 widget → 2 wide columns × 4 rows; 4×2 → 4 × 2; 2×2 → 2 × 2 (4 shown); 1 row → 2 columns minimum.
        assertThat(WidgetLogic.gridFor(7, 4, 4)).isEqualTo(2 to 4)
        assertThat(WidgetLogic.gridFor(7, 4, 2)).isEqualTo(4 to 2)
        assertThat(WidgetLogic.gridFor(7, 2, 2)).isEqualTo(2 to 2)
        assertThat(WidgetLogic.gridFor(1, 4, 1)).isEqualTo(2 to 1)
        assertThat(WidgetLogic.gridFor(3, 4, 4)).isEqualTo(2 to 2)
        assertThat(WidgetLogic.gridFor(0, 3, 2)).isEqualTo(3 to 1)
    }

    @Test
    fun quickColorsComeFromTheAppPalette() {
        val eight = WidgetLogic.quickColors(WidgetLogic.QUICK_8)
        assertThat(eight).hasSize(8)
        assertThat(eight.first()).isEqualTo("Warm" to "#ffb46b")
        assertThat(WidgetLogic.quickColors(listOf("Nope"))).isEmpty()
    }

    // ---- config encode / decode ----

    @Test
    fun widgetConfig_roundTrips_andToleratesGarbage() {
        val c = WidgetConfig(groupId = "g1", lightId = null, groupIds = listOf("a", "b"))
        assertThat(WidgetConfig.decode(c.encode())).isEqualTo(c)
        assertThat(WidgetConfig.EMPTY.encode()).isEqualTo("{}")
        assertThat(WidgetConfig.decode(null)).isEqualTo(WidgetConfig.EMPTY)
        assertThat(WidgetConfig.decode("not json")).isEqualTo(WidgetConfig.EMPTY)
        assertThat(WidgetConfig.decode("""{"groupId":"x","future":1}""")).isEqualTo(WidgetConfig(groupId = "x"))
        assertThat(WidgetConfig(lightId = "l").isEmpty).isFalse()
        assertThat(WidgetConfig.EMPTY.isEmpty).isTrue()
    }

    // ---- snapshot cache ----

    @Test
    fun snapshotCache_roundTripsResources_andRebuildsTheSnapshot() {
        val file = File(tmp.root, "sub/widget_snapshot.json")
        val cache = SnapshotCache(file)
        assertThat(cache.load()).isNull()
        val light = buildJsonObject {
            put("id", "l1"); put("type", "light")
            putJsonObject("metadata") { put("name", "Desk") }
            putJsonObject("on") { put("on", true) }
            putJsonObject("dimming") { put("brightness", 55.0) }
        }
        val room = buildJsonObject {
            put("id", "r1"); put("type", "room")
            putJsonObject("metadata") { put("name", "Office"); put("archetype", "office") }
            put("children", kotlinx.serialization.json.buildJsonArray { add(buildJsonObject { put("rid", "l1"); put("rtype", "light") }) })
            put("services", kotlinx.serialization.json.buildJsonArray { add(buildJsonObject { put("rid", "gl1"); put("rtype", "grouped_light") }) })
        }
        val resources = linkedMapOf("l1" to light, "r1" to room)
        cache.save(resources, now = 42L)
        assertThat(file.exists()).isTrue()
        assertThat(File(tmp.root, "sub/widget_snapshot.json.tmp").exists()).isFalse()

        val loaded = cache.load()!!
        assertThat(loaded.savedAt).isEqualTo(42L)
        assertThat(loaded.resources).isEqualTo(resources)
        assertThat(loaded.resources.keys.toList()).containsExactly("l1", "r1").inOrder()

        val snap = SnapshotBuilder.build(loaded.resources)
        assertThat(snap.rooms.single().name).isEqualTo("Office")
        assertThat(snap.rooms.single().lightsOn).isEqualTo(1)
        assertThat(snap.lights.single().brightness).isEqualTo(55.0)

        // Overwriting works (atomic replace) and corrupt files are ignored.
        cache.save(linkedMapOf("l1" to light), now = 43L)
        assertThat(cache.load()!!.resources.keys).containsExactly("l1")
        file.writeText("{corrupt")
        assertThat(cache.load()).isNull()
        cache.clear()
        assertThat(file.exists()).isFalse()
    }
}
