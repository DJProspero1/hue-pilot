package pt.prospero.huepilot.ui.assistant

import android.speech.tts.TextToSpeech
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonObject
import pt.prospero.huepilot.AppContainer
import pt.prospero.huepilot.assistant.AssistantEngine
import pt.prospero.huepilot.assistant.AssistantEvent
import pt.prospero.huepilot.assistant.AssistantProvider
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.UUID

sealed class ChatItem {
    abstract val id: String
    data class User(val text: String, override val id: String = UUID.randomUUID().toString()) : ChatItem()
    data class Assistant(val text: String, override val id: String = UUID.randomUUID().toString()) : ChatItem()
    data class Tool(val name: String, val label: String, val ok: Boolean, val args: JsonObject, override val id: String = UUID.randomUUID().toString()) : ChatItem()
    data class Error(val text: String, override val id: String = UUID.randomUUID().toString()) : ChatItem()
}

data class AssistantState(
    val items: List<ChatItem> = emptyList(),
    val busy: Boolean = false,
    val input: String = "",
    val listening: Boolean = false,
)

class AssistantViewModel(private val container: AppContainer) : ViewModel() {
    private val _state = MutableStateFlow(AssistantState())
    val state: StateFlow<AssistantState> = _state
    val settings = container.settingsState

    private val engine = AssistantEngine(container.tools)

    private var tts: TextToSpeech? = null
    private var ttsReady = false

    val suggestions = listOf(
        "Turn on the office",
        "Set the living room to warm white at 40%",
        "Activate the Relax scene in the bedroom",
        "Turn everything off",
        "What's on right now?",
        "Start the candle effect in the bedroom",
    )

    init {
        tts = TextToSpeech(container.appContext) { status ->
            ttsReady = status == TextToSpeech.SUCCESS
            if (ttsReady) tts?.language = Locale.getDefault()
        }
        // Histories are provider-specific: switching provider or model starts a fresh conversation.
        viewModelScope.launch {
            settings.filter { it.loaded }
                .map { it.assistantProvider to it.activeConfig.model }
                .distinctUntilChanged()
                .drop(1)
                .collect { clear() }
        }
    }

    fun setInput(text: String) = _state.update { it.copy(input = text) }
    fun setListening(v: Boolean) = _state.update { it.copy(listening = v) }
    fun setSpeakReplies(on: Boolean) { viewModelScope.launch { container.settings.setSpeakReplies(on) }; if (!on) tts?.stop() }
    fun clear() { engine.reset(); _state.update { AssistantState(input = it.input) } }

    /** Quick provider switch from the chat header; the conversation is reset by the settings observer. */
    fun switchProvider(provider: AssistantProvider) {
        viewModelScope.launch { container.settings.setAssistantProvider(provider) }
    }

    fun send(textIn: String? = null) {
        val text = (textIn ?: _state.value.input).trim()
        if (text.isEmpty() || _state.value.busy) return
        _state.update { it.copy(items = it.items + ChatItem.User(text), input = "", busy = true) }
        viewModelScope.launch {
            val s = settings.value
            val provider = s.assistantProvider
            val config = s.provider(provider)
            if (!config.hasKey) {
                _state.update { it.copy(items = it.items + ChatItem.Error("No ${provider.label} API key configured. Open Settings and add your key."), busy = false) }
                return@launch
            }
            engine.ask(text, systemInstruction(), container.providers.adapter(provider), config) { event ->
                when (event) {
                    is AssistantEvent.ToolCall -> _state.update { it.copy(items = it.items + ChatItem.Tool(event.name, event.label, event.ok, event.args)) }
                    is AssistantEvent.Answer -> { _state.update { it.copy(items = it.items + ChatItem.Assistant(event.text)) }; speak(event.text) }
                    is AssistantEvent.Failure -> _state.update { it.copy(items = it.items + ChatItem.Error(event.message)) }
                }
            }
            _state.update { it.copy(busy = false) }
        }
    }

    private fun systemInstruction(): String {
        val now = ZonedDateTime.now().format(DateTimeFormatter.ofPattern("EEEE d MMMM yyyy, HH:mm"))
        return """
            You are Hue Pilot, a friendly assistant that controls the user's Philips Hue lights through tools.
            Current date/time: $now.
            Rules:
            - Use the tools to act; never claim something was done unless a tool call succeeded.
            - Resolve rooms, lights and scenes by name; if a tool answers "ambiguous" or "not_found", ask the user to choose using the candidates/available list.
            - When the user gives several instructions, call several tools.
            - Answer in one or two short sentences, in the user's language. No markdown tables.
            - Brightness is percent. Colours may be names, hex, or white presets like warm/relax/cool/daylight.
            - Prefer set_room for whole rooms and set_light for single lights. Use set_all_lights for "everything".
            - You may call get_home_overview to look up the current state before acting when unsure.
            The home right now:
        """.trimIndent() + "\n" + container.tools.homeDescription()
    }

    private fun speak(text: String) {
        if (!settings.value.speakReplies || !ttsReady) return
        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "hue-pilot-reply")
    }

    override fun onCleared() {
        tts?.shutdown()
        tts = null
    }
}
