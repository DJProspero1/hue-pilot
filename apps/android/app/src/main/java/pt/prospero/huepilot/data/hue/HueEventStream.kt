package pt.prospero.huepilot.data.hue

import android.util.Log
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Response
import okhttp3.sse.EventSource
import okhttp3.sse.EventSourceListener
import okhttp3.sse.EventSources
import kotlin.coroutines.resume
import kotlin.math.min

/** One SSE event from `/eventstream/clip/v2`. */
data class HueEvent(val type: String, val data: List<JsonObject>)

enum class StreamState { DISCONNECTED, CONNECTING, CONNECTED }

/**
 * Subscribes to the bridge event stream and forwards events. Reconnects with exponential backoff.
 */
class HueEventStream(
    private val scope: CoroutineScope,
    private val onEvent: (HueEvent) -> Unit,
) {
    private var job: Job? = null
    private val _state = MutableStateFlow(StreamState.DISCONNECTED)
    val state: StateFlow<StreamState> = _state

    fun start(client: HueClient) {
        stop()
        job = scope.launch {
            var backoffMs = 1000L
            while (isActive) {
                _state.value = StreamState.CONNECTING
                val started = System.currentTimeMillis()
                try {
                    runOnce(client)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    Log.w(TAG, "event stream error: ${e.message}")
                }
                _state.value = StreamState.DISCONNECTED
                // If the connection lived for a while, reset the backoff.
                if (System.currentTimeMillis() - started > 30_000) backoffMs = 1000L
                delay(backoffMs)
                backoffMs = min(backoffMs * 2, 30_000L)
            }
        }
    }

    fun stop() {
        job?.cancel()
        job = null
        _state.value = StreamState.DISCONNECTED
    }

    private suspend fun runOnce(client: HueClient) = suspendCancellableCoroutine<Unit> { cont ->
        val factory = EventSources.createFactory(client.streamHttp)
        val source = factory.newEventSource(client.eventStreamRequest(), object : EventSourceListener() {
            override fun onOpen(eventSource: EventSource, response: Response) {
                _state.value = StreamState.CONNECTED
            }

            override fun onEvent(eventSource: EventSource, id: String?, type: String?, data: String) {
                parse(data).forEach(onEvent)
            }

            override fun onClosed(eventSource: EventSource) {
                if (cont.isActive) cont.resume(Unit)
            }

            override fun onFailure(eventSource: EventSource, t: Throwable?, response: Response?) {
                Log.w(TAG, "SSE failure: ${t?.message} / ${response?.code}")
                if (cont.isActive) cont.resume(Unit)
            }
        })
        cont.invokeOnCancellation { source.cancel() }
    }

    private fun parse(data: String): List<HueEvent> {
        val element = runCatching { HueJson.parseToJsonElement(data) }.getOrNull() ?: return emptyList()
        val arr = element as? JsonArray ?: return emptyList()
        return arr.mapNotNull { ev ->
            val obj = ev as? JsonObject ?: return@mapNotNull null
            val type = obj["type"]?.jsonPrimitive?.content ?: "update"
            val list = obj["data"]?.let { runCatching { it.jsonArray }.getOrNull() }?.mapNotNull { runCatching { it.jsonObject }.getOrNull() }
                ?: emptyList()
            HueEvent(type, list)
        }
    }

    companion object {
        private const val TAG = "HueEventStream"
    }
}
