package pt.prospero.huepilot.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import pt.prospero.huepilot.AppContainer
import pt.prospero.huepilot.assistant.AssistantProvider
import pt.prospero.huepilot.assistant.ModelInfo
import pt.prospero.huepilot.data.settings.ThemeMode

data class ProviderUiState(
    val models: List<ModelInfo> = emptyList(),
    val fetching: Boolean = false,
    val error: String? = null,
)

data class SettingsUiState(
    val providers: Map<AssistantProvider, ProviderUiState> = emptyMap(),
) {
    fun provider(p: AssistantProvider): ProviderUiState = providers[p] ?: ProviderUiState()
}

class SettingsViewModel(private val container: AppContainer) : ViewModel() {
    val settings = container.settingsState
    val repoStatus = container.repository.status
    val snapshot = container.repository.snapshot

    private val _ui = MutableStateFlow(SettingsUiState())
    val ui: StateFlow<SettingsUiState> = _ui

    private fun updateProvider(p: AssistantProvider, f: (ProviderUiState) -> ProviderUiState) =
        _ui.update { it.copy(providers = it.providers + (p to f(it.provider(p)))) }

    fun setAssistantProvider(p: AssistantProvider) = viewModelScope.launch { container.settings.setAssistantProvider(p) }

    fun saveProvider(p: AssistantProvider, apiKey: String, model: String) = viewModelScope.launch {
        container.settings.setProviderConfig(p, apiKey, model.ifBlank { p.defaultModel })
    }

    fun fetchModels(p: AssistantProvider, apiKey: String) = viewModelScope.launch {
        updateProvider(p) { it.copy(fetching = true, error = null) }
        try {
            val models = container.providers.adapter(p).listModels(apiKey)
            updateProvider(p) { it.copy(models = models, fetching = false, error = if (models.isEmpty()) "No tool-capable models returned" else null) }
        } catch (e: Exception) {
            updateProvider(p) { it.copy(fetching = false, error = e.message ?: "Could not fetch models") }
        }
    }

    fun setTheme(mode: ThemeMode) = viewModelScope.launch { container.settings.setTheme(mode) }
    fun setWallpaperColors(on: Boolean) = viewModelScope.launch { container.settings.setWallpaperColors(on) }
    fun setTransitionMs(ms: Int) = viewModelScope.launch { container.settings.setTransitionMs(ms) }
    fun setSpeakReplies(on: Boolean) = viewModelScope.launch { container.settings.setSpeakReplies(on) }
    fun forgetBridge() = viewModelScope.launch { container.repository.disconnect(); container.settings.forgetBridge() }
}
