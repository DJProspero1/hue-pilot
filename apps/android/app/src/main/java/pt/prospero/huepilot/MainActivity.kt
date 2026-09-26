package pt.prospero.huepilot

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import pt.prospero.huepilot.data.hue.BridgeConnection
import pt.prospero.huepilot.ui.navigation.HuePilotRoot
import pt.prospero.huepilot.ui.theme.HuePilotTheme
import pt.prospero.huepilot.ui.theme.isDarkTheme

/**
 * A navigation request coming from outside the UI: a widget, a shortcut or a debug launch.
 * `route` is one of the `Routes` destinations (or a room/light route); `listen` starts voice input.
 */
data class LaunchRequest(val route: String, val listen: Boolean = false, val nonce: Long = System.nanoTime())

class MainActivity : ComponentActivity() {
    private val _launch = MutableStateFlow<LaunchRequest?>(null)
    val launch: StateFlow<LaunchRequest?> = _launch

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val container = appContainer
        handleIntent(intent)
        setContent {
            val settings by container.settingsState.collectAsStateWithLifecycle()
            val dark = isDarkTheme(settings.theme)
            LaunchedEffect(dark) {
                val style = if (dark) SystemBarStyle.dark(android.graphics.Color.TRANSPARENT)
                else SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT)
                enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
            }
            HuePilotTheme(mode = settings.theme, useWallpaperColors = settings.wallpaperColors) {
                HuePilotRoot(container, launch = launch, onLaunchHandled = { _launch.value = null })
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        intent ?: return
        // Debug builds accept a pre-paired bridge so emulator runs skip onboarding:
        // adb shell am start -n pt.prospero.huepilot/.MainActivity --es hue_host 10.0.2.2 --ei hue_port 8080 --ez hue_https false --es hue_key mock
        val host = intent.getStringExtra(EXTRA_HOST)
        if (BuildConfig.DEBUG && !host.isNullOrBlank()) {
            val conn = BridgeConnection(
                host = host,
                port = intent.getIntExtra(EXTRA_PORT, 443),
                useHttps = intent.getBooleanExtra(EXTRA_HTTPS, true),
                appKey = intent.getStringExtra(EXTRA_KEY) ?: "debug-key",
                bridgeName = intent.getStringExtra(EXTRA_NAME) ?: "Hue bridge",
            )
            lifecycleScope.launch { appContainer.settings.saveBridge(conn) }
        }
        val route = intent.getStringExtra(EXTRA_OPEN) ?: intent.data?.takeIf { it.scheme == "huepilot" }?.let { uri ->
            listOfNotNull(uri.host, uri.path?.trim('/')?.takeIf { it.isNotEmpty() }).joinToString("/")
        }
        if (!route.isNullOrBlank()) {
            val listen = intent.getBooleanExtra(EXTRA_LISTEN, false) || intent.data?.getBooleanQueryParameter("listen", false) == true
            _launch.value = LaunchRequest(route, listen)
        }
    }

    companion object {
        const val EXTRA_HOST = "hue_host"
        const val EXTRA_PORT = "hue_port"
        const val EXTRA_HTTPS = "hue_https"
        const val EXTRA_KEY = "hue_key"
        const val EXTRA_NAME = "hue_name"

        /** Route to open (e.g. "assistant", "scenes", "room/<id>", "light/<id>", "cameras", "widgets"). */
        const val EXTRA_OPEN = "open"
        /** With [EXTRA_OPEN] = "assistant": start listening for a voice command immediately. */
        const val EXTRA_LISTEN = "listen"
    }
}
