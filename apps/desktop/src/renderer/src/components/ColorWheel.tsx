import { hexToRgb, hsvToRgb, rgbToHex, rgbToHsv, rgbToXy, type Gamut, type XY } from '@hue/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface Props {
  hex: string;
  gamut: Gamut;
  size?: number;
  onChange: (xy: XY, hex: string) => void;
  onCommit?: (xy: XY, hex: string) => void;
}

/** Hue/saturation colour disc rendered on a canvas. */
export default function ColorWheel({ hex, gamut, size = 260, onChange, onCommit }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<{ h: number; s: number } | null>(null);
  const lastRef = useRef<{ xy: XY; hex: string } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(canvas.width, canvas.height);
    const c = canvas.width / 2;
    const r = c - 1;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        const dx = x - c;
        const dy = y - c;
        const d = Math.sqrt(dx * dx + dy * dy);
        const i = (y * canvas.width + x) * 4;
        if (d > r + 1) {
          img.data[i + 3] = 0;
          continue;
        }
        const h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
        const s = Math.min(1, d / r);
        const rgb = hsvToRgb({ h, s: Math.pow(s, 0.85), v: 1 });
        img.data[i] = rgb.r;
        img.data[i + 1] = rgb.g;
        img.data[i + 2] = rgb.b;
        img.data[i + 3] = d > r - 1 ? Math.max(0, Math.min(255, (r + 1 - d) * 255)) : 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [size]);

  const current = useMemo(() => {
    if (drag) return drag;
    const rgb = hexToRgb(hex) ?? { r: 255, g: 200, b: 150 };
    const hsv = rgbToHsv(rgb);
    return { h: hsv.h, s: hsv.s };
  }, [hex, drag]);

  const thumb = useMemo(() => {
    const c = size / 2;
    const rad = (current.h * Math.PI) / 180;
    const dist = Math.pow(current.s, 1 / 0.85) * (c - 1);
    return { x: c + Math.cos(rad) * dist, y: c + Math.sin(rad) * dist };
  }, [current, size]);

  const pick = useCallback(
    (clientX: number, clientY: number, commit = false) => {
      const el = canvasRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const c = size / 2;
      const dx = clientX - rect.left - c;
      const dy = clientY - rect.top - c;
      const d = Math.min(c - 1, Math.sqrt(dx * dx + dy * dy));
      const h = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
      const s = Math.pow(d / (c - 1), 0.85);
      const rgb = hsvToRgb({ h, s, v: 1 });
      const out = { xy: rgbToXy(rgb, gamut), hex: rgbToHex(rgb) };
      lastRef.current = out;
      setDrag({ h, s });
      if (commit) onCommit?.(out.xy, out.hex);
      else onChange(out.xy, out.hex);
    },
    [gamut, onChange, onCommit, size],
  );

  return (
    <div className="relative select-none mx-auto" style={{ width: size, height: size }}>
      <canvas
        ref={canvasRef}
        style={{ width: size, height: size, borderRadius: '50%', boxShadow: '0 10px 30px -10px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(255,255,255,0.15)', cursor: 'crosshair', touchAction: 'none' }}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          pick(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) pick(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => {
          pick(e.clientX, e.clientY, true);
          setDrag(null);
        }}
      />
      <div
        className="pointer-events-none absolute rounded-full border-[3px] border-white shadow-[0_2px_10px_rgba(0,0,0,0.5)]"
        style={{ width: 26, height: 26, left: thumb.x - 13, top: thumb.y - 13, background: drag ? (lastRef.current?.hex ?? hex) : hex }}
      />
    </div>
  );
}
