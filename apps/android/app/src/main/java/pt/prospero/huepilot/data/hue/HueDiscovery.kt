package pt.prospero.huepilot.data.hue

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.withContext
import kotlinx.serialization.builtins.ListSerializer
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.concurrent.TimeUnit

/** A bridge found on the network, before pairing. */
data class DiscoveredBridge(
    val host: String,
    val port: Int = 443,
    val useHttps: Boolean = true,
    val id: String? = null,
    val name: String? = null,
    val modelId: String? = null,
    val swVersion: String? = null,
    val source: String = "manual",
)

/** Bridge discovery via the Hue cloud broker and mDNS (`_hue._tcp.`). */
object HueDiscovery {
    private const val TAG = "HueDiscovery"

    /** A regular (certificate-verifying) client. Never the trust-all bridge client. */
    private val cloudHttp = OkHttpClient.Builder()
        .connectTimeout(6, TimeUnit.SECONDS)
        .readTimeout(8, TimeUnit.SECONDS)
        .build()

    suspend fun discoverCloud(): List<DiscoveredBridge> = withContext(Dispatchers.IO) {
        try {
            val req = Request.Builder().url("https://discovery.meethue.com/").get().build()
            cloudHttp.newCall(req).execute().use { resp ->
                if (!resp.isSuccessful) return@withContext emptyList()
                val text = resp.body?.string().orEmpty()
                val list = HueJson.decodeFromString(ListSerializer(CloudBridge.serializer()), text)
                list.filter { it.internalipaddress.isNotBlank() }.map {
                    DiscoveredBridge(host = it.internalipaddress, port = it.port ?: 443, id = it.id, source = "cloud")
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "cloud discovery failed: ${e.message}")
            emptyList()
        }
    }

    /** Emits bridges as mDNS resolves them. Collect with a timeout. */
    fun discoverMdns(context: Context): Flow<DiscoveredBridge> = callbackFlow {
        val nsd = context.getSystemService(Context.NSD_SERVICE) as? NsdManager
        if (nsd == null) {
            close(); return@callbackFlow
        }
        val listener = object : NsdManager.DiscoveryListener {
            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) { close() }
            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {}
            override fun onDiscoveryStarted(serviceType: String) {}
            override fun onDiscoveryStopped(serviceType: String) {}
            override fun onServiceLost(serviceInfo: NsdServiceInfo) {}
            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                @Suppress("DEPRECATION")
                nsd.resolveService(serviceInfo, object : NsdManager.ResolveListener {
                    override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {}
                    override fun onServiceResolved(info: NsdServiceInfo) {
                        @Suppress("DEPRECATION")
                        val host = info.host?.hostAddress ?: return
                        val attrs = info.attributes ?: emptyMap()
                        val id = attrs["bridgeid"]?.let { String(it) }
                        val model = attrs["modelid"]?.let { String(it) }
                        trySend(
                            DiscoveredBridge(
                                host = host,
                                port = if (info.port > 0) info.port else 443,
                                id = id,
                                modelId = model,
                                name = info.serviceName,
                                source = "mdns",
                            )
                        )
                    }
                })
            }
        }
        try {
            nsd.discoverServices("_hue._tcp.", NsdManager.PROTOCOL_DNS_SD, listener)
        } catch (e: Exception) {
            Log.w(TAG, "mDNS start failed: ${e.message}")
            close()
        }
        awaitClose { runCatching { nsd.stopServiceDiscovery(listener) } }
    }

    /** Enrich a discovered bridge with `/api/0/config`. Returns null when unreachable. */
    suspend fun probe(bridge: DiscoveredBridge): DiscoveredBridge? {
        return try {
            val cfg = HueClient.fetchConfig(bridge.host, bridge.port, bridge.useHttps)
            bridge.copy(
                id = cfg.bridgeid ?: bridge.id,
                name = cfg.name ?: bridge.name,
                modelId = cfg.modelid ?: bridge.modelId,
                swVersion = cfg.swversion,
            )
        } catch (e: Exception) {
            Log.w(TAG, "probe ${bridge.host} failed: ${e.message}")
            null
        }
    }
}
