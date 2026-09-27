/**
 * Assistant tools shared by the desktop Gemini chat, the MCP server and the local HTTP API.
 * The Android app implements the same contract natively.
 */
import { kelvinToRgb, mirekToKelvin, parseColor, parseColorTemperature, rgbToXy } from './color.ts';
import { normalizeName, resolveByName } from './matching.ts';
import type { AccessoryView, CameraView, GroupView, HomeModel, LightView, MotionAutomationView, RoutineView, SceneView } from './model.ts';
import { buildBehaviorInstanceBody, DEFAULT_DARK_OFFSET, DEFAULT_DARK_THRESHOLD, describeDarkness, describeMotionSlots, formatMotionTime, luxToLightLevel, parseMotionTime, type Darkness, type MotionAction, type MotionAutomationSpec, type MotionSlot } from './automations.ts';
import { buildRoutineBody, describeDays, describeRoutine, parseDays, type RoutineSpec } from './routines.ts';
import { paletteFromActions, sceneActionFor, sceneActionFromLight } from './scenes.ts';
import { buildLocalTime, buildScheduleCommand, describeLocalTime, parseLocalTime, parseScheduleCommand, v1Id } from './schedules.ts';
import type { LightState, ResourceRef, ResourceType, SceneAction, ScheduleMapV1, ScheduleV1 } from './types.ts';

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
  /** Motion sensing on/off for a motion sensor or a camera. */
  setSensorEnabled(type: 'motion' | 'camera_motion', id: string, enabled: boolean): Promise<ResourceRef[]>;
  createBehaviorInstance(body: Record<string, unknown>): Promise<ResourceRef[]>;
  updateBehaviorInstance(id: string, body: Record<string, unknown>): Promise<ResourceRef[]>;
  deleteBehaviorInstance(id: string): Promise<ResourceRef[]>;
  updateResource(type: ResourceType, id: string, body: unknown): Promise<ResourceRef[]>;
  createResource(type: ResourceType, body: unknown): Promise<ResourceRef[]>;
  deleteResource(type: ResourceType, id: string): Promise<ResourceRef[]>;
  createScene(input: { name: string; group: ResourceRef; actions: SceneAction[]; speed?: number; autoDynamic?: boolean; palette?: unknown }): Promise<ResourceRef[]>;
  updateScene(id: string, patch: Record<string, unknown>): Promise<ResourceRef[]>;
  deleteScene(id: string): Promise<ResourceRef[]>;
  rename(type: ResourceType, id: string, name: string): Promise<ResourceRef[]>;
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
  {
    name: 'list_motion_automations',
    description:
      'List what each motion sensor and Hue Secure camera makes the lights do on motion (the bridge-side automations, one per sensor): which room, which scene on motion, what happens after no motion, time slots, and whether it only works when dark.',
    parameters: { type: 'object', properties: {} },
    readOnly: true,
  },
  {
    name: 'set_motion_automation',
    description:
      'Create or replace the automation of a motion sensor or camera (runs on the bridge, app closed or not). Simple form: on_motion (a scene of that room, e.g. "Bright", or "nothing"), off_after_minutes, optional from/until clock window (outside it the sensor does nothing), darkness. For different day/night behaviour pass slots. Changing an existing rule keeps everything not mentioned (its time slots, rooms, darkness); a new on_motion scene goes to the slots that already recall a scene. To only pause/resume pass just sensor and enabled. When the user does not say, ask whether it should work only when dark.',
    parameters: {
      type: 'object',
      properties: {
        sensor: { type: 'string', description: 'Motion sensor or camera name.' },
        room: { type: 'string', description: 'Room or zone whose lights it controls. Defaults to the existing automation\'s rooms.' },
        rooms: { type: 'array', description: 'Several rooms/zones to control at once (replaces room).', items: { type: 'string' } },
        darkness: { type: 'string', enum: ['any', 'sunset_to_sunrise', 'sensor'], description: 'When the rule may act: "any" time; "sunset_to_sunrise" by the sun (with offsets); "sensor" when the sensor\'s own light reading is below dark_threshold_lux (the "daylight sensitivity" of the Hue app).' },
        sunset_offset_minutes: { type: 'number', description: 'sunset_to_sunrise: start this many minutes after sunset (negative = before, default -30).' },
        sunrise_offset_minutes: { type: 'number', description: 'sunset_to_sunrise: stop this many minutes after sunrise (negative = before, default 30).' },
        dark_threshold_lux: { type: 'number', description: 'sensor: counts as dark below this many lux (default about 5).' },
        on_motion: { type: 'string', description: 'Scene name to activate when motion starts (must belong to the room), "on" for the room\'s brightest scene, or "nothing".' },
        off_after_minutes: { type: 'number', description: 'Minutes without motion before on_no_motion happens (default 5).' },
        on_no_motion: { type: 'string', description: '"off" (default), "nothing", or a scene name.' },
        from: { type: 'string', description: 'Start of the active window, HH:MM. Omit for all day.' },
        until: { type: 'string', description: 'End of the active window, HH:MM.' },
        only_when_dark: { type: 'boolean', description: 'Shortcut: true = keep/enable a darkness condition (sunset to sunrise unless one is set), false = any time.' },
        do_not_disturb: { type: 'boolean', description: 'true = leave the lights alone when someone changed them by hand.' },
        enabled: { type: 'boolean', description: 'false pauses the automation, true resumes it.' },
        name: { type: 'string', description: 'Optional name; defaults to the sensor name.' },
        slots: {
          type: 'array',
          description: 'Advanced: time slots, each active from its "from" until the next slot. Replaces on_motion/off_after_minutes/on_no_motion/from/until.',
          items: {
            type: 'object',
            properties: {
              from: { type: 'string', description: 'HH:MM' },
              on_motion: { type: 'string', description: 'Scene name, "on" or "nothing".' },
              off_after_minutes: { type: 'number' },
              on_no_motion: { type: 'string', description: '"off", "nothing" or a scene name.' },
            },
            required: ['from'],
          },
        },
      },
      required: ['sensor'],
    },
  },
  {
    name: 'delete_motion_automation',
    description: 'Remove the motion automation of a sensor or camera, so motion no longer changes any light.',
    parameters: { type: 'object', properties: { sensor: { type: 'string', description: 'Motion sensor or camera name (or the automation id from list_motion_automations).' } }, required: ['sensor'] },
  },
  {
    name: 'set_motion_sensing',
    description: 'Switch motion sensing itself on or off for a motion sensor or a Hue Secure camera (off = it stops reporting motion; its automation then never fires).',
    parameters: {
      type: 'object',
      properties: { sensor: { type: 'string', description: 'Motion sensor or camera name.' }, enabled: { type: 'boolean' } },
      required: ['sensor', 'enabled'],
    },
  },
  {
    name: 'set_sensor_settings',
    description: 'Settings of a motion sensor or Hue Secure camera: motion sensing on/off, motion sensitivity, name, and the room it belongs to.',
    parameters: {
      type: 'object',
      properties: {
        sensor: { type: 'string', description: 'Motion sensor or camera name.' },
        enabled: { type: 'boolean', description: 'Motion sensing on/off.' },
        sensitivity: { type: 'string', description: '"low", "medium", "high", or a number from 0 to the sensor\'s maximum (see get_sensor_readings). Motion sensors only.' },
        name: { type: 'string', description: 'New name.' },
        room: { type: 'string', description: 'Room to move the device into.' },
      },
      required: ['sensor'],
    },
  },
  {
    name: 'rename',
    description: 'Rename a light, room, zone, scene, motion sensor or camera.',
    parameters: {
      type: 'object',
      properties: {
        what: { type: 'string', enum: ['light', 'room', 'zone', 'scene', 'sensor', 'camera'] },
        name: { type: 'string', description: 'Current name.' },
        new_name: { type: 'string', description: 'New name (max 32 characters).' },
        room: { type: 'string', description: 'For scenes and lights: the room, to disambiguate.' },
      },
      required: ['what', 'name', 'new_name'],
    },
  },
  {
    name: 'set_light_power_on_behavior',
    description: 'What a light does when power returns (wall switch / power cut): "default" warm white at full brightness, "power_loss" (last state after a power cut only, off after a switch), "last_state", or "custom" with brightness and colour.',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Light name, or a room/zone name for all its lights.' },
        mode: { type: 'string', enum: ['default', 'power_loss', 'last_state', 'custom'] },
        brightness: { type: 'number', description: 'custom: brightness 1-100.' },
        color: { type: 'string', description: 'custom: colour name or hex.' },
        color_temperature: { type: 'string', description: 'custom: warm/cool/neutral or Kelvin.' },
      },
      required: ['target', 'mode'],
    },
  },
  {
    name: 'create_group',
    description: 'Create a room (a light belongs to one room) or a zone (any lights, across rooms).',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['room', 'zone'] },
        name: { type: 'string' },
        lights: { type: 'array', description: 'Light names to put in it.', items: { type: 'string' } },
        icon: { type: 'string', description: 'Room type / icon: living_room, kitchen, dining, bedroom, kids_bedroom, bathroom, nursery, recreation, office, gym, hallway, toilet, front_door, garage, terrace, garden, driveway, carport, home, downstairs, upstairs, top_floor, attic, guest_room, staircase, lounge, man_cave, computer, studio, music, tv, reading, closet, storage, laundry_room, balcony, porch, barbecue, pool, other.' },
      },
      required: ['kind', 'name'],
    },
  },
  {
    name: 'update_group',
    description: 'Change a room or zone: rename it, change its icon, add or remove lights, or replace its lights.',
    parameters: {
      type: 'object',
      properties: {
        group: { type: 'string', description: 'Room or zone name.' },
        new_name: { type: 'string' },
        icon: { type: 'string', description: 'Room type / icon (see create_group).' },
        add_lights: { type: 'array', items: { type: 'string' } },
        remove_lights: { type: 'array', items: { type: 'string' } },
        lights: { type: 'array', description: 'Replace the whole light list.', items: { type: 'string' } },
      },
      required: ['group'],
    },
  },
  {
    name: 'delete_group',
    description: 'Delete a room or zone (its lights are kept; a room\'s lights become unassigned).',
    parameters: { type: 'object', properties: { group: { type: 'string', description: 'Room or zone name.' } }, required: ['group'] },
  },
  {
    name: 'create_scene',
    description: 'Save a scene for a room or zone: by default the current look of its lights; optionally give per-light states.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        room: { type: 'string', description: 'Room or zone.' },
        lights: {
          type: 'array',
          description: 'Optional per-light states; lights not listed keep their current state.',
          items: {
            type: 'object',
            properties: {
              light: { type: 'string' },
              on: { type: 'boolean' },
              brightness: { type: 'number' },
              color: { type: 'string' },
              color_temperature: { type: 'string' },
            },
            required: ['light'],
          },
        },
        speed: { type: 'number', description: 'Dynamic mode speed 0-1.' },
        auto_dynamic: { type: 'boolean', description: 'Start in dynamic mode when activated.' },
      },
      required: ['name', 'room'],
    },
  },
  {
    name: 'update_scene',
    description: 'Change a scene: rename, dynamic speed, auto-dynamic, change some lights\' states, or re-capture the room\'s current look.',
    parameters: {
      type: 'object',
      properties: {
        scene: { type: 'string' },
        room: { type: 'string', description: 'The scene\'s room, to disambiguate.' },
        new_name: { type: 'string' },
        speed: { type: 'number' },
        auto_dynamic: { type: 'boolean' },
        lights: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              light: { type: 'string' },
              on: { type: 'boolean' },
              brightness: { type: 'number' },
              color: { type: 'string' },
              color_temperature: { type: 'string' },
            },
            required: ['light'],
          },
        },
        from_current_state: { type: 'boolean', description: 'Replace all light states with the current look.' },
      },
      required: ['scene'],
    },
  },
  {
    name: 'delete_scene',
    description: 'Delete a scene.',
    parameters: { type: 'object', properties: { scene: { type: 'string' }, room: { type: 'string' } }, required: ['scene'] },
  },
  {
    name: 'list_routines',
    description: 'List wake-up and go-to-sleep routines (and other automations the Hue app manages, e.g. coming/leaving home).',
    parameters: { type: 'object', properties: {} },
    readOnly: true,
  },
  {
    name: 'set_wake_up',
    description: 'Create or change a wake-up routine: a sunrise that brightens the room over some minutes up to a brightness at a time on chosen days, optionally switching off later. Updates the routine with the same name, or the only one for those rooms.',
    parameters: {
      type: 'object',
      properties: {
        rooms: { type: 'array', description: 'Rooms/zones.', items: { type: 'string' } },
        time: { type: 'string', description: 'Alarm time HH:MM (the sunrise ends then).' },
        days: { type: 'array', description: 'mon..sun, weekdays, weekends; omit = every day.', items: { type: 'string' } },
        fade_minutes: { type: 'number', description: 'Sunrise length (default 30).' },
        end_brightness: { type: 'number', description: '1-100 (default 100).' },
        turn_off_after_minutes: { type: 'number', description: 'Switch off this many minutes after the alarm; 0 = stay on.' },
        enabled: { type: 'boolean' },
        name: { type: 'string' },
      },
      required: ['rooms', 'time'],
    },
  },
  {
    name: 'set_go_to_sleep',
    description: 'Create or change a go-to-sleep routine: the room dims over some minutes at a time on chosen days, ending in nightlight or off.',
    parameters: {
      type: 'object',
      properties: {
        rooms: { type: 'array', items: { type: 'string' } },
        time: { type: 'string', description: 'HH:MM when the fade starts.' },
        days: { type: 'array', items: { type: 'string' } },
        fade_minutes: { type: 'number', description: 'Default 30.' },
        end: { type: 'string', enum: ['nightlight', 'off'], description: 'Default nightlight.' },
        enabled: { type: 'boolean' },
        name: { type: 'string' },
      },
      required: ['rooms', 'time'],
    },
  },
  {
    name: 'delete_routine',
    description: 'Delete a wake-up / go-to-sleep routine by name or id (see list_routines).',
    parameters: { type: 'object', properties: { routine: { type: 'string' } }, required: ['routine'] },
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

export interface MotionSource {
  /** Device id (what resolveByName keys on). */
  id: string;
  deviceId: string;
  name: string;
  kind: 'sensor' | 'camera';
  motionServiceId: string;
  motionType: 'motion' | 'camera_motion';
  enabled: boolean;
  /** Room the device sits in (cameras only, when known). */
  roomName?: string;
}

/** Every device that can report motion: motion sensors and Hue Secure cameras. */
export function motionSources(home: HomeModel): MotionSource[] {
  const out: MotionSource[] = [];
  for (const a of home.accessories) if (a.motion) out.push({ id: a.deviceId, deviceId: a.deviceId, name: a.name, kind: 'sensor', motionServiceId: a.motion.sensorId, motionType: 'motion', enabled: a.motion.enabled });
  for (const c of home.cameras ?? []) if (c.cameraMotionId) out.push({ id: c.id, deviceId: c.id, name: c.name, kind: 'camera', motionServiceId: c.cameraMotionId, motionType: 'camera_motion', enabled: c.motionEnabled, roomName: c.roomName });
  return out;
}

/** Words that name the kind of device rather than the device: ignored when matching a sensor or camera. */
const GENERIC_SOURCE_WORDS = new Set(['sensor', 'sensors', 'camera', 'cameras', 'cam', 'motion', 'detector', 'hue', 'secure', 'camara', 'sensores', 'movimento']);

/**
 * Sensors and cameras are matched more strictly than rooms: one shared word ("garage sensor" vs
 * "Office motion sensor") is not a match, because the caller may be about to delete a rule.
 */
export function resolveMotionSource(query: string, home: HomeModel): { source?: MotionSource; result?: ToolResult } {
  const sources = motionSources(home);
  const label = (s: MotionSource) => `${s.name} (${s.kind})`;
  const tryMatch = (q: string): { source?: MotionSource; result?: ToolResult } | null => {
    if (!q.trim()) return null;
    const r = resolveByName(q, sources);
    if (r.score < 62) return null;
    if (r.match) return { source: r.match };
    if (r.candidates.length > 1) return { result: ambiguous('sensors', r.candidates, label) };
    return null;
  };
  const stripped = normalizeName(query).split(' ').filter((w) => w && !GENERIC_SOURCE_WORDS.has(w)).join(' ');
  const hit = tryMatch(stripped) ?? tryMatch(query);
  if (hit) return hit;
  // A camera is often called by its room ("the driveway camera" for the camera in Driveway).
  const q = normalizeName(stripped || query);
  const byRoom = sources.filter((s) => s.roomName && normalizeName(s.roomName) === q);
  if (byRoom.length === 1) return { source: byRoom[0] };
  return { result: notFound('motion sensor or camera', query, sources.map(label)) };
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
    if (a.motion) push(a, 'motion', a.motion.active, 'boolean', a.motion.changed, { enabled: a.motion.enabled, sensitivity: a.motion.sensitivity ?? null, sensitivity_max: a.motion.sensitivityMax ?? null, room: a.roomName ?? null });
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

      case 'list_motion_automations': {
        const home = await ctx.getHome();
        const automations = home.motionAutomations.map(automationJson);
        const without = motionSources(home).filter((s) => !home.motionAutomations.some((a) => a.sourceDeviceId === s.deviceId)).map((s) => s.name);
        return { ok: true, automations, sensors_without_automation: without };
      }

      case 'set_motion_automation':
        return setMotionAutomation(args, ctx);

      case 'delete_motion_automation': {
        const home = await ctx.getHome();
        const q = str(args.sensor) || str(args.id);
        let auto = home.motionAutomations.find((a) => a.id === q);
        if (!auto) {
          const { source, result } = resolveMotionSource(q, home);
          if (!source) return result!;
          auto = home.motionAutomations.find((a) => a.sourceDeviceId === source.deviceId);
          if (!auto) return { ok: false, error: 'not_found', message: `${source.name} has no motion automation.` };
        }
        await ctx.client.deleteBehaviorInstance(auto.id);
        return { ok: true, message: `Removed the motion automation of ${auto.sourceName}; motion no longer changes the lights.`, id: auto.id };
      }

      case 'set_sensor_settings':
        return setSensorSettings(args, ctx);
      case 'rename':
        return renameThing(args, ctx);
      case 'set_light_power_on_behavior':
        return setPowerOn(args, ctx);
      case 'create_group':
        return createGroup(args, ctx);
      case 'update_group':
        return updateGroup(args, ctx);
      case 'delete_group': {
        const home = await ctx.getHome();
        const g = resolveGroup(str(args.group), home);
        if (!g.group) return g.result!;
        if (g.group.kind === 'home') return { ok: false, error: 'invalid_argument', message: 'The whole home cannot be deleted.' };
        await ctx.client.deleteResource(g.group.kind, g.group.id);
        return { ok: true, message: `${fmtGroup(g.group)} deleted; its lights are kept.` };
      }
      case 'create_scene':
        return createScene(args, ctx);
      case 'update_scene':
        return updateScene(args, ctx);
      case 'delete_scene': {
        const home = await ctx.getHome();
        const sc = resolveScene(str(args.scene), home, str(args.room) || undefined);
        if (!sc.scene) return sc.result!;
        await ctx.client.deleteScene(sc.scene.id);
        return { ok: true, message: `Scene "${sc.scene.name}" deleted from ${sc.scene.groupName}.` };
      }
      case 'list_routines': {
        const home = await ctx.getHome();
        return { ok: true, routines: home.routines.map(routineJson) };
      }
      case 'set_wake_up':
        return setRoutine('wake_up', args, ctx);
      case 'set_go_to_sleep':
        return setRoutine('go_to_sleep', args, ctx);
      case 'delete_routine': {
        const home = await ctx.getHome();
        const r = resolveRoutine(str(args.routine), home);
        if (!r.routine) return r.result!;
        await ctx.client.deleteBehaviorInstance(r.routine.id);
        return { ok: true, message: `Routine "${r.routine.name}" deleted.`, id: r.routine.id };
      }

      case 'set_motion_sensing': {
        const home = await ctx.getHome();
        const enabled = bool(args.enabled);
        if (enabled === undefined) return { ok: false, error: 'invalid_argument', message: 'enabled must be true or false' };
        const { source, result } = resolveMotionSource(str(args.sensor), home);
        if (!source) return result!;
        await ctx.client.setSensorEnabled(source.motionType, source.motionServiceId, enabled);
        return { ok: true, message: `${source.name}: motion sensing ${enabled ? 'on' : 'off'}`, sensor: { name: source.name, kind: source.kind }, applied: { enabled } };
      }

      default:
        return { ok: false, error: 'unknown_tool', message: `Unknown tool ${name}` };
    }
  } catch (err) {
    return { ok: false, error: 'bridge_error', message: (err as Error).message ?? String(err) };
  }
}

function automationJson(a: MotionAutomationView) {
  const act = (x: { kind: string; sceneName?: string }) => (x.kind === 'scene' ? `scene "${x.sceneName}"` : x.kind);
  return {
    id: a.id,
    name: a.name,
    sensor: a.sourceName,
    kind: a.sourceKind,
    enabled: a.enabled,
    status: a.status,
    rooms: a.where.map((w) => w.name),
    only_when_dark: a.onlyWhenDark,
    darkness: a.darkness.mode,
    darkness_details: describeDarkness(a.darkness),
    ...(a.darkness.mode === 'sunset_to_sunrise' ? { sunset_offset_minutes: a.darkness.sunsetOffsetMinutes, sunrise_offset_minutes: a.darkness.sunriseOffsetMinutes } : {}),
    ...(a.darkness.mode === 'sensor' ? { dark_threshold_lux: Math.round(Math.pow(10, (a.darkness.darkThreshold - 1) / 10000) * 10) / 10 } : {}),
    slots: a.slots.map((s) => ({ from: s.start, on_motion: act(s.onMotion), off_after_minutes: s.noMotionAfterMinutes, on_no_motion: act(s.onNoMotion), do_not_disturb: s.doNotDisturb })),
    summary: a.summary,
  };
}

/** The darkness condition from tool arguments, keeping what is not mentioned. */
function darknessFromArgs(args: Record<string, unknown>, current: Darkness, source: MotionSource, home: HomeModel): { darkness?: Darkness; result?: ToolResult } {
  const mode = str(args.darkness).trim().toLowerCase().replace(/[\s-]+/g, '_');
  const sunset = num(args.sunset_offset_minutes);
  const sunrise = num(args.sunrise_offset_minutes);
  const lux = num(args.dark_threshold_lux);
  const only = bool(args.only_when_dark);
  let wanted: Darkness['mode'] | undefined;
  if (mode) {
    if (['any', 'always', 'none', 'off', 'never'].includes(mode)) wanted = 'any';
    else if (/sun/.test(mode) || mode === 'night' || mode === 'dark') wanted = 'sunset_to_sunrise';
    else if (/sensor|daylight|light_level|lux/.test(mode)) wanted = 'sensor';
    else return { result: { ok: false, error: 'invalid_argument', message: 'darkness must be any, sunset_to_sunrise or sensor.' } };
  } else if (lux !== undefined) wanted = 'sensor';
  else if (sunset !== undefined || sunrise !== undefined) wanted = 'sunset_to_sunrise';
  else if (only === false) wanted = 'any';
  else if (only === true) wanted = current.mode === 'any' ? 'sunset_to_sunrise' : current.mode;
  else wanted = current.mode;

  if (wanted === 'any') return { darkness: { mode: 'any' } };
  if (wanted === 'sunset_to_sunrise') {
    const cur = current.mode === 'sunset_to_sunrise' ? current : null;
    return { darkness: { mode: 'sunset_to_sunrise', sunsetOffsetMinutes: Math.round(sunset ?? cur?.sunsetOffsetMinutes ?? -30), sunriseOffsetMinutes: Math.round(sunrise ?? cur?.sunriseOffsetMinutes ?? 30) } };
  }
  const cur = current.mode === 'sensor' ? current : null;
  const acc = home.accessories.find((a) => a.deviceId === source.deviceId);
  const cam = (home.cameras ?? []).find((c) => c.id === source.deviceId);
  const serviceId = cur?.lightLevelServiceId ?? acc?.lightLevel?.sensorId ?? cam?.lightLevelId ?? null;
  if (!serviceId) return { result: { ok: false, error: 'unsupported', message: `${source.name} has no light-level sensor, so it cannot decide darkness itself. Use darkness "sunset_to_sunrise".` } };
  return {
    darkness: {
      mode: 'sensor',
      lightLevelServiceId: serviceId,
      lightLevelType: cur?.lightLevelType ?? 'light_level',
      darkThreshold: lux !== undefined ? luxToLightLevel(lux) : cur?.darkThreshold ?? DEFAULT_DARK_THRESHOLD,
      offset: cur?.offset ?? DEFAULT_DARK_OFFSET,
    },
  };
}

function routineJson(r: RoutineView) {
  return {
    id: r.id,
    name: r.name,
    kind: r.kind,
    enabled: r.enabled,
    status: r.status,
    rooms: r.where.map((w) => w.name),
    time: r.time,
    days: r.days ? describeDays(r.days) : undefined,
    fade_minutes: r.fadeMinutes,
    end_brightness: r.endBrightness,
    turn_off_after_minutes: r.turnOffAfterMinutes ?? undefined,
    end: r.endState === 'turn_off' ? 'off' : r.endState,
    summary: r.summary,
  };
}

function resolveRoutine(query: string, home: HomeModel): { routine?: RoutineView; result?: ToolResult } {
  const byId = home.routines.find((r) => r.id === query.trim());
  if (byId) return { routine: byId };
  const r = resolveByName(query, home.routines);
  if (r.match && r.score >= 62) return { routine: r.match };
  if (!r.match && r.candidates.length > 1 && r.score >= 62) return { result: ambiguous('routines', r.candidates, (x) => `${x.name} (${x.kind})`) };
  return { result: notFound('routine', query, home.routines.map((x) => `${x.name} (${x.kind})`)) };
}

function resolveRooms(args: Record<string, unknown>, home: HomeModel, key = 'rooms'): { where?: { id: string; kind: 'room' | 'zone' }[]; result?: ToolResult } {
  const list = Array.isArray(args[key]) ? (args[key] as unknown[]).map(str) : str(args[key]) ? [str(args[key])] : str(args.room) ? [str(args.room)] : [];
  const where: { id: string; kind: 'room' | 'zone' }[] = [];
  for (const q of list) {
    const g = resolveGroup(q, home);
    if (!g.group) return { result: g.result };
    if (g.group.kind === 'home') return { result: { ok: false, error: 'invalid_argument', message: 'Pick rooms or zones, not the whole home.' } };
    if (!where.some((w) => w.id === g.group!.id)) where.push({ id: g.group.id, kind: g.group.kind === 'zone' ? 'zone' : 'room' });
  }
  return { where };
}

async function setRoutine(kind: 'wake_up' | 'go_to_sleep', args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const home = await ctx.getHome();
  const rooms = resolveRooms(args, home);
  if (rooms.result) return rooms.result;
  // Which existing routine does this replace? Same name, else the only one of this kind for exactly these rooms.
  const sameKind = home.routines.filter((r) => r.kind === kind);
  let existing = str(args.name) ? sameKind.find((r) => r.name.toLowerCase() === str(args.name).trim().toLowerCase()) : undefined;
  if (!existing && rooms.where?.length) {
    const key = rooms.where.map((w) => w.id).sort().join(',');
    const hits = sameKind.filter((r) => r.where.map((w) => w.id).sort().join(',') === key);
    if (hits.length === 1) existing = hits[0];
  }
  const enabledArg = bool(args.enabled);
  if (!rooms.where?.length && !existing) return { ok: false, error: 'invalid_argument', message: 'rooms is required.' };
  let time;
  try {
    time = str(args.time) ? parseMotionTime(str(args.time)) : existing?.time ? parseMotionTime(existing.time) : null;
  } catch (err) {
    return { ok: false, error: 'invalid_argument', message: (err as Error).message };
  }
  if (!time) return { ok: false, error: 'invalid_argument', message: 'time is required (HH:MM).' };
  let days;
  try {
    days = args.days !== undefined && args.days !== null && str(args.days) !== '' ? parseDays(args.days) : existing?.days?.length ? parseDays(existing.days) : parseDays([]);
  } catch (err) {
    return { ok: false, error: 'invalid_argument', message: (err as Error).message };
  }
  const endRaw = str(args.end).toLowerCase();
  const spec: RoutineSpec = {
    kind,
    where: rooms.where?.length ? rooms.where : existing!.where.map((w) => ({ id: w.id, kind: w.kind })),
    time,
    days,
    fadeMinutes: num(args.fade_minutes) ?? existing?.fadeMinutes ?? 30,
    endBrightness: kind === 'wake_up' ? pct(num(args.end_brightness)) ?? existing?.endBrightness ?? 100 : undefined,
    turnOffAfterMinutes: kind === 'wake_up' ? (num(args.turn_off_after_minutes) !== undefined ? num(args.turn_off_after_minutes) || null : existing?.turnOffAfterMinutes ?? null) : undefined,
    endState: kind === 'go_to_sleep' ? (endRaw ? (/off/.test(endRaw) ? 'turn_off' : 'nightlight') : existing?.endState ?? 'nightlight') : undefined,
  };
  const roomNames = spec.where.map((w) => home.groupById[w.id]?.name ?? 'room');
  const name = str(args.name) || existing?.name || (kind === 'wake_up' ? `Wake up ${roomNames[0]}` : `Go to sleep ${roomNames[0]}`);
  const enabled = enabledArg ?? existing?.enabled ?? true;
  let id: string;
  if (existing) {
    await ctx.client.updateBehaviorInstance(existing.id, buildRoutineBody(spec, { name, enabled, forUpdate: true }));
    id = existing.id;
  } else {
    const refs = await ctx.client.createBehaviorInstance(buildRoutineBody(spec, { name, enabled }));
    id = refs[0]?.rid ?? '';
  }
  return { ok: true, message: `${name} → ${roomNames.join(', ')}: ${describeRoutine(spec)}${enabled ? '' : ' (paused)'}`, id, routine: { name, rooms: roomNames, summary: describeRoutine(spec), enabled } };
}

function sensitivityFromArgs(raw: unknown, max: number): number | undefined {
  const s = str(raw).trim().toLowerCase();
  if (!s) return undefined;
  const n = Number(s);
  if (Number.isFinite(n)) return Math.max(0, Math.min(max, Math.round(n)));
  if (/^(very )?low|min/.test(s)) return 0;
  if (/^med|mid|normal/.test(s)) return Math.round(max / 2);
  if (/^(very )?high|max/.test(s)) return max;
  return undefined;
}

async function setSensorSettings(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const home = await ctx.getHome();
  const { source, result } = resolveMotionSource(str(args.sensor), home);
  if (!source) return result!;
  const done: string[] = [];
  const enabled = bool(args.enabled);
  if (enabled !== undefined) {
    await ctx.client.setSensorEnabled(source.motionType, source.motionServiceId, enabled);
    done.push(`motion sensing ${enabled ? 'on' : 'off'}`);
  }
  if (str(args.sensitivity)) {
    const acc = home.accessories.find((a) => a.deviceId === source.deviceId);
    if (source.kind !== 'sensor' || !acc?.motion) return { ok: false, error: 'unsupported', message: `${source.name} has no sensitivity setting (cameras do not).` };
    const max = acc.motion.sensitivityMax ?? 2;
    const value = sensitivityFromArgs(args.sensitivity, max);
    if (value === undefined) return { ok: false, error: 'invalid_argument', message: `sensitivity must be low, medium, high or 0-${max}.` };
    await ctx.client.updateResource('motion', source.motionServiceId, { sensitivity: { sensitivity: value } });
    done.push(`sensitivity ${value}/${max}`);
  }
  if (str(args.name)) {
    await ctx.client.rename('device', source.deviceId, str(args.name).trim().slice(0, 32));
    done.push(`renamed to "${str(args.name).trim().slice(0, 32)}"`);
  }
  if (str(args.room)) {
    const g = resolveGroup(str(args.room), home);
    if (!g.group) return g.result!;
    if (g.group.kind !== 'room') return { ok: false, error: 'invalid_argument', message: 'Devices live in rooms, not zones.' };
    const current = home.rooms.find((r) => r.deviceIds.includes(source.deviceId));
    if (current && current.id !== g.group.id) await ctx.client.updateResource('room', current.id, { children: current.deviceIds.filter((d) => d !== source.deviceId).map((rid) => ({ rid, rtype: 'device' })) });
    if (!current || current.id !== g.group.id) await ctx.client.updateResource('room', g.group.id, { children: [...g.group.deviceIds, source.deviceId].map((rid) => ({ rid, rtype: 'device' })) });
    done.push(`moved to ${g.group.name}`);
  }
  if (!done.length) return { ok: false, error: 'invalid_argument', message: 'Give enabled, sensitivity, name or room.' };
  return { ok: true, message: `${source.name}: ${done.join(', ')}` };
}

async function renameThing(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const home = await ctx.getHome();
  const what = str(args.what).toLowerCase();
  const newName = str(args.new_name).trim().slice(0, 32);
  if (!newName) return { ok: false, error: 'invalid_argument', message: 'new_name is required.' };
  const name = str(args.name);
  if (what === 'light') {
    const l = resolveLight(name, home, str(args.room) || undefined);
    if (!l.light) return l.result!;
    await ctx.client.rename('light', l.light.id, newName);
    return { ok: true, message: `Light "${l.light.name}" renamed to "${newName}".` };
  }
  if (what === 'room' || what === 'zone') {
    const g = resolveGroup(name, home);
    if (!g.group) return g.result!;
    if (g.group.kind === 'home') return { ok: false, error: 'invalid_argument', message: 'The whole home cannot be renamed here.' };
    await ctx.client.rename(g.group.kind, g.group.id, newName);
    return { ok: true, message: `${fmtGroup(g.group)} renamed to "${newName}".` };
  }
  if (what === 'scene') {
    const sc = resolveScene(name, home, str(args.room) || undefined);
    if (!sc.scene) return sc.result!;
    await ctx.client.updateScene(sc.scene.id, { metadata: { name: newName } });
    return { ok: true, message: `Scene "${sc.scene.name}" renamed to "${newName}".` };
  }
  if (what === 'sensor' || what === 'camera' || what === 'device') {
    const { source, result } = resolveMotionSource(name, home);
    if (!source) return result!;
    await ctx.client.rename('device', source.deviceId, newName);
    return { ok: true, message: `${source.name} renamed to "${newName}".` };
  }
  return { ok: false, error: 'invalid_argument', message: 'what must be light, room, zone, scene, sensor or camera.' };
}

async function setPowerOn(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const home = await ctx.getHome();
  const target = str(args.target);
  let lights: LightView[] = [];
  const g = resolveGroup(target, home);
  if (g.group) lights = g.group.lightIds.map((id) => home.lightById[id]).filter(Boolean);
  else {
    const l = resolveLight(target, home);
    if (!l.light) return g.result && g.result.error === 'ambiguous' ? g.result : l.result!;
    lights = [l.light];
  }
  if (!lights.length) return { ok: false, error: 'not_found', message: `No lights in ${target}.` };
  const mode = str(args.mode).toLowerCase().replace(/[\s-]+/g, '_');
  const preset = mode === 'default' || mode === 'safety' ? 'safety' : /power/.test(mode) ? 'powerfail' : /last/.test(mode) ? 'last_on_state' : mode === 'custom' ? 'custom' : null;
  if (!preset) return { ok: false, error: 'invalid_argument', message: 'mode must be default, power_loss, last_state or custom.' };
  let describe = { default: 'warm white, full brightness', power_loss: 'last state after a power cut, off after the switch', last_state: 'last state' }[mode as 'default'] ?? preset;
  const bodies: Record<string, unknown>[] = [];
  for (const l of lights) {
    if (preset !== 'custom') {
      bodies.push({ powerup: { preset } });
      continue;
    }
    const st = buildState({ brightness: num(args.brightness), color: str(args.color) || undefined, color_temperature: str(args.color_temperature) || undefined }, ctx, l);
    if (st.error) return { ok: false, error: 'invalid_argument', message: st.error };
    const powerup: Record<string, unknown> = { preset: 'custom', on: { mode: 'on', on: { on: true } } };
    powerup.dimming = st.state.brightness !== undefined ? { mode: 'dimming', dimming: { brightness: st.state.brightness } } : { mode: 'previous' };
    powerup.color = st.state.mirek !== undefined ? { mode: 'color_temperature', color_temperature: { mirek: st.state.mirek } } : st.state.xy ? { mode: 'color', color: { xy: st.state.xy } } : { mode: 'previous' };
    bodies.push({ powerup });
    describe = `custom (${st.describe.join(', ') || 'previous state'})`;
  }
  for (let i = 0; i < lights.length; i++) await ctx.client.updateResource('light', lights[i].id, bodies[i]);
  return { ok: true, message: `Power-on behaviour of ${lights.length === 1 ? lights[0].name : `${lights.length} lights in ${target}`}: ${describe}.` };
}

function resolveLightList(list: unknown, home: HomeModel, roomHint?: string): { lights?: LightView[]; result?: ToolResult } {
  const names = Array.isArray(list) ? (list as unknown[]).map(str).filter(Boolean) : [];
  const lights: LightView[] = [];
  for (const n of names) {
    const l = resolveLight(n, home, roomHint);
    if (!l.light) return { result: l.result };
    if (!lights.some((x) => x.id === l.light!.id)) lights.push(l.light);
  }
  return { lights };
}

async function createGroup(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const home = await ctx.getHome();
  const kind = str(args.kind).toLowerCase() === 'zone' ? 'zone' : 'room';
  const name = str(args.name).trim().slice(0, 32);
  if (!name) return { ok: false, error: 'invalid_argument', message: 'name is required.' };
  const ls = resolveLightList(args.lights, home);
  if (ls.result) return ls.result;
  const lights = ls.lights ?? [];
  if (kind === 'room') {
    const taken = lights.filter((l) => l.roomName);
    if (taken.length) return { ok: false, error: 'invalid_argument', message: `A light belongs to one room. Already placed: ${taken.map((l) => `${l.name} (${l.roomName})`).join(', ')}. Remove them from their room first, or make a zone.` };
  }
  const children = kind === 'room' ? lights.map((l) => ({ rid: l.deviceId ?? l.id, rtype: 'device' })) : lights.map((l) => ({ rid: l.id, rtype: 'light' }));
  const archetype = str(args.icon).trim().toLowerCase().replace(/[\s-]+/g, '_') || 'other';
  const refs = await ctx.client.createResource(kind, { type: kind, metadata: { name, archetype }, children });
  return { ok: true, message: `${kind === 'zone' ? 'Zone' : 'Room'} "${name}" created with ${lights.length} light${lights.length === 1 ? '' : 's'}.`, id: refs[0]?.rid };
}

async function updateGroup(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const home = await ctx.getHome();
  const g = resolveGroup(str(args.group), home);
  if (!g.group) return g.result!;
  const group = g.group;
  if (group.kind === 'home') return { ok: false, error: 'invalid_argument', message: 'Pick a room or zone.' };
  const body: Record<string, unknown> = {};
  const done: string[] = [];
  const newName = str(args.new_name).trim().slice(0, 32);
  const icon = str(args.icon).trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (newName || icon) {
    body.metadata = { ...(newName ? { name: newName } : {}), ...(icon ? { archetype: icon } : {}) };
    if (newName) done.push(`renamed to "${newName}"`);
    if (icon) done.push(`icon ${icon}`);
  }
  const replace = resolveLightList(args.lights, home);
  const add = resolveLightList(args.add_lights, home);
  const remove = resolveLightList(args.remove_lights, home, group.name);
  for (const r of [replace, add, remove]) if (r.result) return r.result;
  if ((replace.lights?.length ?? 0) + (add.lights?.length ?? 0) + (remove.lights?.length ?? 0) > 0 || (Array.isArray(args.lights) && !(args.lights as unknown[]).length)) {
    let lightIds = Array.isArray(args.lights) ? (replace.lights ?? []).map((l) => l.id) : [...group.lightIds];
    for (const l of add.lights ?? []) if (!lightIds.includes(l.id)) lightIds.push(l.id);
    const removeIds = new Set((remove.lights ?? []).map((l) => l.id));
    lightIds = lightIds.filter((id) => !removeIds.has(id));
    if (group.kind === 'room') {
      const conflict = lightIds.map((id) => home.lightById[id]).filter((l) => l && l.roomName && !group.lightIds.includes(l.id));
      if (conflict.length) return { ok: false, error: 'invalid_argument', message: `A light belongs to one room. Already placed: ${conflict.map((l) => `${l.name} (${l.roomName})`).join(', ')}.` };
      const lightDevices = new Set(home.lights.map((l) => l.deviceId ?? l.id));
      const keepOthers = group.deviceIds.filter((d) => !lightDevices.has(d)); // sensors and the like stay
      body.children = [...keepOthers, ...lightIds.map((id) => home.lightById[id]?.deviceId ?? id)].map((rid) => ({ rid, rtype: 'device' }));
    } else {
      body.children = lightIds.map((rid) => ({ rid, rtype: 'light' }));
    }
    done.push(`lights: ${lightIds.map((id) => home.lightById[id]?.name ?? id).join(', ') || 'none'}`);
  }
  if (!Object.keys(body).length) return { ok: false, error: 'invalid_argument', message: 'Give new_name, icon, add_lights, remove_lights or lights.' };
  await ctx.client.updateResource(group.kind, group.id, body);
  return { ok: true, message: `${fmtGroup(group)}: ${done.join('; ')}` };
}

function sceneActionsFromArgs(list: unknown, home: HomeModel, group: GroupView, ctx: ToolContext): { actions?: Map<string, SceneAction>; result?: ToolResult } {
  const out = new Map<string, SceneAction>();
  for (const raw of Array.isArray(list) ? (list as Record<string, unknown>[]) : []) {
    const l = resolveLight(str(raw.light), home, group.name);
    if (!l.light) return { result: l.result };
    if (!group.lightIds.includes(l.light.id)) return { result: { ok: false, error: 'invalid_argument', message: `${l.light.name} is not in ${group.name}.` } };
    const st = buildState({ on: bool(raw.on), brightness: num(raw.brightness), color: str(raw.color) || undefined, color_temperature: str(raw.color_temperature) || undefined }, ctx, l.light);
    if (st.error) return { result: { ok: false, error: 'invalid_argument', message: st.error } };
    const cur = sceneActionFromLight(l.light);
    const on = st.state.on ?? (cur.action.on?.on ?? true);
    out.set(l.light.id, sceneActionFor(l.light.id, { on, brightness: st.state.brightness ?? cur.action.dimming?.brightness, xy: st.state.xy ?? (st.state.mirek === undefined ? cur.action.color?.xy : undefined), mirek: st.state.mirek ?? (st.state.xy ? undefined : cur.action.color_temperature?.mirek) }));
  }
  return { actions: out };
}

async function createScene(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const home = await ctx.getHome();
  const name = str(args.name).trim().slice(0, 32);
  if (!name) return { ok: false, error: 'invalid_argument', message: 'name is required.' };
  const g = resolveGroup(str(args.room), home);
  if (!g.group) return g.result!;
  if (g.group.kind === 'home') return { ok: false, error: 'invalid_argument', message: 'Scenes belong to a room or zone.' };
  const overrides = sceneActionsFromArgs(args.lights, home, g.group, ctx);
  if (overrides.result) return overrides.result;
  const actions = g.group.lightIds.map((id) => overrides.actions!.get(id) ?? sceneActionFromLight(home.lightById[id])).filter(Boolean);
  const refs = await ctx.client.createScene({
    name,
    group: { rid: g.group.id, rtype: g.group.kind },
    actions,
    palette: paletteFromActions(actions),
    ...(num(args.speed) !== undefined ? { speed: Math.max(0, Math.min(1, num(args.speed)!)) } : {}),
    ...(bool(args.auto_dynamic) !== undefined ? { autoDynamic: bool(args.auto_dynamic) } : {}),
  });
  return { ok: true, message: `Scene "${name}" saved for ${fmtGroup(g.group)} (${actions.length} lights${overrides.actions!.size ? `, ${overrides.actions!.size} set explicitly` : ', current look'}).`, id: refs[0]?.rid };
}

async function updateScene(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const home = await ctx.getHome();
  const sc = resolveScene(str(args.scene), home, str(args.room) || undefined);
  if (!sc.scene) return sc.result!;
  const group = home.groupById[sc.scene.groupId];
  const patch: Record<string, unknown> = {};
  const done: string[] = [];
  const newName = str(args.new_name).trim().slice(0, 32);
  if (newName) {
    patch.metadata = { name: newName };
    done.push(`renamed to "${newName}"`);
  }
  if (num(args.speed) !== undefined) {
    patch.speed = Math.max(0, Math.min(1, num(args.speed)!));
    done.push(`speed ${patch.speed}`);
  }
  if (bool(args.auto_dynamic) !== undefined) {
    patch.auto_dynamic = bool(args.auto_dynamic);
    done.push(`auto-dynamic ${patch.auto_dynamic ? 'on' : 'off'}`);
  }
  if (group && (bool(args.from_current_state) || (Array.isArray(args.lights) && (args.lights as unknown[]).length))) {
    const overrides = sceneActionsFromArgs(args.lights, home, group, ctx);
    if (overrides.result) return overrides.result;
    const existing = new Map(sc.scene.actions.map((a) => [a.target.rid, a]));
    const actions = group.lightIds.map((id) => overrides.actions!.get(id) ?? (bool(args.from_current_state) ? sceneActionFromLight(home.lightById[id]) : existing.get(id) ?? sceneActionFromLight(home.lightById[id]))).filter(Boolean);
    patch.actions = actions;
    patch.palette = paletteFromActions(actions);
    done.push(bool(args.from_current_state) ? 'captured the current look' : `${overrides.actions!.size} light${overrides.actions!.size === 1 ? '' : 's'} changed`);
  }
  if (!Object.keys(patch).length) return { ok: false, error: 'invalid_argument', message: 'Give new_name, speed, auto_dynamic, lights or from_current_state.' };
  await ctx.client.updateScene(sc.scene.id, patch);
  return { ok: true, message: `Scene "${sc.scene.name}" (${sc.scene.groupName}): ${done.join('; ')}` };
}

function parseAction(raw: unknown, home: HomeModel, group: GroupView, fallback: MotionAction, allowOff: boolean): { action?: MotionAction; result?: ToolResult } {
  const q = str(raw).trim();
  if (!q) return { action: fallback };
  const lc = q.toLowerCase();
  if (['nothing', 'none', 'no', 'do nothing', 'keep', 'leave', 'nada'].includes(lc)) return { action: { kind: 'nothing' } };
  if (allowOff && ['off', 'all off', 'turn off', 'lights off', 'desligar', 'apagar'].includes(lc)) return { action: { kind: 'off' } };
  const roomScenes = home.scenes.filter((s) => s.groupId === group.id);
  if (['on', 'true', 'turn on', 'lights on', 'bright', 'ligar', 'acender'].includes(lc)) {
    const preferred = ['bright', 'concentrate', 'energize', 'read', 'normal', 'relax'];
    const pick = preferred.map((p) => roomScenes.find((s) => s.name.toLowerCase() === p)).find(Boolean) ?? roomScenes[0];
    if (!pick) return { result: { ok: false, error: 'not_found', message: `${group.name} has no scenes; the bridge turns lights on by recalling a scene. Create one first (e.g. save the current state as "Bright").` } };
    return { action: { kind: 'scene', sceneId: pick.id } };
  }
  const s = resolveScene(q, home, group.kind === 'home' ? undefined : group.name);
  if (!s.scene) return { result: s.result };
  if (s.scene.groupId !== group.id) return { result: { ok: false, error: 'invalid_argument', message: `Scene "${s.scene.name}" belongs to ${s.scene.groupName}, not ${group.name}. Pick a scene of ${group.name}: ${roomScenes.map((x) => x.name).join(', ') || 'none'}.` } };
  return { action: { kind: 'scene', sceneId: s.scene.id } };
}

async function setMotionAutomation(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const home = await ctx.getHome();
  const { source, result } = resolveMotionSource(str(args.sensor), home);
  if (!source) return result!;
  const existing = home.motionAutomations.find((a) => a.sourceDeviceId === source.deviceId);
  const enabledArg = bool(args.enabled);
  const onlyEnable = enabledArg !== undefined && ['room', 'rooms', 'on_motion', 'off_after_minutes', 'on_no_motion', 'from', 'until', 'only_when_dark', 'darkness', 'sunset_offset_minutes', 'sunrise_offset_minutes', 'dark_threshold_lux', 'do_not_disturb', 'slots', 'name'].every((k) => args[k] === undefined || args[k] === null || args[k] === '' || (Array.isArray(args[k]) && !(args[k] as unknown[]).length));
  if (onlyEnable && existing) {
    // The bridge answers "The instance doesn't support triggers" to an enabled-only PUT; send the rule back with it.
    await ctx.client.updateBehaviorInstance(existing.id, { enabled: enabledArg, metadata: { name: existing.name }, configuration: existing.configuration });
    return { ok: true, message: `${existing.sourceName}: motion automation ${enabledArg ? 'resumed' : 'paused'} (${existing.summary})`, id: existing.id };
  }

  // Where
  let where = existing?.where.map((w) => ({ id: w.id, kind: w.kind })) ?? [];
  const roomQueries = Array.isArray(args.rooms) && args.rooms.length ? (args.rooms as unknown[]).map(str) : str(args.room) ? [str(args.room)] : [];
  if (roomQueries.length) {
    where = [];
    for (const q of roomQueries) {
      const g = resolveGroup(q, home);
      if (!g.group) return g.result!;
      if (g.group.kind === 'home') return { ok: false, error: 'invalid_argument', message: 'Pick a room or zone, not the whole home.' };
      if (!where.some((w) => w.id === g.group!.id)) where.push({ id: g.group.id, kind: g.group.kind === 'zone' ? 'zone' : 'room' });
    }
  }
  if (!where.length) return { ok: false, error: 'invalid_argument', message: `Which room or zone should ${source.name} control? Pass room.` };
  const group = home.groupById[where[0].id];
  if (!group) return { ok: false, error: 'not_found', message: 'The room of this automation no longer exists; pass room.' };

  // Slots
  const defaultAfter = num(args.off_after_minutes) ?? existing?.slots[0]?.noMotionAfterMinutes ?? 5;
  const slots: MotionSlot[] = [];
  const dnd = bool(args.do_not_disturb) ?? existing?.slots.some((s) => s.doNotDisturb) ?? false;
  const rawSlots = Array.isArray(args.slots) ? (args.slots as Record<string, unknown>[]) : null;
  try {
    if (rawSlots && rawSlots.length) {
      for (const r of rawSlots) {
        const onM = parseAction(r.on_motion, home, group, { kind: 'nothing' }, false);
        if (!onM.action) return onM.result!;
        const onN = parseAction(r.on_no_motion, home, group, { kind: 'off' }, true);
        if (!onN.action) return onN.result!;
        slots.push({ start: parseMotionTime(str(r.from)), onMotion: onM.action, noMotionAfterMinutes: num(r.off_after_minutes) ?? defaultAfter, onNoMotion: onN.action, doNotDisturb: dnd });
      }
    } else if (existing && !str(args.from) && !str(args.until)) {
      // Keep the existing time slots; apply what was mentioned. A scene for on_motion goes to the
      // slots that already recall a scene (the "do nothing by day" slots are left alone).
      const onM = str(args.on_motion) ? parseAction(args.on_motion, home, group, { kind: 'nothing' }, false) : null;
      if (onM && !onM.action) return onM.result!;
      const onN = str(args.on_no_motion) ? parseAction(args.on_no_motion, home, group, { kind: 'off' }, true) : null;
      if (onN && !onN.action) return onN.result!;
      const after = num(args.off_after_minutes);
      const sceneSlots = existing.slots.filter((sl) => sl.onMotion.kind === 'scene');
      const targets = new Set((sceneSlots.length ? sceneSlots : [existing.slots[existing.slots.length - 1]]).filter(Boolean));
      for (const sl of existing.slots) {
        slots.push({
          start: parseMotionTime(sl.start),
          onMotion: onM?.action && (targets.has(sl) || existing.slots.length === 1) ? onM.action : fromView(sl.onMotion),
          noMotionAfterMinutes: after ?? sl.noMotionAfterMinutes,
          onNoMotion: onN?.action ?? fromView(sl.onNoMotion),
          doNotDisturb: bool(args.do_not_disturb) ?? sl.doNotDisturb,
        });
      }
      if (!slots.length) return { ok: false, error: 'invalid_argument', message: 'Say what motion should do: a scene for on_motion and/or "off" for on_no_motion.' };
    } else {
      const onM = parseAction(args.on_motion, home, group, existing?.slots[0] ? fromView(existing.slots[0].onMotion) : { kind: 'nothing' }, false);
      if (!onM.action) return onM.result!;
      const onN = parseAction(args.on_no_motion, home, group, existing?.slots[0] ? fromView(existing.slots[0].onNoMotion) : { kind: 'off' }, true);
      if (!onN.action) return onN.result!;
      if (onM.action.kind === 'nothing' && onN.action.kind === 'nothing') return { ok: false, error: 'invalid_argument', message: 'Say what motion should do: a scene for on_motion and/or "off" for on_no_motion.' };
      const from = str(args.from) ? parseMotionTime(str(args.from)) : { hour: 0, minute: 0 };
      slots.push({ start: from, onMotion: onM.action, noMotionAfterMinutes: defaultAfter, onNoMotion: onN.action, doNotDisturb: dnd });
      if (str(args.until)) slots.push({ start: parseMotionTime(str(args.until)), onMotion: { kind: 'nothing' }, noMotionAfterMinutes: defaultAfter, onNoMotion: { kind: 'nothing' }, doNotDisturb: dnd });
    }
  } catch (err) {
    return { ok: false, error: 'invalid_argument', message: (err as Error).message };
  }
  const starts = new Set(slots.map((s) => `${s.start.hour}:${s.start.minute}`));
  if (starts.size !== slots.length) return { ok: false, error: 'invalid_argument', message: 'from and until must be different times.' };

  const dk = darknessFromArgs(args, existing?.darkness ?? { mode: 'any' }, source, home);
  if (dk.result) return dk.result;
  const darkness = dk.darkness!;
  const spec: MotionAutomationSpec = { sourceDeviceId: source.deviceId, motionServiceId: source.motionServiceId, motionType: source.motionType, where, darkness, slots };
  const name = str(args.name) || existing?.name || source.name;
  const enabled = enabledArg ?? existing?.enabled ?? true;
  let id: string;
  if (existing) {
    await ctx.client.updateBehaviorInstance(existing.id, buildBehaviorInstanceBody(spec, { name, enabled, forUpdate: true }));
    id = existing.id;
  } else {
    const refs = await ctx.client.createBehaviorInstance(buildBehaviorInstanceBody(spec, { name, enabled }));
    id = refs[0]?.rid ?? '';
  }
  const onlyWhenDark = darkness.mode !== 'any';
  const sceneName = (sid: string) => home.sceneById[sid]?.name ?? 'scene';
  const summary = describeMotionSlots(slots, sceneName, darkness);
  const rooms = where.map((w) => home.groupById[w.id]?.name ?? 'room').join(', ');
  return {
    ok: true,
    message: `${source.name} → ${rooms}: ${summary}${enabled ? '' : ' (paused)'}`,
    id,
    automation: { sensor: source.name, rooms: where.map((w) => home.groupById[w.id]?.name), enabled, only_when_dark: onlyWhenDark, darkness: describeDarkness(darkness), slots: slots.map((s) => ({ from: formatMotionTime(s.start), on_motion: s.onMotion.kind === 'scene' ? `scene "${sceneName(s.onMotion.sceneId)}"` : s.onMotion.kind, off_after_minutes: s.noMotionAfterMinutes, on_no_motion: s.onNoMotion.kind === 'scene' ? `scene "${sceneName(s.onNoMotion.sceneId)}"` : s.onNoMotion.kind })) },
  };
}

function fromView(v: { kind: 'nothing' | 'off' | 'scene'; sceneId?: string }): MotionAction {
  return v.kind === 'scene' && v.sceneId ? { kind: 'scene', sceneId: v.sceneId } : v.kind === 'off' ? { kind: 'off' } : { kind: 'nothing' };
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
  const automations = (home.motionAutomations ?? []).map((a) => `- ${a.sourceName} → ${a.where.map((w) => w.name).join(', ')}: ${a.summary}${a.enabled ? '' : ' (paused)'}`).join('\n');
  const routines = (home.routines ?? []).map((r) => `- ${r.name} [${r.kind}] → ${r.where.map((w) => w.name).join(', ')}: ${r.summary}${r.enabled ? '' : ' (paused)'}`).join('\n');
  return [
    'You are Hue Pilot, a friendly assistant that controls the Philips Hue lights in the user\'s home through tools.',
    'Always act with tools rather than describing what you would do. Prefer set_room for whole rooms and set_light for a single lamp.',
    'If a name is ambiguous or not found, ask a short clarifying question. Keep answers to one or two short sentences, confirm what you changed.',
    'Reply in the language the user writes in. Brightness is 1-100%. "Dim" means around 30%, "bright" means 100%.',
    'Never invent rooms, lights or scenes; use get_home_overview when unsure.',
    'Motion sensors and cameras can drive the lights: set_motion_automation writes the rule to the bridge (rooms, scene on motion, off after N minutes, time slots, darkness: any / sunset_to_sunrise with offsets / the sensor\'s own daylight threshold in lux); list_motion_automations shows the rules; set_sensor_settings changes sensing on/off, sensitivity, name and room.',
    'Also on the bridge: wake-up and go-to-sleep routines (set_wake_up, set_go_to_sleep, list_routines, delete_routine), rooms and zones (create_group, update_group, delete_group), scenes (create_scene, update_scene, delete_scene), rename, and each light\'s power-on behaviour (set_light_power_on_behavior). Everything the Philips Hue app can set up here, you can too — never tell the user to use the Hue app for these.',
    cameras
      ? 'Hue Secure cameras: use get_sensor_readings for motion/battery/light level and set_camera_motion_detection to switch motion detection. The bridge exposes no video; live view is only in the Philips Hue app, or on a Nest Hub / Echo Show / Fire TV after linking Hue to Google Home or Alexa.'
      : '',
    '',
    'Home layout:',
    rooms || '- (no rooms configured)',
    cameras ? `Cameras: ${cameras}` : '',
    automations ? `Motion automations:\n${automations}` : '',
    routines ? `Routines:\n${routines}` : '',
    extra ?? '',
  ]
    .filter((l) => l !== undefined)
    .join('\n');
}
