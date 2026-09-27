/**
 * Wake-up and go-to-sleep routines: bridge `behavior_instance`s of the Hue app's "Basic wake up
 * routine" and "Go to sleep routines" scripts. Shapes verified on a Bridge Pro (2026-09-27):
 * - wake up: { end_brightness, fade_in_duration{seconds}, style: 'sunrise', turn_lights_off_after?{minutes}, when{recurrence_days[], time_point{type:'time', time{hour,minute}}}, where[{group}] }
 * - go to sleep: { end_state: 'nightlight' | 'turn_off', fade_out_duration{seconds}, style: 'sunset', when{…}, where[…] }
 * Several instances may exist (one per bedroom, for example).
 */
import { formatMotionTime, parseMotionTime, type MotionTime } from './automations.ts';
import type { BehaviorInstanceResource } from './types.ts';

export const WAKE_UP_SCRIPT_ID = 'ff8957e3-2eb9-4699-a0c8-ad2cb3ede704';
export const GO_TO_SLEEP_SCRIPT_ID = '7e571ac6-f363-42e1-809a-4cbf6523ed72';

export const DAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;
export type DayName = (typeof DAY_NAMES)[number];

export interface RoutineSpec {
  kind: 'wake_up' | 'go_to_sleep';
  where: { id: string; kind: 'room' | 'zone' }[];
  time: MotionTime;
  days: DayName[];
  fadeMinutes: number;
  /** Wake up: brightness reached at the end of the sunrise (1–100). */
  endBrightness?: number;
  /** Wake up: switch the lights off this many minutes after the alarm time; null = leave them on. */
  turnOffAfterMinutes?: number | null;
  /** Go to sleep: what the lights end in. */
  endState?: 'nightlight' | 'turn_off';
}

/** Accepts mon/tue/…, full names, "weekdays", "weekends", "daily"/"every day"/"all"; empty = every day. */
export function parseDays(input: unknown): DayName[] {
  const raw: string[] = Array.isArray(input) ? input.map(String) : typeof input === 'string' ? input.split(/[,\s/]+/) : [];
  const words = raw.map((w) => w.trim().toLowerCase()).filter(Boolean);
  if (!words.length) return [...DAY_NAMES];
  const out = new Set<DayName>();
  for (const w of words) {
    if (['daily', 'everyday', 'every', 'day', 'all', 'always'].includes(w)) return [...DAY_NAMES];
    if (w === 'weekdays' || w === 'weekday') for (const d of DAY_NAMES.slice(0, 5)) out.add(d);
    else if (w === 'weekends' || w === 'weekend') for (const d of DAY_NAMES.slice(5)) out.add(d);
    else {
      const d = DAY_NAMES.find((n) => n.startsWith(w.slice(0, 3)));
      if (!d) throw new Error(`Unknown day "${w}". Use mon, tue, wed, thu, fri, sat, sun, weekdays or weekends.`);
      out.add(d);
    }
  }
  return DAY_NAMES.filter((d) => out.has(d));
}

export function describeDays(days: readonly string[]): string {
  const set = new Set(days);
  if (DAY_NAMES.every((d) => set.has(d))) return 'every day';
  if (DAY_NAMES.slice(0, 5).every((d) => set.has(d)) && !set.has('saturday') && !set.has('sunday')) return 'weekdays';
  if (set.has('saturday') && set.has('sunday') && set.size === 2) return 'weekends';
  return DAY_NAMES.filter((d) => set.has(d)).map((d) => d.slice(0, 3)).join(', ') || 'never';
}

export function buildRoutineConfiguration(spec: RoutineSpec): Record<string, unknown> {
  const when = { recurrence_days: spec.days, time_point: { type: 'time', time: { hour: spec.time.hour, minute: spec.time.minute } } };
  const where = spec.where.map((w) => ({ group: { rid: w.id, rtype: w.kind } }));
  const seconds = Math.max(60, Math.round(spec.fadeMinutes * 60));
  if (spec.kind === 'wake_up') {
    return {
      end_brightness: Math.max(1, Math.min(100, Math.round(spec.endBrightness ?? 100))),
      fade_in_duration: { seconds },
      style: 'sunrise',
      ...(spec.turnOffAfterMinutes ? { turn_lights_off_after: { minutes: Math.max(1, Math.round(spec.turnOffAfterMinutes)) } } : {}),
      when,
      where,
    };
  }
  return { end_state: spec.endState ?? 'nightlight', fade_out_duration: { seconds }, style: 'sunset', when, where };
}

export function parseRoutineConfiguration(scriptId: string, cfg: Record<string, unknown> | undefined): RoutineSpec | null {
  if (!cfg) return null;
  const kind = scriptId === WAKE_UP_SCRIPT_ID ? 'wake_up' : scriptId === GO_TO_SLEEP_SCRIPT_ID ? 'go_to_sleep' : null;
  if (!kind) return null;
  const when = cfg.when as { recurrence_days?: string[]; time_point?: { time?: { hour?: number; minute?: number } } } | undefined;
  const t = when?.time_point?.time;
  const fade = (kind === 'wake_up' ? cfg.fade_in_duration : cfg.fade_out_duration) as { seconds?: number } | undefined;
  const off = cfg.turn_lights_off_after as { minutes?: number } | undefined;
  return {
    kind,
    where: ((cfg.where as { group?: { rid: string; rtype: string } }[] | undefined) ?? [])
      .map((w) => w.group)
      .filter((g): g is { rid: string; rtype: string } => !!g?.rid)
      .map((g) => ({ id: g.rid, kind: g.rtype === 'zone' ? 'zone' : 'room' })),
    time: { hour: t?.hour ?? 0, minute: t?.minute ?? 0 },
    days: (when?.recurrence_days ?? []).filter((d): d is DayName => (DAY_NAMES as readonly string[]).includes(d)),
    fadeMinutes: Math.round((fade?.seconds ?? 1800) / 60),
    endBrightness: kind === 'wake_up' ? ((cfg.end_brightness as number | undefined) ?? 100) : undefined,
    turnOffAfterMinutes: kind === 'wake_up' ? (off?.minutes ?? null) : undefined,
    endState: kind === 'go_to_sleep' ? ((cfg.end_state as 'nightlight' | 'turn_off' | undefined) ?? 'nightlight') : undefined,
  };
}

export function buildRoutineBody(spec: RoutineSpec, opts: { name: string; enabled: boolean; forUpdate?: boolean }): Record<string, unknown> {
  return {
    ...(opts.forUpdate ? {} : { script_id: spec.kind === 'wake_up' ? WAKE_UP_SCRIPT_ID : GO_TO_SLEEP_SCRIPT_ID }),
    enabled: opts.enabled,
    metadata: { name: opts.name.slice(0, 32) },
    configuration: buildRoutineConfiguration(spec),
  };
}

export function isRoutine(r: BehaviorInstanceResource): boolean {
  return r.script_id === WAKE_UP_SCRIPT_ID || r.script_id === GO_TO_SLEEP_SCRIPT_ID;
}

export function describeRoutine(spec: RoutineSpec): string {
  const when = `${formatMotionTime(spec.time)} ${describeDays(spec.days)}`;
  if (spec.kind === 'wake_up') {
    return `sunrise over ${spec.fadeMinutes} min to ${spec.endBrightness ?? 100}% at ${when}${spec.turnOffAfterMinutes ? `, off ${spec.turnOffAfterMinutes} min later` : ''}`;
  }
  return `fade out over ${spec.fadeMinutes} min at ${when}, then ${spec.endState === 'turn_off' ? 'off' : 'nightlight'}`;
}

export { parseMotionTime as parseRoutineTime };
