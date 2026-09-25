import type { ScheduleV1 } from './types.ts';

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export const WEEKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

/** Hue v1 weekday bitmask: Monday is the most significant bit. */
export const WEEKDAY_BITS: Record<Weekday, number> = { mon: 64, tue: 32, wed: 16, thu: 8, fri: 4, sat: 2, sun: 1 };

const DAY_LABELS: Record<Weekday, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

const DAY_ALIASES: Record<string, Weekday> = {
  mon: 'mon', monday: 'mon', seg: 'mon', segunda: 'mon',
  tue: 'tue', tues: 'tue', tuesday: 'tue', ter: 'tue', terca: 'tue',
  wed: 'wed', wednesday: 'wed', qua: 'wed', quarta: 'wed',
  thu: 'thu', thur: 'thu', thurs: 'thu', thursday: 'thu', qui: 'thu', quinta: 'thu',
  fri: 'fri', friday: 'fri', sex: 'fri', sexta: 'fri',
  sat: 'sat', saturday: 'sat', sab: 'sat', sabado: 'sat',
  sun: 'sun', sunday: 'sun', dom: 'sun', domingo: 'sun',
};

export function normalizeDays(days?: string[] | string | null): Weekday[] {
  if (!days || (Array.isArray(days) && days.length === 0)) return [...WEEKDAYS];
  const list = Array.isArray(days) ? days : String(days).split(/[,\s]+/);
  const out = new Set<Weekday>();
  for (const raw of list) {
    const d = String(raw).trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (!d) continue;
    if (d === 'daily' || d === 'everyday' || d === 'every day' || d === 'all') return [...WEEKDAYS];
    if (d === 'weekdays' || d === 'workdays') {
      for (const w of ['mon', 'tue', 'wed', 'thu', 'fri'] as Weekday[]) out.add(w);
      continue;
    }
    if (d === 'weekends' || d === 'weekend') {
      out.add('sat');
      out.add('sun');
      continue;
    }
    const wd = DAY_ALIASES[d];
    if (wd) out.add(wd);
  }
  return out.size ? WEEKDAYS.filter((d) => out.has(d)) : [...WEEKDAYS];
}

export function daysToMask(days: Weekday[]): number {
  return days.reduce((mask, d) => mask | WEEKDAY_BITS[d], 0);
}

export function maskToDays(mask: number): Weekday[] {
  return WEEKDAYS.filter((d) => (mask & WEEKDAY_BITS[d]) !== 0);
}

export function normalizeTime(time: string): string {
  const m = String(time).trim().match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) throw new Error(`Invalid time "${time}", expected HH:MM`);
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const sec = m[3] ? parseInt(m[3], 10) : 0;
  const ampm = m[4]?.toLowerCase();
  if (ampm === 'pm' && h < 12) h += 12;
  if (ampm === 'am' && h === 12) h = 0;
  if (h > 23 || min > 59 || sec > 59) throw new Error(`Invalid time "${time}"`);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(h)}:${p(min)}:${p(sec)}`;
}

export interface LocalTimeSpec {
  /** HH:MM or HH:MM:SS */
  time: string;
  days?: string[] | string | null;
  /** YYYY-MM-DD for a one-off schedule */
  onceDate?: string | null;
  /** Randomise by up to this many seconds (Hue "A" suffix). */
  randomizeSeconds?: number;
}

/** Build the Hue v1 `localtime` string. */
export function buildLocalTime(spec: LocalTimeSpec): string {
  const t = normalizeTime(spec.time);
  const rand = spec.randomizeSeconds ? `A${normalizeTime(`00:00:${Math.min(3599, spec.randomizeSeconds)}`)}` : '';
  if (spec.onceDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(spec.onceDate)) throw new Error(`Invalid date "${spec.onceDate}", expected YYYY-MM-DD`);
    return `${spec.onceDate}T${t}${rand}`;
  }
  const mask = daysToMask(normalizeDays(spec.days));
  return `W${String(mask).padStart(3, '0')}/T${t}${rand}`;
}

export type ParsedLocalTime =
  | { kind: 'recurring'; days: Weekday[]; time: string; randomize?: string }
  | { kind: 'once'; date: string; time: string; randomize?: string }
  | { kind: 'timer'; duration: string; recurring: boolean; times?: number }
  | { kind: 'unknown'; raw: string };

export function parseLocalTime(localtime: string): ParsedLocalTime {
  const s = String(localtime ?? '').trim();
  let m = s.match(/^W(\d{1,3})\/T(\d{2}:\d{2}:\d{2})(A\d{2}:\d{2}:\d{2})?$/);
  if (m) return { kind: 'recurring', days: maskToDays(parseInt(m[1], 10)), time: m[2].slice(0, 5), randomize: m[3]?.slice(1) };
  m = s.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(A\d{2}:\d{2}:\d{2})?$/);
  if (m) return { kind: 'once', date: m[1], time: m[2].slice(0, 5), randomize: m[3]?.slice(1) };
  m = s.match(/^(R(\d*)\/)?PT(\d{2}:\d{2}:\d{2})/);
  if (m) return { kind: 'timer', duration: m[3], recurring: !!m[1], times: m[2] ? parseInt(m[2], 10) : undefined };
  return { kind: 'unknown', raw: s };
}

export function describeLocalTime(parsed: ParsedLocalTime): string {
  switch (parsed.kind) {
    case 'recurring': {
      const d = parsed.days;
      let when: string;
      if (d.length === 7) when = 'Every day';
      else if (d.length === 5 && !d.includes('sat') && !d.includes('sun')) when = 'Weekdays';
      else if (d.length === 2 && d.includes('sat') && d.includes('sun')) when = 'Weekends';
      else if (d.length === 0) when = 'Never';
      else when = d.map((x) => DAY_LABELS[x]).join(', ');
      return `${when} at ${parsed.time}`;
    }
    case 'once':
      return `On ${parsed.date} at ${parsed.time}`;
    case 'timer':
      return `${parsed.recurring ? 'Every' : 'After'} ${parsed.duration}`;
    default:
      return parsed.raw;
  }
}

/** "/groups/3" -> "3" */
export function v1Id(idV1?: string): string | undefined {
  if (!idV1) return undefined;
  const parts = idV1.split('/').filter(Boolean);
  return parts[parts.length - 1];
}

export interface ScheduleCommandSpec {
  appKey: string;
  target: { kind: 'group' | 'light'; v1Id: string };
  on?: boolean;
  /** 1..100 */
  brightness?: number;
  sceneV1Id?: string;
  /** Transition in ms (v1 uses 100 ms units). */
  transitionMs?: number;
}

export function buildScheduleCommand(spec: ScheduleCommandSpec): ScheduleV1['command'] {
  const body: Record<string, unknown> = {};
  if (spec.sceneV1Id) body.scene = spec.sceneV1Id;
  if (spec.on !== undefined) body.on = spec.on;
  if (spec.brightness !== undefined) {
    body.bri = Math.max(1, Math.min(254, Math.round((spec.brightness / 100) * 254)));
    if (spec.on === undefined) body.on = true;
  }
  if (spec.transitionMs !== undefined) body.transitiontime = Math.round(spec.transitionMs / 100);
  const address =
    spec.target.kind === 'group'
      ? `/api/${spec.appKey}/groups/${spec.target.v1Id}/action`
      : `/api/${spec.appKey}/lights/${spec.target.v1Id}/state`;
  return { address, method: 'PUT', body };
}

export interface ParsedScheduleCommand {
  targetKind: 'group' | 'light' | 'unknown';
  v1Id?: string;
  on?: boolean;
  brightness?: number;
  sceneV1Id?: string;
}

export function parseScheduleCommand(command: ScheduleV1['command']): ParsedScheduleCommand {
  const m = String(command?.address ?? '').match(/\/(groups|lights)\/([^/]+)\//);
  const body = (command?.body ?? {}) as Record<string, unknown>;
  const out: ParsedScheduleCommand = {
    targetKind: m ? (m[1] === 'groups' ? 'group' : 'light') : 'unknown',
    v1Id: m?.[2],
  };
  if (typeof body.on === 'boolean') out.on = body.on;
  if (typeof body.bri === 'number') out.brightness = Math.round((body.bri / 254) * 100);
  if (typeof body.scene === 'string') out.sceneV1Id = body.scene;
  return out;
}
