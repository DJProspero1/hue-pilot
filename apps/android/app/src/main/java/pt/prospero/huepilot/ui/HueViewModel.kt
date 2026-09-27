package pt.prospero.huepilot.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import pt.prospero.huepilot.AppContainer
import pt.prospero.huepilot.data.hue.AccessoryUi
import pt.prospero.huepilot.data.hue.GroupUi
import pt.prospero.huepilot.data.hue.HomeSnapshot
import pt.prospero.huepilot.data.hue.LightUi
import pt.prospero.huepilot.data.hue.RepoStatus
import pt.prospero.huepilot.data.hue.StreamState
import pt.prospero.huepilot.data.settings.AppSettings
import pt.prospero.huepilot.domain.XY
import pt.prospero.huepilot.ui.assistant.AssistantViewModel
import pt.prospero.huepilot.ui.onboarding.OnboardingViewModel
import pt.prospero.huepilot.ui.settings.SettingsViewModel
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonObject

/** Shared view model for every bridge-backed screen. */
class HueViewModel(private val container: AppContainer) : ViewModel() {
    private val repo = container.repository

    val snapshot: StateFlow<HomeSnapshot> = repo.snapshot
    val status: StateFlow<RepoStatus> = repo.status
    val streamState: StateFlow<StreamState> = repo.streamState
    val settings: StateFlow<AppSettings> = container.settingsState

    private val _messages = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val messages: SharedFlow<String> = _messages

    private fun run(block: suspend () -> Unit) {
        viewModelScope.launch {
            try {
                block()
            } catch (e: Exception) {
                _messages.tryEmit(e.message ?: "Something went wrong")
            }
        }
    }

    fun refresh() = run { repo.refresh() }

    // Groups
    fun setGroupOn(group: GroupUi, on: Boolean) = run {
        val gl = group.groupedLightId
        if (gl != null) repo.setGroupOn(gl, on) else group.lights.forEach { repo.setLightOn(it.id, on) }
    }

    fun setGroupBrightness(group: GroupUi, value: Double) = run {
        val gl = group.groupedLightId
        if (gl != null) repo.setGroupBrightness(gl, value) else group.lights.forEach { repo.setLightBrightness(it.id, value) }
    }

    fun setGroupColor(group: GroupUi, xy: XY?, mirek: Int?) = run { repo.setGroupColor(group, xy, mirek) }

    fun setAllOn(on: Boolean) = run {
        val gl = snapshot.value.bridgeHomeGroupedLightId
        if (gl != null) repo.setGroupOn(gl, on) else snapshot.value.rooms.forEach { g -> g.groupedLightId?.let { repo.setGroupOn(it, on) } }
    }

    // Lights
    fun setLightOn(light: LightUi, on: Boolean) = run { repo.setLightOn(light.id, on) }
    fun setLightBrightness(light: LightUi, value: Double) = run { repo.setLightBrightness(light.id, value) }
    fun setLightColor(light: LightUi, xy: XY) = run { repo.setLightColor(light.id, xy) }
    fun setLightMirek(light: LightUi, mirek: Int) = run { repo.setLightMirek(light.id, mirek.coerceIn(light.mirekMin, light.mirekMax)) }
    fun setLightEffect(light: LightUi, effect: String) = run { repo.setLightEffect(light.id, effect, light.usesEffectsV2) }
    fun identify(light: LightUi) = run { repo.identifyLight(light.id); _messages.tryEmit("${light.name} is blinking") }
    fun renameLight(light: LightUi, name: String) = run { if (name.isNotBlank()) repo.renameLight(light.id, name) }

    // Scenes
    fun recallScene(sceneId: String, dynamic: Boolean = false) = run { repo.recallScene(sceneId, dynamic) }
    fun renameScene(sceneId: String, name: String) = run { if (name.isNotBlank()) repo.renameScene(sceneId, name) }
    fun deleteScene(sceneId: String) = run { repo.deleteScene(sceneId); _messages.tryEmit("Scene deleted") }
    fun saveScene(group: GroupUi, name: String) = run {
        if (name.isBlank()) return@run
        repo.saveCurrentAsScene(group, name)
        _messages.tryEmit("Scene \"$name\" saved")
    }

    // Accessories
    fun setMotionEnabled(accessory: AccessoryUi, enabled: Boolean) = run {
        val id = accessory.motionId ?: return@run
        repo.setMotionEnabled(id, enabled, accessory.motionType ?: "motion")
    }
    fun setMotionAutomationEnabled(id: String, enabled: Boolean) = run {
        val snap = repo.snapshot.value
        val a = snap.motionAutomations.firstOrNull { it.id == id }
        val r = snap.routines.firstOrNull { it.id == id }
        val name = a?.name ?: r?.name ?: return@run
        val configuration = a?.configuration ?: r!!.configuration
        // The bridge refuses an enabled-only PUT; the whole rule goes back with the flag.
        repo.updateBehaviorInstance(id, buildJsonObject { put("enabled", enabled); putJsonObject("metadata") { put("name", name) }; put("configuration", configuration) })
    }
    fun deleteMotionAutomation(id: String) = run { repo.deleteBehaviorInstance(id) }
    fun renameDevice(deviceId: String, name: String) = run { if (name.isNotBlank()) repo.renameDevice(deviceId, name) }

    fun toggleFavouriteRoom(roomId: String) = run {
        val current = settings.value.favouriteRoomIds
        val next = if (roomId in current) current - roomId else (current + roomId).takeLast(4)
        container.settings.setFavouriteRooms(next)
    }
}

/** Creates every view model of the app from the [AppContainer]. */
class HueViewModelFactory(private val container: AppContainer) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T = when {
        modelClass.isAssignableFrom(HueViewModel::class.java) -> HueViewModel(container) as T
        modelClass.isAssignableFrom(AssistantViewModel::class.java) -> AssistantViewModel(container) as T
        modelClass.isAssignableFrom(OnboardingViewModel::class.java) -> OnboardingViewModel(container) as T
        modelClass.isAssignableFrom(SettingsViewModel::class.java) -> SettingsViewModel(container) as T
        else -> throw IllegalArgumentException("Unknown ViewModel ${modelClass.name}")
    }
}
