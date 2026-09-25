package pt.prospero.huepilot.ui.onboarding

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import pt.prospero.huepilot.AppContainer
import pt.prospero.huepilot.data.hue.BridgeConnection
import pt.prospero.huepilot.data.hue.DiscoveredBridge
import pt.prospero.huepilot.data.hue.HueClient
import pt.prospero.huepilot.data.hue.HueDiscovery
import pt.prospero.huepilot.data.hue.HueException

sealed class PairingState {
    data object Idle : PairingState()
    data class InProgress(val bridge: DiscoveredBridge, val secondsLeft: Int) : PairingState()
    data class Failed(val message: String) : PairingState()
    data object Success : PairingState()
}

data class OnboardingState(
    val discovering: Boolean = false,
    val bridges: List<DiscoveredBridge> = emptyList(),
    val manualHost: String = "",
    val manualPort: String = "443",
    val manualHttps: Boolean = true,
    val showAdvanced: Boolean = false,
    val probing: Boolean = false,
    val error: String? = null,
    val pairing: PairingState = PairingState.Idle,
)

class OnboardingViewModel(private val container: AppContainer) : ViewModel() {
    private val _state = MutableStateFlow(OnboardingState())
    val state: StateFlow<OnboardingState> = _state
    private var pairingJob: Job? = null

    init { discover() }

    fun discover() {
        if (_state.value.discovering) return
        _state.update { it.copy(discovering = true, error = null) }
        viewModelScope.launch {
            val found = LinkedHashMap<String, DiscoveredBridge>()
            fun key(b: DiscoveredBridge) = "${b.host}:${b.port}"
            val cloud = async { HueDiscovery.discoverCloud() }
            val mdns = async {
                val list = ArrayList<DiscoveredBridge>()
                withTimeoutOrNull(6000) { HueDiscovery.discoverMdns(container.appContext).collect { list += it } }
                list
            }
            for (b in cloud.await()) found[key(b)] = b
            for (b in mdns.await()) found[key(b)] = found[key(b)]?.let { old -> old.copy(name = old.name ?: b.name, modelId = old.modelId ?: b.modelId) } ?: b
            // Probe each bridge for its name/model (also validates reachability).
            val probed = found.values.map { b -> async { HueDiscovery.probe(b) ?: b } }.map { it.await() }
            _state.update { it.copy(discovering = false, bridges = probed) }
        }
    }

    fun setManualHost(v: String) = _state.update { it.copy(manualHost = v, error = null) }
    fun setManualPort(v: String) = _state.update { it.copy(manualPort = v.filter { c -> c.isDigit() }.take(5)) }
    fun setManualHttps(v: Boolean) = _state.update {
        val port = when {
            v && it.manualPort == "80" -> "443"
            !v && it.manualPort == "443" -> "80"
            else -> it.manualPort
        }
        it.copy(manualHttps = v, manualPort = port)
    }
    fun toggleAdvanced() = _state.update { it.copy(showAdvanced = !it.showAdvanced) }

    /** Validates the manual entry by probing `/api/0/config`, then starts pairing. */
    fun connectManual() {
        val s = _state.value
        val host = s.manualHost.trim()
        if (host.isEmpty()) { _state.update { it.copy(error = "Enter the bridge IP address") }; return }
        val port = s.manualPort.toIntOrNull() ?: (if (s.manualHttps) 443 else 80)
        val candidate = DiscoveredBridge(host = host, port = port, useHttps = s.manualHttps, source = "manual")
        _state.update { it.copy(probing = true, error = null) }
        viewModelScope.launch {
            val probed = HueDiscovery.probe(candidate)
            _state.update { it.copy(probing = false) }
            if (probed == null) {
                _state.update { it.copy(error = "No Hue bridge answered at ${candidate.host}:${candidate.port} (${if (s.manualHttps) "https" else "http"})") }
            } else {
                startPairing(probed)
            }
        }
    }

    fun startPairing(bridge: DiscoveredBridge) {
        pairingJob?.cancel()
        pairingJob = viewModelScope.launch {
            val total = 60
            val start = System.currentTimeMillis()
            _state.update { it.copy(pairing = PairingState.InProgress(bridge, total), error = null) }
            while (true) {
                val elapsed = ((System.currentTimeMillis() - start) / 1000).toInt()
                val left = total - elapsed
                if (left <= 0) {
                    _state.update { it.copy(pairing = PairingState.Failed("The link button was not pressed in time. Try again.")) }
                    return@launch
                }
                _state.update { it.copy(pairing = PairingState.InProgress(bridge, left)) }
                try {
                    val result = HueClient.tryPair(bridge.host, bridge.port, bridge.useHttps)
                    if (result != null) {
                        container.settings.saveBridge(
                            BridgeConnection(
                                host = bridge.host,
                                port = bridge.port,
                                useHttps = bridge.useHttps,
                                appKey = result.username,
                                clientKey = result.clientKey,
                                bridgeId = bridge.id,
                                bridgeName = bridge.name,
                            )
                        )
                        _state.update { it.copy(pairing = PairingState.Success) }
                        return@launch
                    }
                } catch (e: HueException) {
                    _state.update { it.copy(pairing = PairingState.Failed(e.message ?: "Pairing failed")) }
                    return@launch
                } catch (e: Exception) {
                    // Network hiccup: keep trying until the timeout.
                }
                delay(1500)
            }
        }
    }

    fun cancelPairing() {
        pairingJob?.cancel()
        _state.update { it.copy(pairing = PairingState.Idle) }
    }
}
