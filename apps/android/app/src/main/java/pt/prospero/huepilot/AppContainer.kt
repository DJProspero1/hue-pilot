package pt.prospero.huepilot

import android.app.Application
import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import pt.prospero.huepilot.assistant.HueTools
import pt.prospero.huepilot.assistant.ProviderRegistry
import pt.prospero.huepilot.data.hue.HueRepository
import pt.prospero.huepilot.data.settings.AppSettings
import pt.prospero.huepilot.data.settings.SettingsRepository

/** Manual dependency container (no DI framework). */
class AppContainer(context: Context) {
    val appContext: Context = context.applicationContext
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val settings = SettingsRepository(appContext)
    val repository = HueRepository(appScope)
    val providers = ProviderRegistry()
    val tools = HueTools(repository)

    val settingsState: StateFlow<AppSettings> = settings.settings.stateIn(appScope, SharingStarted.Eagerly, AppSettings())

    init {
        appScope.launch {
            settings.settings.collect { s ->
                repository.defaultTransitionMs = s.transitionMs
                val bridge = s.bridge
                if (bridge != null && bridge.isPaired) repository.connect(bridge) else if (s.loaded) repository.disconnect()
            }
        }
    }
}

class HuePilotApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}

val Context.appContainer: AppContainer
    get() = (applicationContext as HuePilotApp).container
