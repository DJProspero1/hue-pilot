import { GAMUT_C, mirekToHex, mirekToKelvin, xyToHex } from './color.ts';
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
} from './types.ts';

export interface LightView {
  id: string;
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

export interface BridgeInfo {
  id: string;
  bridgeId: string;
  name: string;
  timeZone?: string;
  modelId?: string;
  softwareVersion?: string;
  homeGroupedLightId?: string;
}

export interface HomeModel {
  bridge?: BridgeInfo;
  lights: LightView[];
  groups: GroupView[];
  rooms: GroupView[];
  zones: GroupView[];
  home?: GroupView;
  scenes: SceneView[];
  accessories: AccessoryView[];
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

  for (const r of byId.values()) {
    switch (r.type) {
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

  // Accessories --------------------------------------------------------------
  const accessories: AccessoryView[] = [];
  for (const d of devicesRaw.values()) {
    const hasLight = (d.services ?? []).some((s) => s.rtype === 'light');
    if (hasLight) continue;
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

  return {
    bridge,
    lights,
    groups,
    rooms: groups.filter((g) => g.kind === 'room'),
    zones: groups.filter((g) => g.kind === 'zone'),
    home,
    scenes,
    accessories,
    lightById,
    groupById,
    sceneById,
    totalLightsOn: lights.filter((l) => l.on).length,
    updatedAt: Date.now(),
  };
}
