package pt.prospero.huepilot.ui.navigation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Lightbulb
import androidx.compose.material.icons.outlined.Palette
import androidx.compose.material.icons.outlined.Sensors
import androidx.compose.material.icons.rounded.AutoAwesome
import androidx.compose.material.icons.rounded.Home
import androidx.compose.material.icons.rounded.Lightbulb
import androidx.compose.material.icons.rounded.Palette
import androidx.compose.material.icons.rounded.Sensors
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import pt.prospero.huepilot.AppContainer
import pt.prospero.huepilot.LaunchRequest
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

    /** Aliases accepted from widgets / deep links. */
    fun normalize(route: String): String = when (route.trim('/').lowercase()) {
        "cameras", "sensors", "security" -> ACCESSORIES
        "chat", "ask" -> ASSISTANT
        else -> route.trim('/')
    }
}

private data class Tab(val route: String, val label: String, val icon: ImageVector, val selectedIcon: ImageVector)

private val tabs = listOf(
    Tab(Routes.HOME, "Home", Icons.Outlined.Home, Icons.Rounded.Home),
    Tab(Routes.LIGHTS, "Lights", Icons.Outlined.Lightbulb, Icons.Rounded.Lightbulb),
    Tab(Routes.SCENES, "Scenes", Icons.Outlined.Palette, Icons.Rounded.Palette),
    Tab(Routes.ACCESSORIES, "Sensors", Icons.Outlined.Sensors, Icons.Rounded.Sensors),
    Tab(Routes.ASSISTANT, "Assistant", Icons.Outlined.AutoAwesome, Icons.Rounded.AutoAwesome),
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

private fun NavHostController.openTab(route: String) {
    navigate(route) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
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
        val route = Routes.normalize(r.route)
        val isTab = tabs.any { it.route == route }
        val known = isTab || route == Routes.SETTINGS || route.startsWith("room/") || route.startsWith("light/")
        if (known) {
            pendingListen = r.listen && route == Routes.ASSISTANT
            if (isTab) {
                // External requests always land on the tab itself (not on a room/light saved on top of it).
                nav.popBackStack(nav.graph.findStartDestination().id, inclusive = false)
                if (route != Routes.HOME) nav.navigate(route) { popUpTo(nav.graph.findStartDestination().id) { saveState = false }; launchSingleTop = true }
            } else {
                nav.navigate(route) { launchSingleTop = true }
            }
        }
        onLaunchHandled()
    }

    val backStack by nav.currentBackStackEntryAsState()
    val currentDestination = backStack?.destination
    val showBar = tabs.any { t -> currentDestination?.hierarchy?.any { it.route == t.route } == true }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            if (showBar) {
                NavigationBar(containerColor = MaterialTheme.colorScheme.surfaceContainerLow, tonalElevation = 0.dp) {
                    tabs.forEach { tab ->
                        val selected = currentDestination?.hierarchy?.any { it.route == tab.route } == true
                        NavigationBarItem(
                            selected = selected,
                            onClick = { nav.openTab(tab.route) },
                            icon = { Icon(if (selected) tab.selectedIcon else tab.icon, contentDescription = tab.label) },
                            label = { Text(tab.label) },
                            colors = NavigationBarItemDefaults.colors(
                                indicatorColor = MaterialTheme.colorScheme.primaryContainer,
                                selectedIconColor = MaterialTheme.colorScheme.onPrimaryContainer,
                                selectedTextColor = MaterialTheme.colorScheme.onSurface,
                                unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
                                unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
                            ),
                        )
                    }
                }
            }
        },
    ) { padding ->
        NavHost(
            nav,
            startDestination = Routes.HOME,
            modifier = Modifier.padding(top = padding.calculateTopPadding(), bottom = if (showBar) padding.calculateBottomPadding() else 0.dp),
        ) {
            composable(Routes.HOME) {
                HomeScreen(
                    hueVm,
                    onOpenGroup = { nav.navigate(Routes.room(it)) },
                    onOpenSettings = { nav.navigate(Routes.SETTINGS) },
                    onOpenAssistant = { nav.openTab(Routes.ASSISTANT) },
                    onOpenSensors = { nav.openTab(Routes.ACCESSORIES) },
                )
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
