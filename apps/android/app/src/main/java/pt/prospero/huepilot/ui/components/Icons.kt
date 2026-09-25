package pt.prospero.huepilot.ui.components

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Balcony
import androidx.compose.material.icons.outlined.Bathtub
import androidx.compose.material.icons.outlined.Bed
import androidx.compose.material.icons.outlined.Checkroom
import androidx.compose.material.icons.outlined.ChildCare
import androidx.compose.material.icons.outlined.ChildFriendly
import androidx.compose.material.icons.outlined.Computer
import androidx.compose.material.icons.outlined.Deck
import androidx.compose.material.icons.outlined.DirectionsCar
import androidx.compose.material.icons.outlined.DoorFront
import androidx.compose.material.icons.outlined.FitnessCenter
import androidx.compose.material.icons.outlined.Garage
import androidx.compose.material.icons.outlined.Grass
import androidx.compose.material.icons.outlined.Highlight
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Hotel
import androidx.compose.material.icons.outlined.Inventory2
import androidx.compose.material.icons.outlined.Kitchen
import androidx.compose.material.icons.outlined.Light
import androidx.compose.material.icons.outlined.Lightbulb
import androidx.compose.material.icons.outlined.LocalLaundryService
import androidx.compose.material.icons.outlined.MeetingRoom
import androidx.compose.material.icons.outlined.MenuBook
import androidx.compose.material.icons.outlined.MusicNote
import androidx.compose.material.icons.outlined.OutdoorGrill
import androidx.compose.material.icons.outlined.Pool
import androidx.compose.material.icons.outlined.Restaurant
import androidx.compose.material.icons.outlined.Roofing
import androidx.compose.material.icons.outlined.SportsBar
import androidx.compose.material.icons.outlined.SportsEsports
import androidx.compose.material.icons.outlined.Stairs
import androidx.compose.material.icons.outlined.Tv
import androidx.compose.material.icons.outlined.Wc
import androidx.compose.material.icons.outlined.Weekend
import androidx.compose.material.icons.outlined.Work
import androidx.compose.material.icons.outlined.Yard
import androidx.compose.ui.graphics.vector.ImageVector

/** Maps a Hue room/zone `metadata.archetype` to a Material icon. */
fun archetypeIcon(archetype: String?): ImageVector = when (archetype?.lowercase()) {
    "living_room", "lounge" -> Icons.Outlined.Weekend
    "kitchen" -> Icons.Outlined.Kitchen
    "dining" -> Icons.Outlined.Restaurant
    "bedroom" -> Icons.Outlined.Bed
    "kids_bedroom" -> Icons.Outlined.ChildCare
    "nursery" -> Icons.Outlined.ChildFriendly
    "bathroom" -> Icons.Outlined.Bathtub
    "toilet" -> Icons.Outlined.Wc
    "office", "computer" -> Icons.Outlined.Computer
    "recreation" -> Icons.Outlined.SportsEsports
    "gym" -> Icons.Outlined.FitnessCenter
    "hallway" -> Icons.Outlined.MeetingRoom
    "front_door" -> Icons.Outlined.DoorFront
    "garage", "carport" -> Icons.Outlined.Garage
    "terrace", "balcony" -> Icons.Outlined.Balcony
    "garden" -> Icons.Outlined.Yard
    "driveway" -> Icons.Outlined.DirectionsCar
    "home" -> Icons.Outlined.Home
    "downstairs", "upstairs", "top_floor", "staircase" -> Icons.Outlined.Stairs
    "attic" -> Icons.Outlined.Roofing
    "guest_room" -> Icons.Outlined.Hotel
    "man_cave" -> Icons.Outlined.SportsBar
    "music", "studio" -> Icons.Outlined.MusicNote
    "tv" -> Icons.Outlined.Tv
    "reading" -> Icons.Outlined.MenuBook
    "closet" -> Icons.Outlined.Checkroom
    "storage" -> Icons.Outlined.Inventory2
    "laundry_room" -> Icons.Outlined.LocalLaundryService
    "porch" -> Icons.Outlined.Deck
    "barbecue" -> Icons.Outlined.OutdoorGrill
    "pool" -> Icons.Outlined.Pool
    "outdoor", "other" -> Icons.Outlined.Grass
    "work" -> Icons.Outlined.Work
    else -> Icons.Outlined.Lightbulb
}

/** Maps a light `metadata.archetype` to a Material icon. */
fun lightArchetypeIcon(archetype: String?): ImageVector = when (archetype?.lowercase()) {
    "ceiling_round", "ceiling_square", "pendant_round", "pendant_long", "ceiling_horizontal", "ceiling_tube", "recessed_ceiling", "recessed_floor" -> Icons.Outlined.Light
    "single_spot", "double_spot", "spot_bulb", "flexible_lamp" -> Icons.Outlined.Highlight
    else -> Icons.Outlined.Lightbulb
}

fun prettyName(raw: String?): String =
    raw?.replace('_', ' ')?.replaceFirstChar { it.uppercase() } ?: ""
