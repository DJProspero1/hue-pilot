/**
 * Philips Hue CLIP v2 resource types (subset used by the suite).
 * Reference: https://developers.meethue.com/develop/hue-api-v2/api-reference/
 */

export type ResourceType =
  | 'light'
  | 'room'
  | 'zone'
  | 'grouped_light'
  | 'scene'
  | 'smart_scene'
  | 'device'
  | 'bridge'
  | 'bridge_home'
  | 'motion'
  | 'camera_motion'
  | 'button'
  | 'relative_rotary'
  | 'light_level'
  | 'temperature'
  | 'device_power'
  | 'zigbee_connectivity'
  | 'entertainment_configuration'
  | 'entertainment'
  | 'behavior_instance'
  | 'behavior_script'
  | 'contact'
  | 'tamper'
  | 'geolocation'
  | 'homekit'
  | 'matter'
  | 'service_group'
  | 'convenience_area'
  | 'security_area'
  | (string & {});

export interface ResourceRef {
  rid: string;
  rtype: ResourceType;
}

export interface ResourceBase {
  id: string;
  id_v1?: string;
  type: ResourceType;
  owner?: ResourceRef;
}

export interface XY {
  x: number;
  y: number;
}

export interface Gamut {
  red: XY;
  green: XY;
  blue: XY;
}

export interface LightResource extends ResourceBase {
  type: 'light';
  metadata: { name: string; archetype?: string; fixed_mired?: number; function?: string };
  on: { on: boolean };
  dimming?: { brightness: number; min_dim_level?: number };
  color_temperature?: {
    mirek: number | null;
    mirek_valid: boolean;
    mirek_schema: { mirek_minimum: number; mirek_maximum: number };
  };
  color?: { xy: XY; gamut?: Gamut; gamut_type?: 'A' | 'B' | 'C' | 'other' };
  dynamics?: { status: 'dynamic_palette' | 'none'; status_values: string[]; speed: number; speed_valid: boolean };
  alert?: { action_values: string[] };
  signaling?: { signal_values: string[]; status?: { signal: string; estimated_end?: string } };
  mode?: 'normal' | 'streaming';
  effects?: { status_values: string[]; status: string; effect_values: string[] };
  effects_v2?: {
    action: { effect_values: string[] };
    status: { effect: string; effect_values: string[]; parameters?: Record<string, unknown> };
  };
  timed_effects?: { status_values: string[]; status: string; effect_values: string[] };
  gradient?: {
    points: { color: { xy: XY } }[];
    mode: string;
    points_capable: number;
    mode_values: string[];
    pixel_count?: number;
  };
  powerup?: { preset: string; configured: boolean };
  service_id?: number;
}

export interface GroupResource extends ResourceBase {
  type: 'room' | 'zone';
  metadata: { name: string; archetype: string };
  children: ResourceRef[];
  services: ResourceRef[];
}

export interface BridgeHomeResource extends ResourceBase {
  type: 'bridge_home';
  children: ResourceRef[];
  services: ResourceRef[];
}

export interface GroupedLightResource extends ResourceBase {
  type: 'grouped_light';
  owner: ResourceRef;
  on?: { on: boolean };
  dimming?: { brightness: number };
  color?: { xy: XY };
  color_temperature?: { mirek: number | null; mirek_valid: boolean };
  alert?: { action_values: string[] };
}

export interface SceneAction {
  target: ResourceRef;
  action: {
    on?: { on: boolean };
    dimming?: { brightness: number };
    color?: { xy: XY };
    color_temperature?: { mirek: number };
    gradient?: { points: { color: { xy: XY } }[]; mode?: string };
    effects?: { effect: string };
    effects_v2?: { action: { effect: string } };
    dynamics?: { duration?: number };
  };
}

export interface SceneResource extends ResourceBase {
  type: 'scene';
  metadata: { name: string; image?: ResourceRef; appdata?: string };
  group: ResourceRef;
  actions: SceneAction[];
  palette?: {
    color: { color: { xy: XY }; dimming: { brightness: number } }[];
    dimming: { brightness: number }[];
    color_temperature: { color_temperature: { mirek: number }; dimming: { brightness: number } }[];
    effects?: { effect: string }[];
    effects_v2?: { action: { effect: string } }[];
  };
  speed: number;
  auto_dynamic: boolean;
  status?: { active: 'inactive' | 'static' | 'dynamic_palette'; last_recall?: string };
}

export interface SmartSceneResource extends ResourceBase {
  type: 'smart_scene';
  metadata: { name: string; image?: ResourceRef };
  group: ResourceRef;
  week_timeslots: unknown[];
  active_timeslot?: { timeslot_id: number; weekday: string };
  state: 'active' | 'inactive';
}

export interface DeviceResource extends ResourceBase {
  type: 'device';
  product_data: {
    model_id: string;
    manufacturer_name: string;
    product_name: string;
    product_archetype: string;
    certified: boolean;
    software_version: string;
    hardware_platform_type?: string;
  };
  metadata: { name: string; archetype: string };
  services: ResourceRef[];
  usertest?: { status: string; usertest: boolean };
}

export interface BridgeResource extends ResourceBase {
  type: 'bridge';
  bridge_id: string;
  time_zone: { time_zone: string };
}

export interface MotionResource extends ResourceBase {
  type: 'motion' | 'camera_motion';
  owner: ResourceRef;
  enabled: boolean;
  motion: { motion?: boolean; motion_valid?: boolean; motion_report?: { changed: string; motion: boolean } };
  sensitivity?: { status: string; sensitivity: number; sensitivity_max: number };
}

/**
 * Motion service of a Hue Secure camera (`camera_motion`). Same shape as `motion`; `enabled` is the
 * camera's motion-detection switch (PUT /clip/v2/resource/camera_motion/{id} { enabled }).
 * The bridge exposes no video: live view and clips are end-to-end encrypted and only available in the Hue app.
 */
export interface CameraMotionResource extends MotionResource {
  type: 'camera_motion';
}

export interface ButtonResource extends ResourceBase {
  type: 'button';
  owner: ResourceRef;
  metadata: { control_id: number };
  button: {
    last_event?: string;
    button_report?: { updated: string; event: string };
    repeat_interval?: number;
    event_values?: string[];
  };
}

export interface RelativeRotaryResource extends ResourceBase {
  type: 'relative_rotary';
  owner: ResourceRef;
  relative_rotary: {
    rotary_report?: { updated: string; action: string; rotation: { direction: string; steps: number; duration: number } };
  };
}

export interface LightLevelResource extends ResourceBase {
  type: 'light_level';
  owner: ResourceRef;
  enabled: boolean;
  light: { light_level?: number; light_level_valid?: boolean; light_level_report?: { changed: string; light_level: number } };
}

export interface TemperatureResource extends ResourceBase {
  type: 'temperature';
  owner: ResourceRef;
  enabled: boolean;
  temperature: { temperature?: number; temperature_valid?: boolean; temperature_report?: { changed: string; temperature: number } };
}

export interface DevicePowerResource extends ResourceBase {
  type: 'device_power';
  owner: ResourceRef;
  power_state: { battery_state?: 'normal' | 'low' | 'critical'; battery_level?: number };
}

export interface ZigbeeConnectivityResource extends ResourceBase {
  type: 'zigbee_connectivity';
  owner: ResourceRef;
  status: 'connected' | 'disconnected' | 'connectivity_issue' | 'unidirectional_incoming';
  mac_address?: string;
}

export interface ContactResource extends ResourceBase {
  type: 'contact';
  owner: ResourceRef;
  enabled: boolean;
  contact_report?: { changed: string; state: 'contact' | 'no_contact' };
}

export interface EntertainmentConfigurationResource extends ResourceBase {
  type: 'entertainment_configuration';
  metadata: { name: string };
  configuration_type: string;
  status: 'active' | 'inactive';
  light_services?: ResourceRef[];
}

export interface GenericResource extends ResourceBase {
  [key: string]: unknown;
}

export type Resource =
  | LightResource
  | GroupResource
  | BridgeHomeResource
  | GroupedLightResource
  | SceneResource
  | SmartSceneResource
  | DeviceResource
  | BridgeResource
  | MotionResource
  | ButtonResource
  | RelativeRotaryResource
  | LightLevelResource
  | TemperatureResource
  | DevicePowerResource
  | ZigbeeConnectivityResource
  | ContactResource
  | EntertainmentConfigurationResource
  | GenericResource;

/** Partial update body accepted by PUT /clip/v2/resource/light/{id} and grouped_light. */
export interface LightUpdateBody {
  on?: { on: boolean };
  dimming?: { brightness: number };
  dimming_delta?: { action: 'up' | 'down' | 'stop'; brightness_delta?: number };
  color?: { xy: XY };
  color_temperature?: { mirek: number };
  color_temperature_delta?: { action: 'up' | 'down' | 'stop'; mirek_delta?: number };
  dynamics?: { duration?: number; speed?: number };
  alert?: { action: 'breathe' };
  signaling?: {
    signal: 'no_signal' | 'on_off' | 'on_off_color' | 'alternating';
    duration?: number;
    colors?: { color: { xy: XY } }[];
  };
  effects?: { effect: string };
  effects_v2?: { action: { effect: string; parameters?: Record<string, unknown> } };
  timed_effects?: { effect: string; duration?: number };
  gradient?: { points: { color: { xy: XY } }[]; mode?: string };
  metadata?: { name?: string; archetype?: string };
  powerup?: unknown;
}

/** Friendly, capability-neutral state change used across the suite. */
export interface LightState {
  on?: boolean;
  /** 1..100 */
  brightness?: number;
  xy?: XY;
  /** 153..500 (bridge colour temperature units). */
  mirek?: number;
  /** Effect identifier, e.g. candle, fire, prism, sparkle, opal, glisten, no_effect. */
  effect?: string;
  /** Transition time in milliseconds. */
  transitionMs?: number;
}

export interface EventStreamUpdate {
  creationtime: string;
  id: string;
  type: 'update' | 'add' | 'delete' | 'error';
  data: (Partial<Resource> & { id: string; type: ResourceType })[];
}

export interface DiscoveredBridge {
  id: string;
  internalipaddress: string;
  port?: number;
  name?: string;
  source: 'cloud' | 'mdns' | 'manual';
}

export interface BridgeConfigV1 {
  name: string;
  datastoreversion?: string;
  swversion: string;
  apiversion: string;
  mac?: string;
  bridgeid: string;
  factorynew?: boolean;
  modelid: string;
}

export interface BridgeConnection {
  host: string;
  port?: number;
  protocol?: 'https' | 'http';
  appKey: string;
  clientKey?: string;
  bridgeId?: string;
  name?: string;
}

/** Hue API v1 schedule (still executed bridge-side, used for time-based automations). */
export interface ScheduleV1 {
  name: string;
  description?: string;
  command: { address: string; method: 'PUT' | 'POST' | 'DELETE'; body: Record<string, unknown> };
  localtime: string;
  time?: string;
  created?: string;
  status: 'enabled' | 'disabled';
  autodelete?: boolean;
  recycle?: boolean;
  starttime?: string;
}

export type ScheduleMapV1 = Record<string, ScheduleV1>;
