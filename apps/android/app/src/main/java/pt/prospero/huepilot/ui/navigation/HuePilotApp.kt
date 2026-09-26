package pt.prospero.huepilot.ui.navigation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Lightbulb
import androidx.compose.material.icons.filled.Sensors
import androidx.compose.material.icons.filled.SmartToy
import androidx.compose.material.icons.filled.Style
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Lightbulb
import androidx.compose.material.icons.outlined.Sensors
import androidx.compose.material.icons.outlined.SmartToy
import androidx.compose.material.icons.outlined.Style
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import pt.prospero.huepilot.LaunchRequest
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import pt.prospero.huepilot.AppContainer
import pt.prospero.huepilot.ui.HueViewModel
import pt.prospero.huepilot.ui.HueViewModelFactory
import pt.prospero.huepilot.ui.accessories.AccessoriesScreen
import pt.prospero.huepilot.ui.assistant.AssistantScreen
import pt.prospero.huepilot.ui.assistant.AssistantViewModel
import pt.prospero.huepilot.ui.home.HomeScreen
import pt.prospero.huepilot.ui.light.LightDetailScreen
import pt.prospero.huepilot.ui.lights.LightsScreen
import pt.prospero.huepilot.ui.onboarding.OnboardingScreen
import pt.prospero.huepilot.ui.onboarding.OnboardingViewModel
import pt.prospero.huepilot.ui.room.RoomScreen
import pt.prospero.huepilot.ui.scenes.ScenesScreen
import pt.prospero.huepilot.ui.settings.SettingsScreen
import pt.prospero.huepilot.ui.settings.SettingsViewModel

object Routes {
    const val HOME = "home"
    const val LIGHTS = "lights"
    const val SCENES = "scenes"
    const val ACCESSORIES = "accessories"
    const val ASSISTANT = "assistant"
    const val SETTINGS = "settings"
    const val ROOM = "room/{id}"
    const val LIGHT = "light/{id}"
    fun room(id: String) = "room/$id"
    fun light(id: String) = "light/$id"
}

private data class Tab(val route: String, val label: String, val icon: ImageVector, val selectedIcon: ImageVector)

private val tabs = listOf(
    Tab(Routes.HOME, "Home", Icons.Outlined.Home, Icons.Filled.Home),
    Tab(Routes.LIGHTS, "Lights", Icons.Outlined.Lightbulb, Icons.Filled.Lightbulb),
    Tab(Routes.SCENES, "Scenes", Icons.Outlined.Style, Icons.Filled.Style),
    Tab(Routes.ACCESSORIES, "Sensors", Icons.Outlined.Sensors, Icons.Filled.Sensors),
    Tab(Routes.ASSISTANT, "Assistant", Icons.Outlined.SmartToy, Icons.Filled.SmartToy),
)

@Composable
fun HuePilotRoot(
    container: AppContainer,
    launch: StateFlow<LaunchRequest?> = MutableStateFlow(null),
    onLaunchHandled: () -> Unit = {},
) {
    val factory = remember { HueViewModelFactory(container) }
    val settings by container.settingsState.collectAsStateWithLifecycle()
    when {
        !settings.loaded -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        settings.bridge?.isPaired != true -> {
            val vm: OnboardingViewModel = viewModel(factory = factory)
            OnboardingScreen(vm)
        }
        else -> MainScaffold(factory, launch, onLaunchHandled)
    }
}

@Composable
private fun MainScaffold(factory: HueViewModelFactory, launch: StateFlow<LaunchRequest?>, onLaunchHandled: () -> Unit) {
    val nav = rememberNavController()
    val hueVm: HueViewModel = viewModel(factory = factory)
    val snackbar = remember { SnackbarHostState() }
    LaunchedEffect(Unit) { hueVm.messages.collect { snackbar.showSnackbar(it) } }

    // External navigation requests (widgets, huepilot:// links, debug launches).
    val request by launch.collectAsStateWithLifecycle()
    var pendingListen by remember { mutableStateOf(false) }
    LaunchedEffect(request?.nonce) {
        val r = request ?: return@LaunchedEffect
        val route = r.route.trim('/')
        val known = tabs.any { it.route == route } || route == Routes.SETTINGS || route.startsWith("room/") || route.startsWith("light/")
        if (known) {
            pendingListen = r.listen && route == Routes.ASSISTANT
            nav.navigate(route) {
                if (tabs.any { it.route == route }) popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                launchSingleTop = true
            }
        }
        onLaunchHandled()
    }

    val backStack by nav.currentBackStackEntryAsState()
    val currentDestination = backStack?.destination
    val showBar = tabs.any { t -> currentDestination?.hierarchy?.any { it.route == t.route } == true }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            if (showBar) {
                NavigationBar {
                    tabs.forEach { tab ->
                        val selected = currentDestination?.hierarchy?.any { it.route == tab.route } == true
                        NavigationBarItem(
                            selected = selected,
                            onClick = {
                                nav.navigate(tab.route) {
                                    popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = { Icon(if (selected) tab.selectedIcon else tab.icon, contentDescription = tab.label) },
                            label = { Text(tab.label) },
                        )
                    }
                }
            }
        },
    ) { padding ->
        NavHost(nav, startDestination = Routes.HOME, modifier = Modifier.padding(bottom = if (showBar) padding.calculateBottomPadding() else 0.dp)) {
            composable(Routes.HOME) {
                HomeScreen(hueVm, onOpenGroup = { nav.navigate(Routes.room(it)) }, onOpenSettings = { nav.navigate(Routes.SETTINGS) }, onOpenAssistant = { nav.navigate(Routes.ASSISTANT) })
            }
            composable(Routes.LIGHTS) { LightsScreen(hueVm, onOpenLight = { nav.navigate(Routes.light(it)) }) }
            composable(Routes.SCENES) { ScenesScreen(hueVm) }
            composable(Routes.ACCESSORIES) { AccessoriesScreen(hueVm) }
            composable(Routes.ASSISTANT) {
                val vm: AssistantViewModel = viewModel(factory = factory)
                AssistantScreen(vm, onOpenSettings = { nav.navigate(Routes.SETTINGS) }, autoListen = pendingListen, onAutoListenHandled = { pendingListen = false })
            }
            composable(Routes.SETTINGS) {
                val vm: SettingsViewModel = viewModel(factory = factory)
                SettingsScreen(vm, onBack = { nav.popBackStack() })
            }
            composable(Routes.ROOM, arguments = listOf(navArgument("id") { type = NavType.StringType })) { entry ->
                val id = entry.arguments?.getString("id") ?: return@composable
                RoomScreen(hueVm, id, onBack = { nav.popBackStack() }, onOpenLight = { nav.navigate(Routes.light(it)) })
            }
            composable(Routes.LIGHT, arguments = listOf(navArgument("id") { type = NavType.StringType })) { entry ->
                val id = entry.arguments?.getString("id") ?: return@composable
                LightDetailScreen(hueVm, id, onBack = { nav.popBackStack() })
            }
        }
    }
}
