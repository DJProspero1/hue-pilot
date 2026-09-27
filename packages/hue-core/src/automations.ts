/**
 * Motion automations: what a Hue motion sensor or a Hue Secure camera makes the lights do when it
 * sees movement (and when it stops seeing it). On the bridge these are `behavior_instance`
 * resources of the "Hue Accessories" script — the very same ones the Philips Hue app creates — so
 * they run on the bridge with every app closed.
 *
 * Facts about the bridge (verified on a Bridge Pro, 2026-09-27):
 * - one instance per source device; a POST for a device that already has one updates it (same id);
 * - PUT must not carry `script_id`, and a PUT with only `enabled` is refused: send the rule back;
 * - `light_level` is optional: absent = any time of day; `sunrise_sunset` = only when dark by the
 *   sun (offsets in hours or minutes); `daylight_sensitivity` = only when the sensor's own light
 *   level is below `dark_threshold` (both `dark_threshold` and `offset` are required; the service
 *   may be a `light_level` or a room's `grouped_light_level`);
 * - each timeslot starts at a clock time and lasts until the next one (wrapping past midnight).
 */
import type { BehaviorInstanceResource } from './types.ts';

/** The "Hue Accessories" behavior script (motion sensors and cameras). */
export const ACCESSORY_SCRIPT_ID = '67d9395b-4403-42cc-b5f0-740b699d67c6';

/** What the Hue app stores when "daylight sensitivity" is set to its default (about 5 lux). */
export const DEFAULT_DARK_THRESHOLD = 7267;
export const DEFAULT_DARK_OFFSET = 7000;

export interface MotionTime {
  hour: number;
  minute: number;
}

export type MotionAction = { kind: 'nothing' } | { kind: 'off' } | { kind: 'scene'; sceneId: string };

export interface MotionSlot {
  start: MotionTime;
  /** What happens when motion starts: a scene, or nothing. */
  onMotion: MotionAction;
  /** Minutes without motion before `onNoMotion` runs. */
  noMotionAfterMinutes: number;
  /** What happens after that: all off, a scene, or nothing. */
  onNoMotion: MotionAction;
  /** Leave lights alone when they were changed by hand after the sensor turned them on. */
  doNotDisturb?: boolean;
}

/** When the rule is allowed to act. */
export type Darkness =
  | { mode: 'any' }
  | { mode: 'sunset_to_sunrise'; sunsetOffsetMinutes: number; sunriseOffsetMinutes: number }
  | { mode: 'sensor'; lightLevelServiceId: string; lightLevelType: 'light_level' | 'grouped_light_level'; darkThreshold: number; offset: number };

export interface MotionAutomationSpec {
  sourceDeviceId: string;
  motionServiceId: string;
  motionType: 'motion' | 'camera_motion';
  where: { id: string; kind: 'room' | 'zone' }[];
  darkness: Darkness;
  slots: MotionSlot[];
}

/** The bridge's light-level scale: 10000 · log10(lux) + 1. */
export function luxToLightLevel(lux: number): number {
  return Math.max(0, Math.round(10000 * Math.log10(Math.max(0.01, lux)) + 1));
}

export function lightLevelToLuxValue(level: number): number {
  return Math.pow(10, (level - 1) / 10000);
}

function actionToBridge(a: MotionAction): unknown {
  if (a.kind === 'scene') return { recall: { rid: a.sceneId, rtype: 'scene' } };
  return a.kind === 'off' ? 'all_off' : 'do_nothing';
}

function actionFromBridge(v: unknown): MotionAction {
  if (v === 'all_off') return { kind: 'off' };
  if (v && typeof v === 'object') {
    const recall = (v as { recall?: { rid?: string; rtype?: string } }).recall;
    if (recall?.rid) return { kind: 'scene', sceneId: recall.rid };
  }
  return { kind: 'nothing' };
}

function offsetToBridge(minutes: number): { hours: number } | { minutes: number } {
  return minutes !== 0 && minutes % 60 === 0 ? { hours: minutes / 60 } : { minutes };
}

function offsetFromBridge(v: unknown): number {
  const o = (v ?? {}) as { hours?: number; minutes?: number };
  return (o.hours ?? 0) * 60 + (o.minutes ?? 0);
}

export function buildLightLevelCondition(d: Darkness): Record<string, unknown> | undefined {
  if (d.mode === 'sunset_to_sunrise') return { daylight: { sunrise_sunset: { sunrise_offset: offsetToBridge(d.sunriseOffsetMinutes), sunset_offset: offsetToBridge(d.sunsetOffsetMinutes) } } };
  if (d.mode === 'sensor') return { daylight: { daylight_sensitivity: { light_level_service: { rid: d.lightLevelServiceId, rtype: d.lightLevelType }, settings: { dark_threshold: d.darkThreshold, offset: d.offset } } } };
  return undefined;
}

export function parseLightLevelCondition(v: unknown): Darkness {
  const daylight = (v as { daylight?: Record<string, unknown> } | undefined)?.daylight;
  if (!daylight) return { mode: 'any' };
  const ss = daylight.sunrise_sunset as { sunrise_offset?: unknown; sunset_offset?: unknown } | undefined;
  if (ss) return { mode: 'sunset_to_sunrise', sunsetOffsetMinutes: offsetFromBridge(ss.sunset_offset), sunriseOffsetMinutes: offsetFromBridge(ss.sunrise_offset) };
  const ds = daylight.daylight_sensitivity as { light_level_service?: { rid: string; rtype: string }; settings?: { dark_threshold?: number; offset?: number } } | undefined;
  if (ds?.light_level_service?.rid) {
    return {
      mode: 'sensor',
      lightLevelServiceId: ds.light_level_service.rid,
      lightLevelType: ds.light_level_service.rtype === 'grouped_light_level' ? 'grouped_light_level' : 'light_level',
      darkThreshold: ds.settings?.dark_threshold ?? DEFAULT_DARK_THRESHOLD,
      offset: ds.settings?.offset ?? DEFAULT_DARK_OFFSET,
    };
  }
  return { mode: 'sunset_to_sunrise', sunsetOffsetMinutes: -30, sunriseOffsetMinutes: 30 };
}

/** The bridge configuration for a spec (round-trips what the Hue app writes). */
export function buildAccessoryConfiguration(spec: MotionAutomationSpec): Record<string, unknown> {
  const slots = [...spec.slots].sort((a, b) => a.start.hour * 60 + a.start.minute - (b.start.hour * 60 + b.start.minute));
  const configuration: Record<string, unknown> = {
    source: { rid: spec.sourceDeviceId, rtype: 'device' },
    motion: {
      motion_service: { rid: spec.motionServiceId, rtype: spec.motionType },
      where: spec.where.map((w) => ({ group: { rid: w.id, rtype: w.kind } })),
      when: {
        timeslots: slots.map((s) => ({
          start_time: { type: 'time', time: { hour: s.start.hour, minute: s.start.minute } },
          on_motion: { recall_single: [{ action: actionToBridge(s.onMotion.kind === 'off' ? { kind: 'nothing' } : s.onMotion) }] },
          on_no_motion: { after: { minutes: Math.max(1, Math.round(s.noMotionAfterMinutes)) }, recall_single: [{ action: actionToBridge(s.onNoMotion) }] },
          ...(s.doNotDisturb ? { do_not_disturb: true } : {}),
        })),
      },
    },
  };
  const ll = buildLightLevelCondition(spec.darkness);
  if (ll) configuration.light_level = ll;
  return configuration;
}

/** Reads a bridge configuration back into a spec; null when it is not a motion automation. */
export function parseAccessoryConfiguration(configuration: Record<string, unknown> | undefined): MotionAutomationSpec | null {
  if (!configuration) return null;
  const motion = configuration.motion as
    | { motion_service?: { rid: string; rtype: string }; where?: { group?: { rid: string; rtype: string } }[]; when?: { timeslots?: Record<string, unknown>[] } }
    | undefined;
  const source = configuration.source as { rid?: string; rtype?: string } | undefined;
  if (!motion?.motion_service?.rid || !source?.rid) return null;
  const slots: MotionSlot[] = (motion.when?.timeslots ?? []).map((t) => {
    const start = (t.start_time as { time?: { hour?: number; minute?: number } } | undefined)?.time;
    const onMotion = ((t.on_motion as { recall_single?: { action: unknown }[] } | undefined)?.recall_single ?? [])[0]?.action;
    const noMotion = t.on_no_motion as { after?: { minutes?: number; seconds?: number }; recall_single?: { action: unknown }[] } | undefined;
    return {
      start: { hour: start?.hour ?? 0, minute: start?.minute ?? 0 },
      onMotion: actionFromBridge(onMotion),
      noMotionAfterMinutes: noMotion?.after?.minutes ?? (noMotion?.after?.seconds ? Math.max(1, Math.round(noMotion.after.seconds / 60)) : 5),
      onNoMotion: actionFromBridge((noMotion?.recall_single ?? [])[0]?.action),
      doNotDisturb: t.do_not_disturb === true,
    };
  });
  return {
    sourceDeviceId: source.rid,
    motionServiceId: motion.motion_service.rid,
    motionType: motion.motion_service.rtype === 'camera_motion' ? 'camera_motion' : 'motion',
    where: (motion.where ?? [])
      .map((w) => w.group)
      .filter((g): g is { rid: string; rtype: string } => !!g?.rid)
      .map((g) => ({ id: g.rid, kind: g.rtype === 'zone' ? 'zone' : 'room' })),
    darkness: parseLightLevelCondition(configuration.light_level),
    slots,
  };
}

/**
 * Body for behavior_instance. POST needs `script_id`; PUT refuses it ("property: script_id not
 * allowed"), so pass `forUpdate` when rewriting an existing rule.
 */
export function buildBehaviorInstanceBody(spec: MotionAutomationSpec, opts: { name: string; enabled: boolean; forUpdate?: boolean }): Record<string, unknown> {
  return {
    ...(opts.forUpdate ? {} : { script_id: ACCESSORY_SCRIPT_ID }),
    enabled: opts.enabled,
    metadata: { name: opts.name.slice(0, 32) },
    configuration: buildAccessoryConfiguration(spec),
  };
}

export function isMotionAutomation(r: BehaviorInstanceResource): boolean {
  return r.script_id === ACCESSORY_SCRIPT_ID && !!(r.configuration as { motion?: unknown } | undefined)?.motion;
}

/** "HH:MM", "7:30", "7pm", "7.30 pm", "19h", "19h30", "noon", "midnight". */
export function parseMotionTime(text: string): MotionTime {
  const s = String(text ?? '').trim().toLowerCase();
  if (!s) throw new Error('Time is missing (use HH:MM).');
  if (s === 'noon' || s === 'midday') return { hour: 12, minute: 0 };
  if (s === 'midnight') return { hour: 0, minute: 0 };
  const m = s.match(/^(\d{1,2})(?:[:h.](\d{2}))?\s*(am|pm|h)?$/);
  if (!m) throw new Error(`Invalid time "${text}", expected HH:MM.`);
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? 0);
  if (m[3] === 'pm' && hour < 12) hour += 12;
  if (m[3] === 'am' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) throw new Error(`Invalid time "${text}", expected HH:MM.`);
  return { hour, minute };
}

export function formatMotionTime(t: MotionTime): string {
  return `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
}

function fmtOffset(minutes: number, base: string): string {
  if (minutes === 0) return base;
  const abs = Math.abs(minutes);
  const txt = abs % 60 === 0 ? `${abs / 60} h` : `${abs} min`;
  return `${txt} ${minutes < 0 ? 'before' : 'after'} ${base}`;
}

export function describeDarkness(d: Darkness): string {
  if (d.mode === 'any') return 'any time';
  if (d.mode === 'sunset_to_sunrise') return `only when dark (${fmtOffset(d.sunsetOffsetMinutes, 'sunset')} → ${fmtOffset(d.sunriseOffsetMinutes, 'sunrise')})`;
  const lux = lightLevelToLuxValue(d.darkThreshold);
  return `only when dark (sensor below ~${lux >= 10 ? Math.round(lux) : Math.round(lux * 10) / 10} lx)`;
}

/** Sensor-oriented one-liner, e.g. `07:00 nothing, off after 10 min · 22:00 "Nightlight", off after 5 min · only when dark (…)`. */
export function describeMotionSlots(slots: MotionSlot[], sceneName: (id: string) => string, darkness: Darkness | boolean): string {
  const action = (a: MotionAction) => (a.kind === 'scene' ? `"${sceneName(a.sceneId)}"` : a.kind === 'off' ? 'off' : 'nothing');
  const sorted = [...slots].sort((a, b) => a.start.hour * 60 + a.start.minute - (b.start.hour * 60 + b.start.minute));
  const parts = sorted.map((s) => {
    const then = s.onNoMotion.kind === 'nothing' ? '' : `, ${action(s.onNoMotion)} after ${s.noMotionAfterMinutes} min`;
    return `${sorted.length > 1 ? `${formatMotionTime(s.start)} ` : ''}${action(s.onMotion)}${then}`;
  });
  const tail = typeof darkness === 'boolean' ? (darkness ? 'only when dark' : 'any time') : describeDarkness(darkness);
  return [...parts, tail].join(' · ');
}
