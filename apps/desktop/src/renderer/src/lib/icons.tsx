import {
  Baby,
  Bath,
  BedDouble,
  Bike,
  Briefcase,
  Building2,
  Car,
  ChefHat,
  Cpu,
  DoorOpen,
  Dumbbell,
  Flame,
  Flower2,
  Gamepad2,
  Home,
  Lamp,
  LampCeiling,
  LampDesk,
  LampFloor,
  LampWallDown,
  Layers,
  Lightbulb,
  Monitor,
  Music,
  Package,
  Plug,
  Shirt,
  Sofa,
  Sparkles,
  Sun,
  TreePine,
  Tv,
  Utensils,
  WashingMachine,
  Waves,
  type LucideIcon,
} from 'lucide-react';

const ROOM_ICONS: Record<string, LucideIcon> = {
  living_room: Sofa,
  lounge: Sofa,
  kitchen: ChefHat,
  dining: Utensils,
  bedroom: BedDouble,
  guest_room: BedDouble,
  kids_bedroom: Baby,
  nursery: Baby,
  bathroom: Bath,
  toilet: Bath,
  office: Briefcase,
  computer: Monitor,
  studio: Music,
  music: Music,
  tv: Tv,
  recreation: Gamepad2,
  gym: Dumbbell,
  hallway: DoorOpen,
  front_door: DoorOpen,
  staircase: Layers,
  garage: Car,
  carport: Car,
  driveway: Car,
  terrace: Sun,
  balcony: Sun,
  porch: Sun,
  garden: Flower2,
  pool: Waves,
  barbecue: Flame,
  laundry_room: WashingMachine,
  closet: Shirt,
  storage: Package,
  attic: Building2,
  downstairs: Layers,
  upstairs: Layers,
  top_floor: Layers,
  home: Home,
  man_cave: Gamepad2,
  reading: Lamp,
  other: Lightbulb,
};

const LIGHT_ICONS: Record<string, LucideIcon> = {
  table_shade: LampDesk,
  table_wash: LampDesk,
  flexible_lamp: LampDesk,
  floor_shade: LampFloor,
  floor_lantern: LampFloor,
  bollard: LampFloor,
  ceiling_round: LampCeiling,
  ceiling_square: LampCeiling,
  ceiling_horizontal: LampCeiling,
  ceiling_tube: LampCeiling,
  pendant_round: LampCeiling,
  pendant_long: LampCeiling,
  pendant_spot: LampCeiling,
  recessed_ceiling: LampCeiling,
  single_spot: LampCeiling,
  double_spot: LampCeiling,
  wall_lantern: LampWallDown,
  wall_shade: LampWallDown,
  wall_spot: LampWallDown,
  wall_washer: LampWallDown,
  up_down: LampWallDown,
  plug: Plug,
  hue_lightstrip: Sparkles,
  hue_lightstrip_tv: Tv,
  hue_lightstrip_pc: Monitor,
  hue_play: Tv,
  hue_go: Sun,
  hue_iris: Sun,
  hue_bloom: Sun,
  hue_signe: LampFloor,
  hue_tube: Sparkles,
  string_light: Sparkles,
  christmas_tree: TreePine,
  ground_spot: Flower2,
  hue_centris: LampCeiling,
};

export function roomIcon(archetype?: string): LucideIcon {
  return (archetype && ROOM_ICONS[archetype]) || Home;
}

export function lightIcon(archetype?: string): LucideIcon {
  return (archetype && LIGHT_ICONS[archetype]) || Lightbulb;
}

export function accessoryIcon(kind: string): LucideIcon {
  if (kind === 'bridge') return Cpu;
  if (kind === 'switch') return Bike;
  return Sparkles;
}

export const ROOM_ARCHETYPES = Object.keys(ROOM_ICONS);

export function archetypeLabel(a: string): string {
  return a.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
