import type { Gamut, XY } from './types.ts';

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface HSV {
  h: number;
  s: number;
  v: number;
}

/** Gamut C (most modern Hue lamps). Used when a light does not report a gamut. */
export const GAMUT_C: Gamut = {
  red: { x: 0.6915, y: 0.3083 },
  green: { x: 0.17, y: 0.7 },
  blue: { x: 0.1532, y: 0.0475 },
};

export const GAMUT_A: Gamut = {
  red: { x: 0.704, y: 0.296 },
  green: { x: 0.2151, y: 0.7106 },
  blue: { x: 0.138, y: 0.08 },
};

export const GAMUT_B: Gamut = {
  red: { x: 0.675, y: 0.322 },
  green: { x: 0.409, y: 0.518 },
  blue: { x: 0.167, y: 0.04 },
};

export function gamutForType(type?: string): Gamut {
  if (type === 'A') return GAMUT_A;
  if (type === 'B') return GAMUT_B;
  return GAMUT_C;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function srgbToLinear(c: number): number {
  return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92;
}

function linearToSrgb(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

/** sRGB 0..255 -> CIE xy (Philips conversion), clipped to the given gamut. */
export function rgbToXy(rgb: RGB, gamut: Gamut = GAMUT_C): XY {
  const r = srgbToLinear(clamp(rgb.r, 0, 255) / 255);
  const g = srgbToLinear(clamp(rgb.g, 0, 255) / 255);
  const b = srgbToLinear(clamp(rgb.b, 0, 255) / 255);
  const X = r * 0.664511 + g * 0.154324 + b * 0.162028;
  const Y = r * 0.283881 + g * 0.668433 + b * 0.047685;
  const Z = r * 0.000088 + g * 0.07231 + b * 0.986039;
  const sum = X + Y + Z;
  if (sum === 0) return { x: 0.3227, y: 0.329 };
  const xy = { x: X / sum, y: Y / sum };
  const clipped = clipToGamut(xy, gamut);
  return { x: Number(clipped.x.toFixed(4)), y: Number(clipped.y.toFixed(4)) };
}

/** CIE xy + brightness (0..1) -> sRGB 0..255. */
export function xyToRgb(xy: XY, brightness = 1): RGB {
  const x = xy.x;
  const y = xy.y === 0 ? 1e-6 : xy.y;
  const z = 1 - x - y;
  const Y = clamp(brightness, 0, 1);
  const X = (Y / y) * x;
  const Z = (Y / y) * z;

  let r = X * 1.656492 - Y * 0.354851 - Z * 0.255038;
  let g = -X * 0.707196 + Y * 1.655397 + Z * 0.036152;
  let b = X * 0.051713 - Y * 0.121364 + Z * 1.01153;

  const max = Math.max(r, g, b);
  if (max > 1) {
    r /= max;
    g /= max;
    b /= max;
  }
  r = clamp(r, 0, 1);
  g = clamp(g, 0, 1);
  b = clamp(b, 0, 1);
  return {
    r: Math.round(linearToSrgb(r) * 255),
    g: Math.round(linearToSrgb(g) * 255),
    b: Math.round(linearToSrgb(b) * 255),
  };
}

/** Returns the colour of the light as it would look at full brightness (for swatches). */
export function xyToHex(xy: XY): string {
  return rgbToHex(xyToRgb(xy, 1));
}

function crossProduct(p1: XY, p2: XY): number {
  return p1.x * p2.y - p1.y * p2.x;
}

export function isInsideGamut(p: XY, gamut: Gamut): boolean {
  const v1 = { x: gamut.green.x - gamut.red.x, y: gamut.green.y - gamut.red.y };
  const v2 = { x: gamut.blue.x - gamut.red.x, y: gamut.blue.y - gamut.red.y };
  const q = { x: p.x - gamut.red.x, y: p.y - gamut.red.y };
  const denom = crossProduct(v1, v2);
  if (denom === 0) return false;
  const s = crossProduct(q, v2) / denom;
  const t = crossProduct(v1, q) / denom;
  return s >= 0 && t >= 0 && s + t <= 1;
}

function closestPointOnSegment(a: XY, b: XY, p: XY): XY {
  const ap = { x: p.x - a.x, y: p.y - a.y };
  const ab = { x: b.x - a.x, y: b.y - a.y };
  const ab2 = ab.x * ab.x + ab.y * ab.y;
  const t = ab2 === 0 ? 0 : clamp((ap.x * ab.x + ap.y * ab.y) / ab2, 0, 1);
  return { x: a.x + ab.x * t, y: a.y + ab.y * t };
}

function distance(a: XY, b: XY): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function clipToGamut(p: XY, gamut: Gamut): XY {
  if (isInsideGamut(p, gamut)) return p;
  const candidates = [
    closestPointOnSegment(gamut.red, gamut.green, p),
    closestPointOnSegment(gamut.green, gamut.blue, p),
    closestPointOnSegment(gamut.blue, gamut.red, p),
  ];
  let best = candidates[0];
  let bestD = distance(best, p);
  for (const c of candidates.slice(1)) {
    const d = distance(c, p);
    if (d < bestD) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

export function hexToRgb(hex: string): RGB | null {
  const m = hex.trim().replace(/^#/, '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbToHex(rgb: RGB): string {
  const h = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${h(rgb.r)}${h(rgb.g)}${h(rgb.b)}`;
}

export function hsvToRgb(hsv: HSV): RGB {
  const h = ((hsv.h % 360) + 360) % 360;
  const s = clamp(hsv.s, 0, 1);
  const v = clamp(hsv.v, 0, 1);
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}

export function rgbToHsv(rgb: RGB): HSV {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

export function mirekToKelvin(mirek: number): number {
  return Math.round(1_000_000 / mirek);
}

export function kelvinToMirek(kelvin: number): number {
  return Math.round(1_000_000 / kelvin);
}

/**
 * Approximate sRGB for a black body at the given colour temperature (Tanner Helland's algorithm).
 * Used for previews of white lights.
 */
export function kelvinToRgb(kelvin: number): RGB {
  const t = clamp(kelvin, 1000, 40000) / 100;
  let r: number;
  let g: number;
  let b: number;
  if (t <= 66) {
    r = 255;
    g = 99.4708025861 * Math.log(t) - 161.1195681661;
    b = t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  } else {
    r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
    g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
    b = 255;
  }
  return { r: clamp(Math.round(r), 0, 255), g: clamp(Math.round(g), 0, 255), b: clamp(Math.round(b), 0, 255) };
}

export function mirekToHex(mirek: number): string {
  return rgbToHex(kelvinToRgb(mirekToKelvin(mirek)));
}

/** Named colours understood by the assistant and the quick palette. */
export const COLOR_NAMES: Record<string, string> = {
  red: '#ff0000',
  crimson: '#dc143c',
  orange: '#ff7a00',
  amber: '#ffbf00',
  yellow: '#ffe600',
  gold: '#ffd700',
  lime: '#8cff00',
  green: '#00ff40',
  mint: '#5dffb0',
  teal: '#00c8b4',
  turquoise: '#40e0d0',
  cyan: '#00ffff',
  aqua: '#00e5ff',
  'sky blue': '#5ec8ff',
  blue: '#0040ff',
  navy: '#001880',
  indigo: '#4b0082',
  violet: '#8a2be2',
  purple: '#a020f0',
  lavender: '#b57edc',
  magenta: '#ff00ff',
  pink: '#ff69b4',
  'hot pink': '#ff1493',
  rose: '#ff007f',
  salmon: '#fa8072',
  coral: '#ff7f50',
  peach: '#ffb07c',
  white: '#ffffff',
};

/** Named white presets in colour temperature (Kelvin). */
export const WHITE_PRESETS: Record<string, number> = {
  candlelight: 2000,
  candle: 2000,
  'very warm': 2200,
  relax: 2237,
  'warm white': 2700,
  warm: 2700,
  cozy: 2700,
  cosy: 2700,
  read: 3000,
  reading: 3000,
  'soft white': 3000,
  neutral: 3500,
  'neutral white': 3500,
  'cool white': 4000,
  cool: 4000,
  concentrate: 4292,
  bright: 4300,
  energize: 6410,
  energise: 6410,
  daylight: 6500,
  'cold white': 6500,
};

export interface ParsedColor {
  xy?: XY;
  mirek?: number;
  hex: string;
  label: string;
}

/**
 * Parse a free-form colour description: "#ff8800", "red", "warm white", "2700K", "300 mirek".
 */
export function parseColor(input: string, gamut: Gamut = GAMUT_C): ParsedColor | null {
  const s = String(input ?? '').trim().toLowerCase();
  if (!s) return null;
  const kelvin = s.match(/^(\d{3,5})\s*k(elvin)?$/);
  if (kelvin) {
    const k = clamp(parseInt(kelvin[1], 10), 2000, 6535);
    return { mirek: kelvinToMirek(k), hex: rgbToHex(kelvinToRgb(k)), label: `${k}K` };
  }
  const mirek = s.match(/^(\d{3})\s*(mirek|mired)$/);
  if (mirek) {
    const m = clamp(parseInt(mirek[1], 10), 153, 500);
    return { mirek: m, hex: mirekToHex(m), label: `${mirekToKelvin(m)}K` };
  }
  const preset = WHITE_PRESETS[s] ?? WHITE_PRESETS[s.replace(/\s*white$/, '')];
  if (preset) {
    return { mirek: kelvinToMirek(preset), hex: rgbToHex(kelvinToRgb(preset)), label: s };
  }
  const named = COLOR_NAMES[s];
  const hex = named ?? (hexToRgb(s) ? (s.startsWith('#') ? s : `#${s}`) : null);
  if (!hex) return null;
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  return { xy: rgbToXy(rgb, gamut), hex: rgbToHex(rgb), label: named ? s : hex };
}

/** Parse a colour temperature description into mirek: "warm", "cool", "3000K", 3000, 250 (mirek). */
export function parseColorTemperature(input: string | number): number | null {
  if (typeof input === 'number') {
    if (input >= 153 && input <= 500) return Math.round(input);
    if (input >= 1000 && input <= 10000) return clamp(kelvinToMirek(input), 153, 500);
    return null;
  }
  const s = String(input).trim().toLowerCase();
  const numeric = Number(s.replace(/k(elvin)?$/, ''));
  if (!Number.isNaN(numeric) && s !== '') return parseColorTemperature(numeric);
  const preset = WHITE_PRESETS[s] ?? WHITE_PRESETS[s.replace(/\s*white$/, '')];
  if (preset) return clamp(kelvinToMirek(preset), 153, 500);
  return null;
}
