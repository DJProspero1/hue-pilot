/**
 * Assistant tools shared by the desktop Gemini chat, the MCP server and the local HTTP API.
 * The Android app implements the same contract natively.
 */
import { kelvinToRgb, mirekToKelvin, parseColor, parseColorTemperature, rgbToXy } from './color.ts';
import { resolveByName } from './matching.ts';
import type { AccessoryView, CameraView, GroupView, HomeModel, LightView, SceneView } from './model.ts';
import { buildLocalTime, buildScheduleCommand, describeLocalTime, parseLocalTime, parseScheduleCommand, v1Id } from './schedules.ts';
import type { LightState, ResourceRef, ScheduleMapV1, ScheduleV1 } from './types.ts';

export interface HueClientLike {
  setLight(id: string, state: LightState, opts?: { effectsV2?: boolean }): Promise<ResourceRef[]>;
  setGroupedLight(id: string, state: LightState): Promise<ResourceRef[]>;
  recallScene(id: string, action?: 'active' | 'dynamic_palette' | 'static', durationMs?: number): Promise<ResourceRef[]>;
  identify(lightId: string): Promise<ResourceRef[]>;
  listSchedules(): Promise<ScheduleMapV1>;
  createSchedule(schedule: ScheduleV1): Promise<string>;
  deleteSchedule(id: string): Promise<unknown>;
  /** Turn a Hue Secure camera's motion detection on or off (PUT camera_motion/{id} { enabled }). */
  setCameraMotionDetection(cameraMotionId: string, enabled: boolean): Promise<ResourceRef[]>;
}

export interface ToolContext {
  client: HueClientLike;
  /** Returns the current home model (live from the event stream, or freshly fetched). */
  getHome(): Promise<HomeModel>;
  appKey: string;
  defaultTransitionMs?: number;
}

export type JsonSchema = {
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array';
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: string[];
  items?: JsonSchema;
};

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchema;
  readOnly?: boolean;
}

export interface ToolResult {
  ok: boolean;
  message?: string;
  error?: string;
  [key: string]: unknown;
}

export const EFFECTS = ['candle', 'fire', 'prism', 'sparkle', 'opal', 'glisten', 'underwater', 'cosmos', 'sunbeam', 'enchant', 'no_effect'];

const COLOR_DESC =
  'Colour name (red, orange, amber, yellow, lime, green, mint, teal, turquoise, cyan, aqua, sky blue, blue, navy, indigo, violet, purple, lavender, magenta, pink, hot pink, rose, salmon, coral, peach, white), hex like #ff8800, or a white preset (candlelight, very warm, relax, warm white, cozy, read, soft white, neutral, cool white, concentrate, energize, daylight).';
const CT_DESC = 'Colour temperature: warm, cozy, neutral, cool, daylight, or Kelvin like "3000K" (2000-6500).';

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'get_home_overview',
    description:
      'Get every room and zone with their lights (on/off, brightness, colour) and available scenes. Call this first when you need to know names or current state.',
    parameters: { type: 'object', properties: {} },
    readOnly: true,
  },
  {
    name: 'set_room',
    description:
      'Control all lights in a room or zone: turn on/off, set brightness, colour or colour temperature. Setting brightness or colour turns the lights on unless on=false is given.',
    parameters: {
      type: 'object',
      properties: {
        room: { type: 'string', description: 'Room or zone name, e.g. "Office", "Living room", "Downstairs".' },
        on: { type: 'boolean', description: 'true to turn on, false to turn off.' },
        brightness: { type: 'number', description: 'Brightness percent 1-100.' },
        color: { type: 'string', description: COLOR_DESC },
        color_temperature: { type: 'string', description: CT_DESC },
        transition_seconds: { type: 'number', description: 'Fade duration in seconds (default 0.4).' },
      },
      required: ['room'],
    },
  },
  {
    name: 'set_light',
    description: 'Control a single light by name: on/off, brightness, colour or colour temperature.',
    parameters: {
      type: 'object',
      properties: {
        light: { type: 'string', description: 'Light name, e.g. "Desk lamp".' },
        room: { type: 'string', description: 'Optional room name to disambiguate lights with the same name.' },
        on: { type: 'boolean' },
        brightness: { type: 'number', description: 'Brightness percent 1-100.' },
        color: { type: 'string', description: COLOR_DESC },
        color_temperature: { type: 'string', description: CT_DESC },
        transition_seconds: { type: 'number', description: 'Fade duration in seconds (default 0.4).' },
      },
      required: ['light'],
    },
  },
  {
    name: 'set_all_lights',
    description: 'Turn every light in the home on or off (optionally with a brightness).',
    parameters: {
      type: 'object',
      properties: {
        on: { type: 'boolean' },
        brightness: { type: 'number', description: 'Brightness percent 1-100.' },
      },
      required: ['on'],
    },
  },
  {
    name: 'activate_scene',
    description: 'Activate a scene (e.g. Relax, Energize, Concentrate, Read, Nightlight or a custom one) in a room or zone.',
    parameters: {
      type: 'object',
      properties: {
        scene: { type: 'string', description: 'Scene name.' },
        room: { type: 'string', description: 'Room or zone the scene belongs to (recommended when the same scene name exists in several rooms).' },
        dynamic: { type: 'boolean', description: 'Start the scene in dynamic (animated colour) mode.' },
      },
      required: ['scene'],
    },
  },
  {
    name: 'set_effect',
    description: 'Start or stop a light effect (candle, fire, prism, sparkle, opal, glisten, underwater, cosmos, sunbeam, enchant) on a light or on every capable light in a room. Use no_effect to stop.',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Light or room name.' },
        effect: { type: 'string', enum: EFFECTS },
      },
      required: ['target', 'effect'],
    },
  },
  {
    name: 'identify_light',
    description: 'Make a light blink briefly so the user can find it.',
    parameters: { type: 'object', properties: { light: { type: 'string', description: 'Light name.' } }, required: ['light'] },
  },
  {
    name: 'get_sensor_readings',
    description:
      'Read motion sensors, temperature, light level (lux), battery levels, the last button pressed on switches, and Hue Secure cameras (motion, motion detection on/off, ambient light, battery). The bridge exposes no camera video.',
    parameters: { type: 'object', properties: {} },
    readOnly: true,
  },
  {
    name: 'set_camera_motion_detection',
    description:
      'Turn motion detection on or off for a Hue Secure camera by name. Live video is not available through the bridge; only motion detection, light level and battery are.',
    parameters: {
      type: 'object',
      properties: {
        camera: { type: 'string', description: 'Camera name, e.g. "Front door camera".' },
        enabled: { type: 'boolean', description: 'true to enable motion detection, false to disable it.' },
      },
      required: ['camera', 'enabled'],
    },
  },
  {
    name: 'list_schedules',
    description: 'List the time-based automations (schedules) stored on the bridge.',
    parameters: { type: 'object', properties: {} },
    readOnly: true,
  },
  {
    name: 'create_schedule',
    description:
      'Create a bridge-side schedule that runs even when the app is closed: at a given time (daily, on selected weekdays, or once on a date) turn a room/zone/light on or off, set a brightness, or activate a scene.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short name for the automation.' },
        time: { type: 'string', description: 'Local time HH:MM (24h).' },
        days: {
          type: 'array',
          description: 'Weekdays: mon, tue, wed, thu, fri, sat, sun. Omit for every day. "weekdays"/"weekends" also accepted.',
          items: { type: 'string' },
        },
        once_date: { type: 'string', description: 'YYYY-MM-DD to run only once on that date.' },
        target: { type: 'string', description: 'Room, zone or light name.' },
        on: { type: 'boolean', description: 'Turn on (true) or off (false).' },
        brightness: { type: 'number', description: 'Brightness percent 1-100.' },
        scene: { type: 'string', description: 'Scene name to activate (target must be its room).' },
      },
      required: ['time', 'target'],
    },
  },
  {
    name: 'delete_schedule',
    description: 'Delete a schedule by id (see list_schedules).',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
];

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

const ALL_WORDS = new Set(['all', 'everything', 'home', 'house', 'all lights', 'every light', 'everywhere', 'whole house', 'tudo', 'casa']);

function str(v: unknown): string {
  return v === undefined || v === null ? '' : String(v);
}

function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function bool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (['true', 'on', 'yes', '1'].includes(s)) return true;
    if (['false', 'off', 'no', '0'].includes(s)) return false;
  }
  return undefined;
}

function pct(v: number | undefined): number | undefined {
  if (v === undefined) return undefined;
  const n = v <= 1 && v > 0 ? v * 100 : v;
  return Math.max(1, Math.min(100, Math.round(n)));
}

function fmtGroup(g: GroupView): string {
  return g.kind === 'zone' ? `${g.name} (zone)` : g.name;
}

function ambiguous<T extends { name: string }>(what: string, candidates: T[], extra?: (c: T) => string): ToolResult {
  return {
    ok: false,
    error: 'ambiguous',
    message: `Several ${what} match: ${candidates.map((c) => (extra ? extra(c) : c.name)).join(', ')}. Ask the user which one or be more specific.`,
    candidates: candidates.map((c) => (extra ? extra(c) : c.name)),
  };
}

function notFound(what: string, query: string, available: string[]): ToolResult {
  return {
    ok: false,
    error: 'not_found',
    message: `No ${what} called "${query}". Available: ${available.join(', ') || 'none'}.`,
    available,
  };
}

export function resolveGroup(query: string, home: HomeModel): { group?: GroupView; result?: ToolResult } {
  const q = query.trim().toLowerCase();
  if (ALL_WORDS.has(q) && home.home) return { group: home.home };
  const r = resolveByName(query, home.groups);
  if (r.match) return { group: r.match };
  if (r.candidates.length > 1) return { result: ambiguous('rooms', r.candidates, fmtGroup) };
  return { result: notFound('room or zone', query, home.groups.map(fmtGroup)) };
}

export function resolveLight(query: string, home: HomeModel, roomHint?: string): { light?: LightView; result?: ToolResult } {
  let pool = home.lights;
  if (roomHint) {
    const g = resolveGroup(roomHint, home);
    if (g.group) pool = g.group.lightIds.map((id) => home.lightById[id]).filter(Boolean);
  }
  const r = resolveByName(query, pool);
  if (r.match) return { light: r.match };
  if (r.candidates.length > 1) {
    return { result: ambiguous('lights', r.candidates, (l) => `${l.name}${l.roomName ? ` (${l.roomName})` : ''}`) };
  }
  return { result: notFound('light', query, pool.map((l) => `${l.name}${l.roomName ? ` (${l.roomName})` : ''}`)) };
}

export function resolveCamera(query: string, home: HomeModel): { camera?: CameraView; result?: ToolResult } {
  const cameras = home.cameras ?? [];
  const r = resolveByName(query, cameras);
  if (r.match) return { camera: r.match };
  if (r.candidates.length > 1) return { result: ambiguous('cameras', r.candidates) };
  return { result: notFound('camera', query, cameras.map((c) => c.name)) };
}

export function resolveScene(query: string, home: HomeModel, roomHint?: string): { scene?: SceneView; result?: ToolResult } {
  let pool = home.scenes;
  if (roomHint) {
    const g = resolveGroup(roomHint, home);
    if (g.group) pool = home.scenes.filter((s) => s.groupId === g.group!.id);
    else if (g.result) return { result: g.result };
  }
  const r = resolveByName(query, pool);
  if (r.match) return { scene: r.match };
  if (r.candidates.length > 1) return { result: ambiguous('scenes', r.candidates, (s) => `${s.name} (${s.groupName})`) };
  return { result: notFound('scene', query, pool.map((s) => `${s.name} (${s.groupName})`)) };
}

interface StateArgs {
  on?: boolean;
  brightness?: number;
  color?: string;
  color_temperature?: string | number;
  transition_seconds?: number;
}

function buildState(args: StateArgs, ctx: ToolContext, light?: LightView): { state: LightState; describe: string[]; error?: string } {
  const state: LightState = {};
  const describe: string[] = [];
  const on = bool(args.on);
  const bri = pct(num(args.brightness));
  if (on !== undefined) {
    state.on = on;
    describe.push(on ? 'on' : 'off');
  }
  if (bri !== undefined) {
    state.brightness = bri;
    describe.push(`${bri}%`);
    if (state.on === undefined) state.on = true;
  }
  const ctRaw = args.color_temperature;
  if (ctRaw !== undefined && ctRaw !== null && str(ctRaw) !== '') {
    const mirek = parseColorTemperature(ctRaw as string | number);
    if (mirek === null) return { state, describe, error: `Unknown colour temperature "${ctRaw}".` };
    applyMirek(state, mirek, light);
    describe.push(`${mirekToKelvin(mirek)}K`);
    if (state.on === undefined) state.on = true;
  } else if (args.color !== undefined && str(args.color) !== '') {
    const parsed = parseColor(str(args.color), light?.gamut);
    if (!parsed) return { state, describe, error: `Unknown colour "${args.color}". ${COLOR_DESC}` };
    if (parsed.mirek !== undefined) applyMirek(state, parsed.mirek, light);
    else if (parsed.xy) {
      if (light && !light.supportsColor) {
        if (light.supportsColorTemperature) state.mirek = light.mirekMin;
      } else state.xy = parsed.xy;
    }
    describe.push(parsed.label);
    if (state.on === undefined) state.on = true;
  }
  const t = num(args.transition_seconds);
  state.transitionMs = t !== undefined ? Math.round(t * 1000) : ctx.defaultTransitionMs;
  return { state, describe };
}

function applyMirek(state: LightState, mirek: number, light?: LightView) {
  if (light && !light.supportsColorTemperature && light.supportsColor) {
    state.xy = rgbToXy(kelvinToRgb(mirekToKelvin(mirek)), light.gamut);
    return;
  }
  const min = light?.mirekMin ?? 153;
  const max = light?.mirekMax ?? 500;
  state.mirek = Math.max(min, Math.min(max, mirek));
}

function lightSummary(l: LightView) {
  return {
    id: l.id,
    name: l.name,
    on: l.on,
    brightness: Math.round(l.brightness),
    color: l.on ? l.hex : null,
    color_temperature_kelvin: l.colorMode === 'ct' && l.kelvin ? l.kelvin : null,
    effect: l.effect && l.effect !== 'no_effect' ? l.effect : null,
    supports: {
      color: l.supportsColor,
      color_temperature: l.supportsColorTemperature,
      dimming: l.supportsDimming,
      effects: l.effects.filter((e) => e !== 'no_effect'),
    },
    reachable: l.connectivity ? l.connectivity === 'connected' : true,
  };
}

function overview(home: HomeModel) {
  const groupsOut = home.groups.map((g) => ({
    id: g.id,
    name: g.name,
    kind: g.kind,
    on: g.on,
    any_on: g.anyOn,
    brightness: Math.round(g.brightness),
    lights: g.lightIds.map((id) => home.lightById[id]).filter(Boolean).map(lightSummary),
    scenes: g.sceneIds.map((id) => home.sceneById[id]).filter(Boolean).map((s) => ({ id: s.id, name: s.name, active: s.active !== 'inactive' })),
  }));
  const inRoom = new Set(home.rooms.flatMap((g) => g.lightIds));
  return {
    ok: true,
    bridge: home.bridge ? { name: home.bridge.name, id: home.bridge.bridgeId } : undefined,
    rooms: groupsOut.filter((g) => g.kind === 'room'),
    zones: groupsOut.filter((g) => g.kind === 'zone'),
    lights_without_room: home.lights.filter((l) => !inRoom.has(l.id)).map(lightSummary),
    total_lights: home.lights.length,
    total_lights_on: home.totalLightsOn,
  };
}

function sensorReadings(home: HomeModel) {
  const sensors: Record<string, unknown>[] = [];
  const push = (a: AccessoryView, type: string, value: unknown, unit: string, updated?: string, extra?: Record<string, unknown>) =>
    sensors.push({ device: a.name, product: a.productName, type, value, unit, updated: updated ?? null, ...extra });
  for (const a of home.accessories) {
    if (a.motion) push(a, 'motion', a.motion.active, 'boolean', a.motion.changed, { enabled: a.motion.enabled });
    if (a.temperature && a.temperature.celsius !== undefined) push(a, 'temperature', Math.round(a.temperature.celsius * 10) / 10, 'C', a.temperature.changed);
    if (a.lightLevel && a.lightLevel.lux !== undefined) push(a, 'light_level', a.lightLevel.lux, 'lux', a.lightLevel.changed);
    if (a.contact) push(a, 'contact', a.contact.state, 'state', a.contact.changed);
    if (a.battery && a.battery.level !== undefined) push(a, 'battery', a.battery.level, '%', undefined, { state: a.battery.state });
    for (const b of a.buttons) if (b.lastEvent) push(a, 'button', b.lastEvent, `button ${b.controlId}`, b.updated);
    if (a.connectivity && a.connectivity !== 'connected') push(a, 'connectivity', a.connectivity, 'status');
  }
  for (const c of home.cameras ?? []) sensors.push(cameraSummary(c, home));
  return {
    ok: true,
    sensors,
    ...(home.cameras?.length ? { note: 'Camera video is not available through the bridge; only motion, light level and battery are.' } : {}),
  };
}

function cameraSummary(c: CameraView, home: HomeModel) {
  const floodlight = c.floodlightLightId ? home.lightById[c.floodlightLightId] : undefined;
  return {
    device: c.name,
    product: c.productName,
    type: 'camera',
    kind: 'camera',
    name: c.name,
    camera_type: c.kind,
    model: c.modelId,
    room: c.roomName ?? null,
    motion: c.motion,
    motion_detection_enabled: c.motionEnabled,
    last_motion: c.motionChanged,
    lux: c.lux,
    battery: c.batteryLevel,
    battery_state: c.batteryState,
    connectivity: c.connectivity ?? null,
    floodlight: floodlight ? { name: floodlight.name, on: floodlight.on, brightness: Math.round(floodlight.brightness) } : null,
    video: 'not available through the bridge (end-to-end encrypted, Hue app only)',
  };
}

function describeCamera(c: CameraView): string {
  const bits: string[] = [];
  if (c.kind === 'floodlight') bits.push('floodlight');
  if (c.batteryLevel !== null) bits.push(`battery ${c.batteryLevel}%`);
  bits.push(!c.motionEnabled ? 'motion detection off' : c.motion === true ? 'motion detected' : c.motion === false ? 'no motion' : 'motion unknown');
  if (c.connectivity && c.connectivity !== 'connected') bits.push(c.connectivity.replace(/_/g, ' '));
  return `${c.name} (${bits.join(', ')})`;
}

async function setGroupState(group: GroupView, args: StateArgs, ctx: ToolContext, home: HomeModel): Promise<ToolResult> {
  const { state, describe, error } = buildState(args, ctx);
  if (error) return { ok: false, error: 'invalid_argument', message: error };
  if (!describe.length) return { ok: false, error: 'invalid_argument', message: 'Nothing to change: give on, brightness, color or color_temperature.' };
  const members = group.lightIds.map((id) => home.lightById[id]).filter(Boolean);
  let via = 'grouped_light';
  try {
    if (!group.groupedLightId) throw new Error('no grouped light');
    await ctx.client.setGroupedLight(group.groupedLightId, state);
  } catch (err) {
    via = 'lights';
    if (!members.length) return { ok: false, error: 'bridge_error', message: `Could not control ${group.name}: ${(err as Error).message}` };
    await Promise.all(
      members.map((l) => {
        const per = buildState(args, ctx, l);
        return ctx.client.setLight(l.id, per.state).catch(() => undefined);
      }),
    );
  }
  return {
    ok: true,
    message: `${fmtGroup(group)}: ${describe.join(', ')} (${members.length} light${members.length === 1 ? '' : 's'})`,
    target: { id: group.id, name: group.name, kind: group.kind },
    applied: state,
    via,
  };
}

// -----------------------------------------------------------------------------
// Executor
// -----------------------------------------------------------------------------

export async function executeTool(name: string, rawArgs: Record<string, unknown> | undefined, ctx: ToolContext): Promise<ToolResult> {
  const args = rawArgs ?? {};
  try {
    switch (name) {
      case 'get_home_overview':
        return overview(await ctx.getHome());

      case 'set_room': {
        const home = await ctx.getHome();
        const { group, result } = resolveGroup(str(args.room), home);
        if (!group) return result!;
        return setGroupState(group, args as StateArgs, ctx, home);
      }

      case 'set_all_lights': {
        const home = await ctx.getHome();
        const on = bool(args.on);
        if (on === undefined) return { ok: false, error: 'invalid_argument', message: 'on must be true or false' };
        if (home.home) return setGroupState(home.home, { on, brightness: num(args.brightness) }, ctx, home);
        const results = await Promise.allSettled(home.groups.filter((g) => g.kind === 'room').map((g) => setGroupState(g, { on, brightness: num(args.brightness) }, ctx, home)));
        return { ok: true, message: `All lights ${on ? 'on' : 'off'} (${results.length} rooms)` };
      }

      case 'set_light': {
        const home = await ctx.getHome();
        const { light, result } = resolveLight(str(args.light), home, str(args.room) || undefined);
        if (!light) return result!;
        const { state, describe, error } = buildState(args as StateArgs, ctx, light);
        if (error) return { ok: false, error: 'invalid_argument', message: error };
        if (!describe.length) return { ok: false, error: 'invalid_argument', message: 'Nothing to change: give on, brightness, color or color_temperature.' };
        await ctx.client.setLight(light.id, state, { effectsV2: light.effectsV2 });
        return {
          ok: true,
          message: `${light.name}${light.roomName ? ` (${light.roomName})` : ''}: ${describe.join(', ')}`,
          target: { id: light.id, name: light.name, room: light.roomName ?? null },
          applied: state,
        };
      }

      case 'activate_scene': {
        const home = await ctx.getHome();
        const { scene, result } = resolveScene(str(args.scene), home, str(args.room) || undefined);
        if (!scene) return result!;
        const dynamic = bool(args.dynamic) === true && scene.supportsDynamic;
        await ctx.client.recallScene(scene.id, dynamic ? 'dynamic_palette' : 'active', ctx.defaultTransitionMs);
        return {
          ok: true,
          message: `Scene "${scene.name}" activated in ${scene.groupName}${dynamic ? ' (dynamic)' : ''}`,
          scene: { id: scene.id, name: scene.name, room: scene.groupName },
        };
      }

      case 'set_effect': {
        const home = await ctx.getHome();
        const effect = str(args.effect).toLowerCase().replace(/\s+/g, '_');
        if (!EFFECTS.includes(effect)) return { ok: false, error: 'invalid_argument', message: `Unknown effect "${args.effect}". Use one of ${EFFECTS.join(', ')}.` };
        const target = str(args.target);
        const g = resolveGroup(target, home);
        let lights: LightView[] = [];
        let label = '';
        if (g.group) {
          lights = g.group.lightIds.map((id) => home.lightById[id]).filter(Boolean);
          label = fmtGroup(g.group);
        } else {
          const l = resolveLight(target, home);
          if (!l.light) return l.result!;
          lights = [l.light];
          label = l.light.name;
        }
        const capable = lights.filter((l) => effect === 'no_effect' || l.effects.includes(effect));
        if (!capable.length) return { ok: false, error: 'unsupported', message: `No light in ${label} supports the ${effect} effect.` };
        await Promise.all(capable.map((l) => ctx.client.setLight(l.id, { on: effect === 'no_effect' ? undefined : true, effect }, { effectsV2: l.effectsV2 })));
        return {
          ok: true,
          message: effect === 'no_effect' ? `Effects stopped on ${label}` : `${effect} effect started on ${capable.map((l) => l.name).join(', ')}`,
          lights: capable.map((l) => l.name),
        };
      }

      case 'identify_light': {
        const home = await ctx.getHome();
        const { light, result } = resolveLight(str(args.light), home, str(args.room) || undefined);
        if (!light) return result!;
        await ctx.client.identify(light.id);
        return { ok: true, message: `${light.name} is blinking` };
      }

      case 'get_sensor_readings':
        return sensorReadings(await ctx.getHome());

      case 'set_camera_motion_detection': {
        const home = await ctx.getHome();
        const enabled = bool(args.enabled);
        if (enabled === undefined) return { ok: false, error: 'invalid_argument', message: 'enabled must be true or false' };
        const { camera, result } = resolveCamera(str(args.camera), home);
        if (!camera) return result!;
        if (!camera.cameraMotionId) return { ok: false, error: 'unsupported', message: `${camera.name} has no motion detection service on the bridge.` };
        await ctx.client.setCameraMotionDetection(camera.cameraMotionId, enabled);
        return {
          ok: true,
          message: `${camera.name}: motion detection ${enabled ? 'enabled' : 'disabled'}`,
          camera: { id: camera.id, name: camera.name, kind: camera.kind },
          applied: { enabled },
        };
      }

      case 'list_schedules': {
        const home = await ctx.getHome();
        const map = await ctx.client.listSchedules();
        const byV1 = new Map<string, string>();
        for (const g of home.groups) if (g.idV1) byV1.set(g.idV1, fmtGroup(g));
        for (const l of home.lights) if (l.idV1) byV1.set(l.idV1, l.name);
        const sceneByV1 = new Map<string, SceneView>();
        for (const s of home.scenes) if (s.idV1) sceneByV1.set(v1Id(s.idV1)!, s);
        const schedules = Object.entries(map).map(([id, s]) => {
          const cmd = parseScheduleCommand(s.command);
          const targetName = cmd.v1Id ? byV1.get(`/${cmd.targetKind === 'group' ? 'groups' : 'lights'}/${cmd.v1Id}`) : undefined;
          const scene = cmd.sceneV1Id ? sceneByV1.get(cmd.sceneV1Id) : undefined;
          const action = scene ? `scene "${scene.name}"` : [cmd.on !== undefined ? (cmd.on ? 'on' : 'off') : null, cmd.brightness !== undefined ? `${cmd.brightness}%` : null].filter(Boolean).join(', ');
          return {
            id,
            name: s.name,
            when: describeLocalTime(parseLocalTime(s.localtime ?? s.time ?? '')),
            status: s.status,
            target: targetName ?? cmd.v1Id ?? 'unknown',
            action: action || 'custom',
          };
        });
        return { ok: true, schedules };
      }

      case 'create_schedule': {
        const home = await ctx.getHome();
        const targetQuery = str(args.target);
        let target: { kind: 'group' | 'light'; v1Id: string; name: string; group?: GroupView } | undefined;
        const g = resolveGroup(targetQuery, home);
        if (g.group && g.group.kind !== 'home') {
          const id = v1Id(g.group.idV1);
          if (!id) return { ok: false, error: 'unsupported', message: `${g.group.name} has no v1 id; the bridge cannot schedule it.` };
          target = { kind: 'group', v1Id: id, name: fmtGroup(g.group), group: g.group };
        } else if (g.group && g.group.kind === 'home') {
          target = { kind: 'group', v1Id: '0', name: 'All lights', group: g.group };
        } else {
          const l = resolveLight(targetQuery, home);
          if (!l.light) return g.result && g.result.error === 'ambiguous' ? g.result : l.result!;
          const id = v1Id(l.light.idV1);
          if (!id) return { ok: false, error: 'unsupported', message: `${l.light.name} has no v1 id; the bridge cannot schedule it.` };
          target = { kind: 'light', v1Id: id, name: l.light.name };
        }
        let sceneV1: string | undefined;
        let sceneName: string | undefined;
        if (str(args.scene)) {
          if (target.kind !== 'group') return { ok: false, error: 'invalid_argument', message: 'Scenes can only be scheduled for a room or zone.' };
          const s = resolveScene(str(args.scene), home, target.group && target.group.kind !== 'home' ? target.group.name : undefined);
          if (!s.scene) return s.result!;
          sceneV1 = v1Id(s.scene.idV1);
          sceneName = s.scene.name;
          if (!sceneV1) return { ok: false, error: 'unsupported', message: `Scene ${s.scene.name} cannot be scheduled (no v1 id).` };
        }
        const on = bool(args.on);
        const brightness = pct(num(args.brightness));
        if (on === undefined && brightness === undefined && !sceneV1) {
          return { ok: false, error: 'invalid_argument', message: 'Give on, brightness or scene for the schedule action.' };
        }
        let localtime: string;
        try {
          localtime = buildLocalTime({ time: str(args.time), days: (args.days as string[] | string | undefined) ?? undefined, onceDate: str(args.once_date) || undefined });
        } catch (err) {
          return { ok: false, error: 'invalid_argument', message: (err as Error).message };
        }
        const actionLabel = sceneName ? `scene "${sceneName}"` : [on !== undefined ? (on ? 'on' : 'off') : null, brightness !== undefined ? `${brightness}%` : null].filter(Boolean).join(' ');
        const name = str(args.name) || `${target.name} ${actionLabel}`.slice(0, 32);
        const schedule: ScheduleV1 = {
          name,
          description: 'Created by Hue Pilot',
          command: buildScheduleCommand({ appKey: ctx.appKey, target, on, brightness, sceneV1Id: sceneV1 }),
          localtime,
          status: 'enabled',
          autodelete: !!str(args.once_date),
        };
        const id = await ctx.client.createSchedule(schedule);
        return {
          ok: true,
          message: `Schedule "${name}" created: ${describeLocalTime(parseLocalTime(localtime))} → ${target.name} ${actionLabel}`,
          id,
          when: describeLocalTime(parseLocalTime(localtime)),
        };
      }

      case 'delete_schedule': {
        const id = str(args.id);
        if (!id) return { ok: false, error: 'invalid_argument', message: 'id is required' };
        await ctx.client.deleteSchedule(id);
        return { ok: true, message: `Schedule ${id} deleted` };
      }

      default:
        return { ok: false, error: 'unknown_tool', message: `Unknown tool ${name}` };
    }
  } catch (err) {
    return { ok: false, error: 'bridge_error', message: (err as Error).message ?? String(err) };
  }
}

export function buildSystemPrompt(home: HomeModel, extra?: string): string {
  const rooms = home.groups
    .map((g) => {
      const lights = g.lightIds.map((id) => home.lightById[id]?.name).filter(Boolean).join(', ');
      const scenes = g.sceneIds.map((id) => home.sceneById[id]?.name).filter(Boolean).join(', ');
      return `- ${fmtGroup(g)}: lights [${lights}]${scenes ? `; scenes [${scenes}]` : ''}`;
    })
    .join('\n');
  const cameras = (home.cameras ?? []).map(describeCamera).join(', ');
  return [
    'You are Hue Pilot, a friendly assistant that controls the Philips Hue lights in the user\'s home through tools.',
    'Always act with tools rather than describing what you would do. Prefer set_room for whole rooms and set_light for a single lamp.',
    'If a name is ambiguous or not found, ask a short clarifying question. Keep answers to one or two short sentences, confirm what you changed.',
    'Reply in the language the user writes in. Brightness is 1-100%. "Dim" means around 30%, "bright" means 100%.',
    'Never invent rooms, lights or scenes; use get_home_overview when unsure.',
    cameras
      ? 'Hue Secure cameras: use get_sensor_readings for motion/battery/light level and set_camera_motion_detection to switch motion detection. The bridge exposes no video; live view is only in the Philips Hue app, or on a Nest Hub / Echo Show / Fire TV after linking Hue to Google Home or Alexa.'
      : '',
    '',
    'Home layout:',
    rooms || '- (no rooms configured)',
    cameras ? `Cameras: ${cameras}` : '',
    extra ?? '',
  ]
    .filter((l) => l !== undefined)
    .join('\n');
}
