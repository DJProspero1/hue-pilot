package pt.prospero.huepilot.data.hue

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.SSLContext
import javax.net.ssl.X509TrustManager

/** Where the bridge lives and how we authenticate. */
data class BridgeConnection(
    val host: String,
    val port: Int = 443,
    val useHttps: Boolean = true,
    val appKey: String? = null,
    val clientKey: String? = null,
    val bridgeId: String? = null,
    val bridgeName: String? = null,
) {
    val baseUrl: String
        get() {
            val scheme = if (useHttps) "https" else "http"
            val defaultPort = if (useHttps) 443 else 80
            return if (port == defaultPort) "$scheme://$host" else "$scheme://$host:$port"
        }

    val isPaired: Boolean get() = !appKey.isNullOrBlank()
}

class HueException(message: String, val statusCode: Int = 0, val hueType: Int = 0) : Exception(message)

data class PairResult(val username: String, val clientKey: String?)

/**
 * HTTP client for one Hue bridge. Uses a dedicated OkHttp client that trusts the bridge's self-signed
 * certificate (Signify root CA, CN = bridge id) and only accepts the configured host name.
 * This client must never be used for anything but bridge traffic.
 */
class HueClient(val connection: BridgeConnection) {
    private val json = HueJson
    private val jsonType = "application/json; charset=utf-8".toMediaType()

    val http: OkHttpClient = bridgeHttpClient(connection.host)
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .build()

    /** Client for the SSE event stream: no read timeout. */
    val streamHttp: OkHttpClient = http.newBuilder().readTimeout(0, TimeUnit.MILLISECONDS).build()

    private val base = connection.baseUrl
    private val appKey get() = connection.appKey ?: throw HueException("Bridge is not paired")

    private fun v2Request(path: String) = Request.Builder()
        .url("$base/clip/v2/resource$path")
        .header("hue-application-key", appKey)

    fun eventStreamRequest(): Request = Request.Builder()
        .url("$base/eventstream/clip/v2")
        .header("hue-application-key", appKey)
        .header("Accept", "text/event-stream")
        .build()

    private suspend fun execute(request: Request): JsonElement = withContext(Dispatchers.IO) {
        http.newCall(request).execute().use { resp ->
            val text = resp.body?.string().orEmpty()
            val parsed = runCatching { if (text.isBlank()) JsonObject(emptyMap()) else json.parseToJsonElement(text) }
                .getOrElse { throw HueException("Bridge returned invalid JSON (${resp.code})", resp.code) }
            if (!resp.isSuccessful) {
                val msg = (parsed as? JsonObject)?.get("errors")?.jsonArray?.firstOrNull()?.jsonObject
                    ?.get("description")?.jsonPrimitive?.content
                throw HueException(msg ?: "Bridge error HTTP ${resp.code}", resp.code)
            }
            (parsed as? JsonObject)?.get("errors")?.let { errs ->
                if (errs is JsonArray && errs.isNotEmpty()) {
                    val msg = errs.first().jsonObject["description"]?.jsonPrimitive?.content ?: "Bridge error"
                    throw HueException(msg, resp.code)
                }
            }
            parsed
        }
    }

    private fun JsonElement.dataArray(): List<JsonObject> =
        (this as? JsonObject)?.get("data")?.let { it as? JsonArray }?.mapNotNull { it as? JsonObject } ?: emptyList()

    suspend fun getAllResources(): List<JsonObject> = execute(v2Request("").get().build()).dataArray()

    suspend fun getResources(type: String): List<JsonObject> = execute(v2Request("/$type").get().build()).dataArray()

    suspend fun getResource(type: String, id: String): JsonObject? =
        execute(v2Request("/$type/$id").get().build()).dataArray().firstOrNull()

    suspend fun put(type: String, id: String, body: JsonObject): List<JsonObject> =
        execute(v2Request("/$type/$id").put(body.toString().toRequestBody(jsonType)).build()).dataArray()

    suspend fun post(type: String, body: JsonObject): List<JsonObject> =
        execute(v2Request("/$type").post(body.toString().toRequestBody(jsonType)).build()).dataArray()

    suspend fun delete(type: String, id: String): List<JsonObject> =
        execute(v2Request("/$type/$id").delete().build()).dataArray()

    // ---- v1 API (schedules) ----

    private fun v1Request(path: String) = Request.Builder().url("$base/api/$appKey$path")

    private suspend fun executeV1(request: Request): JsonElement = withContext(Dispatchers.IO) {
        http.newCall(request).execute().use { resp ->
            val text = resp.body?.string().orEmpty()
            val parsed = runCatching { json.parseToJsonElement(text) }
                .getOrElse { throw HueException("Bridge returned invalid JSON (${resp.code})", resp.code) }
            if (parsed is JsonArray) {
                parsed.firstOrNull()?.jsonObject?.get("error")?.jsonObject?.let { err ->
                    val desc = err["description"]?.jsonPrimitive?.content ?: "Bridge error"
                    val type = err["type"]?.jsonPrimitive?.content?.toIntOrNull() ?: 0
                    throw HueException(desc, resp.code, type)
                }
            }
            if (!resp.isSuccessful) throw HueException("Bridge error HTTP ${resp.code}", resp.code)
            parsed
        }
    }

    suspend fun v1Get(path: String): JsonElement = executeV1(v1Request(path).get().build())
    suspend fun v1Post(path: String, body: JsonObject): JsonElement =
        executeV1(v1Request(path).post(body.toString().toRequestBody(jsonType)).build())
    suspend fun v1Put(path: String, body: JsonObject): JsonElement =
        executeV1(v1Request(path).put(body.toString().toRequestBody(jsonType)).build())
    suspend fun v1Delete(path: String): JsonElement = executeV1(v1Request(path).delete().build())

    suspend fun listSchedules(): Map<String, V1Schedule> {
        val el = v1Get("/schedules")
        val obj = el as? JsonObject ?: return emptyMap()
        return obj.mapNotNull { (k, v) ->
            runCatching { k to json.decodeFromJsonElement(V1Schedule.serializer(), v) }.getOrNull()
        }.toMap()
    }

    suspend fun createSchedule(body: JsonObject): String {
        val el = v1Post("/schedules", body)
        val id = (el as? JsonArray)?.firstOrNull()?.jsonObject?.get("success")?.jsonObject?.get("id")?.jsonPrimitive?.content
        return id ?: throw HueException("Bridge did not return a schedule id")
    }

    suspend fun deleteSchedule(id: String) { v1Delete("/schedules/$id") }

    companion object {
        private val jsonType = "application/json; charset=utf-8".toMediaType()

        /** Trust-all TLS for the bridge's self-signed certificate, pinned to the configured host name. */
        fun bridgeHttpClient(host: String): OkHttpClient.Builder {
            val trustManager = object : X509TrustManager {
                override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {}
                override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {}
                override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
            }
            val ctx = SSLContext.getInstance("TLS")
            ctx.init(null, arrayOf(trustManager), SecureRandom())
            val verifier = HostnameVerifier { hostname, _ -> hostname.equals(host, ignoreCase = true) }
            return OkHttpClient.Builder()
                .sslSocketFactory(ctx.socketFactory, trustManager)
                .hostnameVerifier(verifier)
        }

        /** `GET /api/0/config` — works without pairing. */
        suspend fun fetchConfig(host: String, port: Int, useHttps: Boolean): BridgeConfig = withContext(Dispatchers.IO) {
            val conn = BridgeConnection(host, port, useHttps)
            val client = bridgeHttpClient(host).connectTimeout(4, TimeUnit.SECONDS).readTimeout(6, TimeUnit.SECONDS).build()
            val req = Request.Builder().url("${conn.baseUrl}/api/0/config").get().build()
            client.newCall(req).execute().use { resp ->
                val text = resp.body?.string().orEmpty()
                if (!resp.isSuccessful) throw HueException("HTTP ${resp.code}", resp.code)
                HueJson.decodeFromString(BridgeConfig.serializer(), text)
            }
        }

        /**
         * One pairing attempt: `POST /api {"devicetype":"hue_pilot#android","generateclientkey":true}`.
         * Returns null while the link button has not been pressed (error type 101).
         */
        suspend fun tryPair(host: String, port: Int, useHttps: Boolean, deviceType: String = "hue_pilot#android"): PairResult? =
            withContext(Dispatchers.IO) {
                val conn = BridgeConnection(host, port, useHttps)
                val client = bridgeHttpClient(host).connectTimeout(4, TimeUnit.SECONDS).readTimeout(6, TimeUnit.SECONDS).build()
                val body = buildJsonObject {
                    put("devicetype", deviceType)
                    put("generateclientkey", true)
                }
                val req = Request.Builder().url("${conn.baseUrl}/api").post(body.toString().toRequestBody(jsonType)).build()
                client.newCall(req).execute().use { resp ->
                    val text = resp.body?.string().orEmpty()
                    val parsed = runCatching { HueJson.parseToJsonElement(text) }.getOrElse {
                        throw HueException("Bridge returned invalid JSON (${resp.code})", resp.code)
                    }
                    val first = (parsed as? JsonArray)?.firstOrNull()?.jsonObject
                        ?: throw HueException("Unexpected pairing response", resp.code)
                    first["success"]?.jsonObject?.let { s ->
                        val username = s["username"]?.jsonPrimitive?.content ?: throw HueException("No username in response")
                        return@withContext PairResult(username, s["clientkey"]?.jsonPrimitive?.content)
                    }
                    val err = first["error"]?.jsonObject
                    val type = err?.get("type")?.jsonPrimitive?.content?.toIntOrNull() ?: 0
                    if (type == 101) return@withContext null
                    throw HueException(err?.get("description")?.jsonPrimitive?.content ?: "Pairing failed", resp.code, type)
                }
            }
    }
}
