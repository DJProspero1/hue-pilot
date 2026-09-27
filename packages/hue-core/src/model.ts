import { GAMUT_C, mirekToHex, mirekToKelvin, xyToHex } from './color.ts';
import { describeMotionSlots, formatMotionTime, isMotionAutomation, parseAccessoryConfiguration, type Darkness, type MotionAction } from './automations.ts';
import { describeRoutine, isRoutine, parseRoutineConfiguration } from './routines.ts';
import type {
  BridgeHomeResource,
  BridgeResource,
  ButtonResource,
  ContactResource,
  DevicePowerResource,
  DeviceResource,
  EventStreamUpdate,
  Gamut,
  GroupResource,
  GroupedLightResource,
  LightLevelResource,
  LightResource,
  MotionResource,
  Resource,
  SceneResource,
  TemperatureResource,
  XY,
  ZigbeeConnectivityResource,
  BehaviorInstanceResource,
} from './types.ts';

/** Power-on behaviour of a light (what it does after a power cut or a wall switch). */
export interface PowerOnView {
  preset: 'safety' | 'powerfail' | 'last_on_state' | 'custom' | string;
  on?: 'on' | 'toggle' | 'previous';
  brightness?: number;
  mirek?: number;
  xy?: XY;
}

export interface LightView {
  id: string;
  powerOn?: PowerOnView;
  idV1?: string;
  name: string;
  archetype: string;
  deviceId?: string;
  roomId?: string;
  roomName?: string;
  zoneIds: string[];
  on: boolean;
  brightness: number;
  minBrightness: number;
  supportsDimming: boolean;
  supportsColor: boolean;
  supportsColorTemperature: boolean;
  colorMode: 'xy' | 'ct' | 'none';
  xy?: XY;
  gamut: Gamut;
  gamutType?: string;
  mirek?: number;
  mirekMin: number;
  mirekMax: number;
  kelvin?: number;
  /** Hex colour approximating the current light output at full brightness. */
  hex: string;
  effects: string[];
  effect: string;
  effectsV2: boolean;
  timedEffects: string[];
  dynamicsActive: boolean;
  gradientPoints?: XY[];
  connectivity?: ZigbeeConnectivityResource['status'];
  productName?: string;
  modelId?: string;
  softwareVersion?: string;
  streaming: boolean;
}

export interface GroupView {
  id: string;
  idV1?: string;
  kind: 'room' | 'zone' | 'home';
  name: string;
  archetype: string;
  groupedLightId?: string;
  lightIds: string[];
  deviceIds: string[];
  on: boolean;
  anyOn: boolean;
  brightness: number;
  sceneIds: string[];
  activeSceneId?: string;
  /** Distinct colours of lights in the group (hex), for previews. */
  colors: string[];
}

export interface SceneView {
  id: string;
  idV1?: string;
  name: string;
  groupId: string;
  groupType: 'room' | 'zone';
  groupName: string;
  active: 'inactive' | 'static' | 'dynamic_palette';
  lastRecall?: string;
  palette: string[];
  speed: number;
  autoDynamic: boolean;
  supportsDynamic: boolean;
  lightCount: number;
  actions: SceneResource['actions'];
}

export interface AccessoryView {
  deviceId: string;
  /** Room the device was placed in (rooms hold devices, so sensors have one too). */
  roomId?: string;
  roomName?: string;
  name: string;
  productName: string;
  modelId: string;
  archetype: string;
  kind: 'motion' | 'switch' | 'contact' | 'bridge' | 'other';
  softwareVersion?: string;
  battery?: { level?: number; state?: string };
  connectivity?: ZigbeeConnectivityResource['status'];
  motion?: { sensorId: string; active: boolean; valid: boolean; enabled: boolean; changed?: string; sensitivity?: number; sensitivityMax?: number };
  temperature?: { sensorId: string; celsius?: number; changed?: string; enabled: boolean };
  lightLevel?: { sensorId: string; lux?: number; raw?: number; changed?: string; enabled: boolean };
  contact?: { sensorId: string; state?: string; changed?: string; enabled: boolean };
  buttons: { id: string; controlId: number; lastEvent?: string; updated?: string }[];
}

/**
 * A Hue Secure camera as seen by the bridge. The local API exposes motion detection, ambient light,
 * battery, connectivity and software version only; video is end-to-end encrypted (Hue app / cloud).
 */
export interface CameraView {
  /** Device id. */
  id: string;
  name: string;
  productName: string;
  modelId: string;
  softwareVersion?: string;
  /** battery = Secure battery camera (CMB001), floodlight = Secure floodlight camera (CMW002), camera = anything else. */
  kind: 'battery' | 'floodlight' | 'camera';
  connectivity?: ZigbeeConnectivityResource['status'];
  batteryLevel: number | null;
  batteryState: string | null;
  /** Current motion state; null when the camera reports no valid reading. */
  motion: boolean | null;
  /** Motion detection switch (camera_motion.enabled). */
  motionEnabled: boolean;
  /** ISO time of the last motion change. */
  motionChanged: string | null;
  lux: number | null;
  lightLevelChanged: string | null;
  cameraMotionId: string | null;
  lightLevelId: string | null;
  /** Light id of the paired floodlight (separate device with archetype hue_floodlight_camera), or null. */
  floodlightLightId: string | null;
  roomId?: string;
  roomName?: string;
}

export interface BridgeInfo {
  id: string;
  bridgeId: string;
  name: string;
  timeZone?: string;
  modelId?: string;
  softwareVersion?: string;
  homeGroupedLightId?: string;
}

export interface MotionActionView {
  kind: 'nothing' | 'off' | 'scene';
  sceneId?: string;
  sceneName?: string;
}

export interface MotionSlotView {
  /** HH:MM */
  start: string;
  onMotion: MotionActionView;
  noMotionAfterMinutes: number;
  onNoMotion: MotionActionView;
  doNotDisturb: boolean;
}

/** What a motion sensor or camera makes the lights do (a behavior_instance of the Hue Accessories script). */
export interface MotionAutomationView {
  id: string;
  name: string;
  enabled: boolean;
  status?: string;
  lastError?: string;
  sourceDeviceId: string;
  sourceName: string;
  sourceKind: 'sensor' | 'camera';
  motionServiceId: string;
  motionType: 'motion' | 'camera_motion';
  where: { id: string; kind: 'room' | 'zone'; name: string }[];
  onlyWhenDark: boolean;
  darkness: Darkness;
  /** The bridge's darkness condition as stored (kept when updating). */
  lightLevel?: Record<string, unknown>;
  /** The bridge configuration verbatim: a PUT that changes only `enabled` is refused unless it is sent back too. */
  configuration: Record<string, unknown>;
  slots: MotionSlotView[];
  summary: string;
}

/** A wake-up / go-to-sleep routine (bridge behavior_instance), or another automation managed in the Hue app. */
export interface RoutineView {
  id: string;
  name: string;
  kind: 'wake_up' | 'go_to_sleep' | 'other';
  scriptId: string;
  scriptName?: string;
  enabled: boolean;
  status?: string;
  where: { id: string; kind: 'room' | 'zone'; name: string }[];
  time?: string;
  days?: string[];
  fadeMinutes?: number;
  endBrightness?: number;
  turnOffAfterMinutes?: number | null;
  endState?: 'nightlight' | 'turn_off';
  summary: string;
  /** Verbatim, for PUTs that only flip `enabled`. */
  configuration: Record<string, unknown>;
}

export interface HomeModel {
  bridge?: BridgeInfo;
  routines: RoutineView[];
  lights: LightView[];
  groups: GroupView[];
  rooms: GroupView[];
  zones: GroupView[];
  home?: GroupView;
  scenes: SceneView[];
  accessories: AccessoryView[];
  cameras: CameraView[];
  motionAutomations: MotionAutomationView[];
  lightById: Record<string, LightView>;
  groupById: Record<string, GroupView>;
  sceneById: Record<string, SceneView>;
  totalLightsOn: number;
  updatedAt: number;
}

export const EMPTY_HOME: HomeModel = {
  lights: [],
  groups: [],
  rooms: [],
  zones: [],
  scenes: [],
  accessories: [],
  cameras: [],
  motionAutomations: [],
  routines: [],
  lightById: {},
  groupById: {},
  sceneById: {},
  totalLightsOn: 0,
  updatedAt: 0,
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Deep-merge a partial resource update (event stream) into an existing resource. Arrays are replaced. */
export function mergeResource<T>(existing: T, patch: Partial<T>): T {
  if (!isObject(existing) || !isObject(patch)) return (patch as T) ?? existing;
  const out: Record<string, unknown> = { ...existing };
  for (const [k, v] of Object.entries(patch)) {
    if (isObject(v) && isObject(out[k])) out[k] = mergeResource(out[k], v);
    else out[k] = v;
  }
  return out as T;
}

/** Apply event stream updates to a resource map. Returns true if anything changed. */
export function applyEvents(map: Map<string, Resource>, events: EventStreamUpdate[]): boolean {
  let changed = false;
  for (const ev of events) {
    if (!Array.isArray(ev.data)) continue;
    for (const item of ev.data) {
      if (!item?.id) continue;
      if (ev.type === 'delete') {
        changed = map.delete(item.id) || changed;
      } else if (ev.type === 'add') {
        map.set(item.id, item as Resource);
        changed = true;
      } else if (ev.type === 'update') {
        const existing = map.get(item.id);
        map.set(item.id, existing ? mergeResource(existing, item as Partial<Resource>) : (item as Resource));
        changed = true;
      }
    }
  }
  return changed;
}

function powerOnView(p: LightResource['powerup']): PowerOnView | undefined {
  if (!p?.preset) return undefined;
  return {
    preset: p.preset,
    on: p.on?.mode,
    brightness: p.dimming?.mode === 'dimming' ? p.dimming.dimming?.brightness : undefined,
    mirek: p.color?.mode === 'color_temperature' ? p.color.color_temperature?.mirek : undefined,
    xy: p.color?.mode === 'color' ? p.color.color?.xy : undefined,
  };
}

export function lightLevelToLux(level: number): number {
  return Math.round(Math.pow(10, (level - 1) / 10000));
}

function pickEffects(light: LightResource): { values: string[]; status: string; v2: boolean } {
  if (light.effects_v2) {
    return {
      values: light.effects_v2.action?.effect_values ?? light.effects_v2.status?.effect_values ?? [],
      status: light.effects_v2.status?.effect ?? 'no_effect',
      v2: true,
    };
  }
  if (light.effects) {
    return { values: light.effects.effect_values ?? [], status: light.effects.status ?? 'no_effect', v2: false };
  }
  return { values: [], status: 'no_effect', v2: false };
}

export function lightHex(light: Pick<LightView, 'colorMode' | 'xy' | 'mirek' | 'on'>): string {
  if (light.colorMode === 'xy' && light.xy) return xyToHex(light.xy);
  if (light.colorMode === 'ct' && light.mirek) return mirekToHex(light.mirek);
  return '#ffe4b5';
}

export const FLOODLIGHT_CAMERA_ARCHETYPE = 'hue_floodlight_camera';

/**
 * A camera device: has a `camera_motion` service or a product name containing "camera",
 * but is not itself a light (the floodlight of a Secure floodlight camera is a separate light device).
 */
export function isCameraDevice(d: DeviceResource): boolean {
  const services = Array.isArray(d.services) ? d.services : [];
  if (services.some((s) => s?.rtype === 'light')) return false;
  if (services.some((s) => s?.rtype === 'camera_motion')) return true;
  return /camera/i.test(d.product_data?.product_name ?? '');
}

/** Lower-case name without trailing digits/punctuation, for pairing "Secure floodlight camera 1" with "Secure floodlight camera". */
function pairingKey(name: string | undefined): string {
  return String(name ?? '')
    .toLowerCase()
    .replace(/[\s\-_#]*\d+\s*$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function nameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.startsWith(b) || b.startsWith(a)) return 0.9;
  const ta = a.split(' ');
  const tb = new Set(b.split(' '));
  const overlap = ta.filter((t) => tb.has(t)).length;
  return overlap ? overlap / Math.max(ta.length, tb.size) : 0;
}

export function buildHome(resources: Iterable<Resource>): HomeModel {
  const byId = new Map<string, Resource>();
  for (const r of resources) byId.set(r.id, r);

  const lightsRaw: LightResource[] = [];
  const groupsRaw: GroupResource[] = [];
  const groupedRaw = new Map<string, GroupedLightResource>();
  const scenesRaw: SceneResource[] = [];
  const devicesRaw = new Map<string, DeviceResource>();
  const zigbee = new Map<string, ZigbeeConnectivityResource>(); // by owner device id
  const power = new Map<string, DevicePowerResource>();
  const motions = new Map<string, MotionResource>();
  const temps = new Map<string, TemperatureResource>();
  const levels = new Map<string, LightLevelResource>();
  const contacts = new Map<string, ContactResource>();
  const buttons = new Map<string, ButtonResource[]>();
  let bridgeRaw: BridgeResource | undefined;
  let bridgeHome: BridgeHomeResource | undefined;
  const behaviors: BehaviorInstanceResource[] = [];
  const scriptNames = new Map<string, string>();

  for (const r of byId.values()) {
    switch (r.type) {
      case 'behavior_instance':
        behaviors.push(r as BehaviorInstanceResource);
        break;
      case 'behavior_script': {
        const name = (r as unknown as { metadata?: { name?: string } }).metadata?.name;
        if (name) scriptNames.set(r.id, name);
        break;
      }
      case 'light':
        lightsRaw.push(r as LightResource);
        break;
      case 'room':
      case 'zone':
        groupsRaw.push(r as GroupResource);
        break;
      case 'grouped_light':
        groupedRaw.set(r.id, r as GroupedLightResource);
        break;
      case 'scene':
        scenesRaw.push(r as SceneResource);
        break;
      case 'device':
        devicesRaw.set(r.id, r as DeviceResource);
        break;
      case 'zigbee_connectivity':
        if (r.owner) zigbee.set(r.owner.rid, r as ZigbeeConnectivityResource);
        break;
      case 'device_power':
        if (r.owner) power.set(r.owner.rid, r as DevicePowerResource);
        break;
      case 'motion':
      case 'camera_motion':
        if (r.owner) motions.set(r.owner.rid, r as MotionResource);
        break;
      case 'temperature':
        if (r.owner) temps.set(r.owner.rid, r as TemperatureResource);
        break;
      case 'light_level':
        if (r.owner) levels.set(r.owner.rid, r as LightLevelResource);
        break;
      case 'contact':
        if (r.owner) contacts.set(r.owner.rid, r as ContactResource);
        break;
      case 'button':
        if (r.owner) {
          const list = buttons.get(r.owner.rid) ?? [];
          list.push(r as ButtonResource);
          buttons.set(r.owner.rid, list);
        }
        break;
      case 'bridge':
        bridgeRaw = r as BridgeResource;
        break;
      case 'bridge_home':
        bridgeHome = r as BridgeHomeResource;
        break;
      default:
        break;
    }
  }

  // Lights ------------------------------------------------------------------
  const lightById: Record<string, LightView> = {};
  const lights: LightView[] = [];
  for (const l of lightsRaw) {
    const device = l.owner ? devicesRaw.get(l.owner.rid) : undefined;
    const effects = pickEffects(l);
    const supportsColor = !!l.color?.xy;
    const supportsCt = !!l.color_temperature?.mirek_schema;
    const mirekValid = l.color_temperature?.mirek_valid !== false && typeof l.color_temperature?.mirek === 'number';
    const colorMode: LightView['colorMode'] = supportsColor && !(supportsCt && mirekValid) ? 'xy' : supportsCt && mirekValid ? 'ct' : supportsColor ? 'xy' : 'none';
    const view: LightView = {
      id: l.id,
      idV1: l.id_v1,
      name: l.metadata?.name ?? device?.metadata?.name ?? 'Light',
      archetype: l.metadata?.archetype ?? device?.metadata?.archetype ?? 'unknown_archetype',
      deviceId: device?.id,
      zoneIds: [],
      on: !!l.on?.on,
      brightness: l.dimming?.brightness ?? (l.on?.on ? 100 : 0),
      minBrightness: l.dimming?.min_dim_level ?? 1,
      supportsDimming: !!l.dimming,
      supportsColor,
      supportsColorTemperature: supportsCt,
      colorMode,
      xy: l.color?.xy,
      gamut: l.color?.gamut ?? GAMUT_C,
      gamutType: l.color?.gamut_type,
      mirek: mirekValid ? (l.color_temperature!.mirek as number) : undefined,
      mirekMin: l.color_temperature?.mirek_schema?.mirek_minimum ?? 153,
      mirekMax: l.color_temperature?.mirek_schema?.mirek_maximum ?? 500,
      kelvin: mirekValid ? mirekToKelvin(l.color_temperature!.mirek as number) : undefined,
      hex: '#ffe4b5',
      effects: effects.values,
      effect: effects.status,
      effectsV2: effects.v2,
      timedEffects: l.timed_effects?.effect_values ?? [],
      dynamicsActive: l.dynamics?.status === 'dynamic_palette',
      gradientPoints: l.gradient?.points?.map((p) => p.color.xy),
      powerOn: powerOnView(l.powerup),
      connectivity: device ? zigbee.get(device.id)?.status : undefined,
      productName: device?.product_data?.product_name,
      modelId: device?.product_data?.model_id,
      softwareVersion: device?.product_data?.software_version,
      streaming: l.mode === 'streaming',
    };
    view.hex = lightHex(view);
    lightById[l.id] = view;
    lights.push(view);
  }

  // Groups ------------------------------------------------------------------
  const groupById: Record<string, GroupView> = {};
  const groups: GroupView[] = [];
  const lightsOfGroup = (g: GroupResource | BridgeHomeResource): { lightIds: string[]; deviceIds: string[] } => {
    const lightIds: string[] = [];
    const deviceIds: string[] = [];
    for (const child of g.children ?? []) {
      if (child.rtype === 'light') {
        if (lightById[child.rid]) lightIds.push(child.rid);
      } else if (child.rtype === 'device') {
        deviceIds.push(child.rid);
        const dev = devicesRaw.get(child.rid);
        for (const s of dev?.services ?? []) if (s.rtype === 'light' && lightById[s.rid]) lightIds.push(s.rid);
      } else if (child.rtype === 'room') {
        const room = byId.get(child.rid) as GroupResource | undefined;
        if (room) {
          const inner = lightsOfGroup(room);
          lightIds.push(...inner.lightIds);
          deviceIds.push(...inner.deviceIds);
        }
      }
    }
    return { lightIds: [...new Set(lightIds)], deviceIds: [...new Set(deviceIds)] };
  };

  const makeGroupView = (g: GroupResource | BridgeHomeResource, kind: GroupView['kind'], name: string, archetype: string): GroupView => {
    const glRef = (g.services ?? []).find((s) => s.rtype === 'grouped_light');
    const gl = glRef ? groupedRaw.get(glRef.rid) : undefined;
    const { lightIds, deviceIds } = lightsOfGroup(g);
    const members = lightIds.map((id) => lightById[id]);
    const anyOn = members.some((l) => l.on);
    const onMembers = members.filter((l) => l.on);
    const avgBri = onMembers.length ? onMembers.reduce((a, l) => a + l.brightness, 0) / onMembers.length : 0;
    const colors = [...new Set(onMembers.map((l) => l.hex))].slice(0, 6);
    return {
      id: g.id,
      idV1: g.id_v1,
      kind,
      name,
      archetype,
      groupedLightId: gl?.id ?? glRef?.rid,
      lightIds,
      deviceIds,
      on: gl?.on?.on ?? anyOn,
      anyOn,
      brightness: gl?.dimming?.brightness && gl.dimming.brightness > 0 ? gl.dimming.brightness : Math.round(avgBri),
      sceneIds: [],
      colors,
    };
  };

  for (const g of groupsRaw) {
    const view = makeGroupView(g, g.type, g.metadata?.name ?? g.type, g.metadata?.archetype ?? 'other');
    groupById[g.id] = view;
    groups.push(view);
    if (g.type === 'room') {
      for (const id of view.lightIds) {
        lightById[id].roomId = g.id;
        lightById[id].roomName = view.name;
      }
    } else {
      for (const id of view.lightIds) lightById[id].zoneIds.push(g.id);
    }
  }
  groups.sort((a, b) => a.name.localeCompare(b.name));

  let home: GroupView | undefined;
  if (bridgeHome) {
    home = makeGroupView(bridgeHome, 'home', 'All lights', 'home');
    home.lightIds = lights.map((l) => l.id);
    home.anyOn = lights.some((l) => l.on);
  }

  // Scenes ------------------------------------------------------------------
  const sceneById: Record<string, SceneView> = {};
  const scenes: SceneView[] = [];
  for (const s of scenesRaw) {
    const group = groupById[s.group?.rid];
    const palette: string[] = [];
    for (const c of s.palette?.color ?? []) if (c?.color?.xy) palette.push(xyToHex(c.color.xy));
    for (const c of s.palette?.color_temperature ?? []) if (c?.color_temperature?.mirek) palette.push(mirekToHex(c.color_temperature.mirek));
    if (!palette.length) {
      for (const a of s.actions ?? []) {
        if (a.action?.color?.xy) palette.push(xyToHex(a.action.color.xy));
        else if (a.action?.color_temperature?.mirek) palette.push(mirekToHex(a.action.color_temperature.mirek));
      }
    }
    const view: SceneView = {
      id: s.id,
      idV1: s.id_v1,
      name: s.metadata?.name ?? 'Scene',
      groupId: s.group?.rid,
      groupType: (s.group?.rtype as 'room' | 'zone') ?? 'room',
      groupName: group?.name ?? '',
      active: s.status?.active ?? 'inactive',
      lastRecall: s.status?.last_recall,
      palette: [...new Set(palette)].slice(0, 8),
      speed: s.speed ?? 0.5,
      autoDynamic: !!s.auto_dynamic,
      supportsDynamic: (s.palette?.color?.length ?? 0) > 1,
      lightCount: s.actions?.length ?? 0,
      actions: s.actions ?? [],
    };
    sceneById[s.id] = view;
    scenes.push(view);
    if (group) {
      group.sceneIds.push(s.id);
      if (view.active !== 'inactive') group.activeSceneId = s.id;
    }
  }
  scenes.sort((a, b) => a.groupName.localeCompare(b.groupName) || a.name.localeCompare(b.name));

  // Cameras -------------------------------------------------------------------
  const roomOfDevice = new Map<string, GroupView>();
  for (const g of groupsRaw) {
    if (g.type !== 'room') continue;
    for (const child of g.children ?? []) if (child?.rtype === 'device' && groupById[g.id]) roomOfDevice.set(child.rid, groupById[g.id]);
  }
  const cameras: CameraView[] = [];
  const cameraDeviceIds = new Set<string>();
  for (const d of devicesRaw.values()) {
    if (!isCameraDevice(d)) continue;
    cameraDeviceIds.add(d.id);
    const m = motions.get(d.id);
    const ll = levels.get(d.id);
    const p = power.get(d.id);
    const modelId = d.product_data?.model_id ?? '';
    const rawLevel = ll?.light?.light_level ?? ll?.light?.light_level_report?.light_level;
    const motionValid = m ? m.motion?.motion_valid !== false : false;
    const motionRaw = m?.motion?.motion ?? m?.motion?.motion_report?.motion;
    const room = roomOfDevice.get(d.id);
    cameras.push({
      id: d.id,
      name: d.metadata?.name ?? d.product_data?.product_name ?? 'Camera',
      productName: d.product_data?.product_name ?? '',
      modelId,
      softwareVersion: d.product_data?.software_version,
      kind: /^CMW/i.test(modelId) ? 'floodlight' : p || /^CMB/i.test(modelId) ? 'battery' : 'camera',
      connectivity: zigbee.get(d.id)?.status,
      batteryLevel: typeof p?.power_state?.battery_level === 'number' ? p.power_state.battery_level : null,
      batteryState: p?.power_state?.battery_state ?? null,
      motion: m && motionValid && typeof motionRaw === 'boolean' ? motionRaw : null,
      motionEnabled: m ? m.enabled !== false : false,
      motionChanged: m?.motion?.motion_report?.changed ?? null,
      lux: typeof rawLevel === 'number' && ll?.light?.light_level_valid !== false ? lightLevelToLux(rawLevel) : null,
      lightLevelChanged: ll?.light?.light_level_report?.changed ?? null,
      cameraMotionId: m?.id ?? null,
      lightLevelId: ll?.id ?? null,
      floodlightLightId: null,
      roomId: room?.id,
      roomName: room?.name,
    });
  }
  // Pair floodlight cameras (CMW002) with their floodlight light device (archetype hue_floodlight_camera).
  const floodlights = lights.filter((l) => {
    const dev = l.deviceId ? devicesRaw.get(l.deviceId) : undefined;
    return l.archetype === FLOODLIGHT_CAMERA_ARCHETYPE || dev?.product_data?.product_archetype === FLOODLIGHT_CAMERA_ARCHETYPE || dev?.metadata?.archetype === FLOODLIGHT_CAMERA_ARCHETYPE;
  });
  if (floodlights.length) {
    let camCandidates = cameras.filter((c) => c.kind === 'floodlight');
    if (!camCandidates.length) camCandidates = cameras.filter((c) => c.batteryLevel === null);
    if (!camCandidates.length) camCandidates = cameras;
    if (floodlights.length === 1 && camCandidates.length === 1) {
      camCandidates[0].floodlightLightId = floodlights[0].id;
    } else {
      const pairs: { cam: CameraView; light: LightView; score: number }[] = [];
      for (const cam of camCandidates) {
        for (const light of floodlights) {
          let score = nameSimilarity(pairingKey(cam.name), pairingKey(light.name));
          if (cam.roomId && light.roomId === cam.roomId) score += 0.5;
          pairs.push({ cam, light, score });
        }
      }
      pairs.sort((a, b) => b.score - a.score || a.cam.name.localeCompare(b.cam.name));
      const usedLights = new Set<string>();
      for (const p of pairs) {
        if (p.cam.floodlightLightId || usedLights.has(p.light.id)) continue;
        p.cam.floodlightLightId = p.light.id;
        usedLights.add(p.light.id);
      }
    }
    for (const cam of cameras) if (cam.floodlightLightId && cam.kind !== 'floodlight') cam.kind = 'floodlight';
  }
  cameras.sort((a, b) => a.name.localeCompare(b.name));

  // Accessories --------------------------------------------------------------
  const roomOfAccessory = new Map<string, GroupView>();
  for (const g of groups) if (g.kind === 'room') for (const did of g.deviceIds) roomOfAccessory.set(did, g);
  const accessories: AccessoryView[] = [];
  for (const d of devicesRaw.values()) {
    const hasLight = (d.services ?? []).some((s) => s.rtype === 'light');
    if (hasLight) continue;
    if (cameraDeviceIds.has(d.id)) continue; // cameras are listed in home.cameras, not as motion sensors
    const m = motions.get(d.id);
    const t = temps.get(d.id);
    const ll = levels.get(d.id);
    const c = contacts.get(d.id);
    const btns = buttons.get(d.id) ?? [];
    const p = power.get(d.id);
    const isBridge = (d.services ?? []).some((s) => s.rtype === 'bridge');
    const kind: AccessoryView['kind'] = isBridge ? 'bridge' : m ? 'motion' : btns.length ? 'switch' : c ? 'contact' : 'other';
    if (kind === 'other' && !t && !ll && !p) continue;
    accessories.push({
      deviceId: d.id,
      roomId: roomOfAccessory.get(d.id)?.id,
      roomName: roomOfAccessory.get(d.id)?.name,
      name: d.metadata?.name ?? d.product_data?.product_name ?? 'Device',
      productName: d.product_data?.product_name ?? '',
      modelId: d.product_data?.model_id ?? '',
      archetype: d.metadata?.archetype ?? d.product_data?.product_archetype ?? 'unknown',
      kind,
      softwareVersion: d.product_data?.software_version,
      battery: p ? { level: p.power_state?.battery_level, state: p.power_state?.battery_state } : undefined,
      connectivity: zigbee.get(d.id)?.status,
      motion: m
        ? {
            sensorId: m.id,
            active: !!(m.motion?.motion ?? m.motion?.motion_report?.motion),
            valid: m.motion?.motion_valid !== false,
            enabled: m.enabled !== false,
            changed: m.motion?.motion_report?.changed,
            sensitivity: m.sensitivity?.sensitivity,
            sensitivityMax: m.sensitivity?.sensitivity_max,
          }
        : undefined,
      temperature: t
        ? {
            sensorId: t.id,
            celsius: t.temperature?.temperature ?? t.temperature?.temperature_report?.temperature,
            changed: t.temperature?.temperature_report?.changed,
            enabled: t.enabled !== false,
          }
        : undefined,
      lightLevel: ll
        ? {
            sensorId: ll.id,
            raw: ll.light?.light_level ?? ll.light?.light_level_report?.light_level,
            lux:
              typeof (ll.light?.light_level ?? ll.light?.light_level_report?.light_level) === 'number'
                ? lightLevelToLux((ll.light?.light_level ?? ll.light?.light_level_report?.light_level) as number)
                : undefined,
            changed: ll.light?.light_level_report?.changed,
            enabled: ll.enabled !== false,
          }
        : undefined,
      contact: c ? { sensorId: c.id, state: c.contact_report?.state, changed: c.contact_report?.changed, enabled: c.enabled !== false } : undefined,
      buttons: btns
        .sort((a, b) => (a.metadata?.control_id ?? 0) - (b.metadata?.control_id ?? 0))
        .map((b) => ({
          id: b.id,
          controlId: b.metadata?.control_id ?? 0,
          lastEvent: b.button?.button_report?.event ?? b.button?.last_event,
          updated: b.button?.button_report?.updated,
        })),
    });
  }
  accessories.sort((a, b) => a.name.localeCompare(b.name));

  // Bridge -------------------------------------------------------------------
  let bridge: BridgeInfo | undefined;
  if (bridgeRaw) {
    const dev = bridgeRaw.owner ? devicesRaw.get(bridgeRaw.owner.rid) : undefined;
    bridge = {
      id: bridgeRaw.id,
      bridgeId: bridgeRaw.bridge_id,
      name: dev?.metadata?.name ?? 'Hue Bridge',
      timeZone: bridgeRaw.time_zone?.time_zone,
      modelId: dev?.product_data?.model_id,
      softwareVersion: dev?.product_data?.software_version,
      homeGroupedLightId: home?.groupedLightId,
    };
  }

  lights.sort((a, b) => (a.roomName ?? '~').localeCompare(b.roomName ?? '~') || a.name.localeCompare(b.name));

  // Motion automations ---------------------------------------------------------
  const motionAutomations: MotionAutomationView[] = [];
  for (const b of behaviors) {
    if (!isMotionAutomation(b)) continue;
    const spec = parseAccessoryConfiguration(b.configuration);
    if (!spec) continue;
    const device = devicesRaw.get(spec.sourceDeviceId);
    const sceneName = (id: string) => sceneById[id]?.name ?? 'scene';
    const toView = (a: MotionAction): MotionActionView => (a.kind === 'scene' ? { kind: 'scene', sceneId: a.sceneId, sceneName: sceneName(a.sceneId) } : { kind: a.kind });
    motionAutomations.push({
      id: b.id,
      name: b.metadata?.name?.trim() || device?.metadata?.name || 'Motion automation',
      enabled: b.enabled !== false,
      status: b.status,
      lastError: b.last_error || undefined,
      sourceDeviceId: spec.sourceDeviceId,
      sourceName: device?.metadata?.name ?? device?.product_data?.product_name ?? 'Sensor',
      sourceKind: spec.motionType === 'camera_motion' || cameraDeviceIds.has(spec.sourceDeviceId) ? 'camera' : 'sensor',
      motionServiceId: spec.motionServiceId,
      motionType: spec.motionType,
      where: spec.where.map((w) => ({ ...w, name: groupById[w.id]?.name ?? 'room' })),
      onlyWhenDark: spec.darkness.mode !== 'any',
      darkness: spec.darkness,
      lightLevel: (b.configuration.light_level as Record<string, unknown> | undefined) ?? undefined,
      configuration: b.configuration,
      slots: spec.slots.map((sl) => ({ start: formatMotionTime(sl.start), onMotion: toView(sl.onMotion), noMotionAfterMinutes: sl.noMotionAfterMinutes, onNoMotion: toView(sl.onNoMotion), doNotDisturb: !!sl.doNotDisturb })),
      summary: describeMotionSlots(spec.slots, sceneName, spec.darkness),
    });
  }
  motionAutomations.sort((a, b) => a.sourceName.localeCompare(b.sourceName));

  // Routines (wake up / go to sleep) and whatever else the Hue app set up ---------------
  const routines: RoutineView[] = [];
  for (const b of behaviors) {
    if (isMotionAutomation(b)) continue;
    const spec = isRoutine(b) ? parseRoutineConfiguration(b.script_id, b.configuration) : null;
    const whereRaw = ((b.configuration?.where as { group?: { rid: string; rtype: string } }[] | undefined) ?? []).map((w) => w.group).filter((g): g is { rid: string; rtype: string } => !!g?.rid);
    const where = (spec ? spec.where : whereRaw.map((g) => ({ id: g.rid, kind: (g.rtype === 'zone' ? 'zone' : 'room') as 'room' | 'zone' }))).map((w) => ({ ...w, name: groupById[w.id]?.name ?? (home && home.id === w.id ? 'All lights' : 'room') }));
    const scriptName = scriptNames.get(b.script_id);
    routines.push({
      id: b.id,
      name: b.metadata?.name?.trim() || scriptName || 'Automation',
      kind: spec?.kind ?? 'other',
      scriptId: b.script_id,
      scriptName,
      enabled: b.enabled !== false,
      status: b.status,
      where,
      time: spec ? formatMotionTime(spec.time) : undefined,
      days: spec?.days,
      fadeMinutes: spec?.fadeMinutes,
      endBrightness: spec?.endBrightness,
      turnOffAfterMinutes: spec?.turnOffAfterMinutes,
      endState: spec?.endState,
      summary: spec ? describeRoutine(spec) : `${scriptName ?? 'automation'} (managed in the Hue app)`,
      configuration: b.configuration ?? {},
    });
  }
  routines.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));

  return {
    bridge,
    lights,
    groups,
    rooms: groups.filter((g) => g.kind === 'room'),
    zones: groups.filter((g) => g.kind === 'zone'),
    home,
    scenes,
    accessories,
    cameras,
    motionAutomations,
    routines,
    lightById,
    groupById,
    sceneById,
    totalLightsOn: lights.filter((l) => l.on).length,
    updatedAt: Date.now(),
  };
}
