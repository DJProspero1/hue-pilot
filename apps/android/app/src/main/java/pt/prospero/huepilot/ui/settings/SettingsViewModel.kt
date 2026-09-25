package pt.prospero.huepilot.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import pt.prospero.huepilot.AppContainer
import pt.prospero.huepilot.assistant.GeminiModel
import pt.prospero.huepilot.data.settings.ThemeMode

data class SettingsUiState(
    val models: List<GeminiModel> = emptyList(),
    val fetchingModels: Boolean = false,
    val modelsError: String? = null,
    val saved: Boolean = false,
)

class SettingsViewModel(private val container: AppContainer) : ViewModel() {
    val settings = container.settingsState
    val repoStatus = container.repository.status
    val snapshot = container.repository.snapshot

    private val _ui = MutableStateFlow(SettingsUiState())
    val ui: StateFlow<SettingsUiState> = _ui

    fun saveGemini(apiKey: String, model: String) = viewModelScope.launch {
        container.settings.setGemini(apiKey, model.ifBlank { "gemini-2.5-flash" })
        _ui.update { it.copy(saved = true) }
    }

    fun fetchModels(apiKey: String) = viewModelScope.launch {
        _ui.update { it.copy(fetchingModels = true, modelsError = null) }
        try {
            val models = container.gemini.listModels(apiKey)
            _ui.update { it.copy(models = models, fetchingModels = false, modelsError = if (models.isEmpty()) "No models returned" else null) }
        } catch (e: Exception) {
            _ui.update { it.copy(fetchingModels = false, modelsError = e.message ?: "Could not fetch models") }
        }
    }

    fun setTheme(mode: ThemeMode) = viewModelScope.launch { container.settings.setTheme(mode) }
    fun setTransitionMs(ms: Int) = viewModelScope.launch { container.settings.setTransitionMs(ms) }
    fun setSpeakReplies(on: Boolean) = viewModelScope.launch { container.settings.setSpeakReplies(on) }
    fun forgetBridge() = viewModelScope.launch { container.repository.disconnect(); container.settings.forgetBridge() }
}
