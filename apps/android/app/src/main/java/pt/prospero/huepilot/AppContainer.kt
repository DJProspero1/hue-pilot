package pt.prospero.huepilot

import android.app.Application
import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import pt.prospero.huepilot.assistant.HueTools
import pt.prospero.huepilot.assistant.ProviderRegistry
import pt.prospero.huepilot.data.hue.HueRepository
import pt.prospero.huepilot.data.settings.AppSettings
import pt.prospero.huepilot.data.settings.SettingsRepository
import pt.prospero.huepilot.widget.WidgetUpdater

/** Manual dependency container (no DI framework). */
@OptIn(FlowPreview::class)
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
        // Keep the home-screen widgets in sync with the live snapshot while the process is alive.
        appScope.launch {
            repository.snapshot.drop(1).debounce(800).collect { WidgetUpdater.updateAll(appContext) }
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
