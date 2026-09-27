import type { CameraView } from '@hue/core';
import { Cctv, Lightbulb, Loader2, Power, Sun, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BatteryIcon } from './Sensors';
import { cx, IconButton, Toggle } from './ui';
import { useApp } from '../store';
import type { EmulatorStatus } from '../../../shared/ipc-types.ts';

/**
 * Decodes the raw Annex-B H.264 stream of the camera engine (the official Hue app in a hidden
 * emulator) with WebCodecs and paints it on a canvas, cropped to the app's video box.
 */
class H264Canvas {
  private decoder: VideoDecoder | null = null;
  private sps: Uint8Array | null = null;
  private pps: Uint8Array | null = null;
  private pending = new Uint8Array(0);
  private au: Uint8Array[] = [];
  private ts = 0;
  crop: { x: number; y: number; w: number; h: number } | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onFrame: () => void,
    private readonly onError: (message: string) => void,
  ) {}

  reset() {
    try {
      this.decoder?.close();
    } catch {
      /* ignore */
    }
    this.decoder = null;
    this.sps = null;
    this.pps = null;
    this.pending = new Uint8Array(0);
    this.au = [];
  }

  push(chunk: Uint8Array) {
    const buf = new Uint8Array(this.pending.length + chunk.length);
    buf.set(this.pending, 0);
    buf.set(chunk, this.pending.length);
    const starts: number[] = [];
    for (let i = 0; i + 2 < buf.length; i++) {
      if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1) {
        starts.push(i);
        i += 2;
      }
    }
    if (starts.length < 2) {
      this.pending = buf;
      return;
    }
    for (let k = 0; k + 1 < starts.length; k++) {
      let end = starts[k + 1];
      while (end > starts[k] + 3 && buf[end - 1] === 0) end--; // leading zero of a 4-byte start code
      this.handleNal(buf.subarray(starts[k] + 3, end));
    }
    this.pending = buf.slice(starts[starts.length - 1]);
  }

  private handleNal(nal: Uint8Array) {
    if (!nal.length) return;
    const type = nal[0] & 0x1f;
    if (type === 7) {
      this.sps = nal.slice();
      return;
    }
    if (type === 8) {
      this.pps = nal.slice();
      return;
    }
    if (type === 9) {
      this.flushAu();
      return;
    }
    if (type !== 1 && type !== 5) return;
    // first_mb_in_slice == 0 (ue(v) starting with bit 1) marks a new picture.
    if (this.au.length && nal[1] & 0x80) this.flushAu();
    this.au.push(nal.slice());
  }

  private flushAu() {
    if (!this.au.length) return;
    const au = this.au;
    this.au = [];
    const key = au.some((n) => (n[0] & 0x1f) === 5);
    if (!this.decoder) {
      if (!key || !this.sps || !this.pps) return; // wait for a keyframe with parameter sets
      const codec = `avc1.${Array.from(this.sps.subarray(1, 4), (b) => b.toString(16).padStart(2, '0')).join('')}`;
      const dec = new VideoDecoder({ output: (f) => this.paint(f), error: (e) => this.onError(e.message) });
      try {
        dec.configure({ codec, optimizeForLatency: true });
      } catch (err) {
        this.onError((err as Error).message);
        return;
      }
      this.decoder = dec;
    }
    if (this.decoder.state !== 'configured') return;
    const parts = key && this.sps && this.pps ? [this.sps, this.pps, ...au] : au;
    const data = new Uint8Array(parts.reduce((n, p) => n + 4 + p.length, 0));
    let o = 0;
    for (const p of parts) {
      data.set([0, 0, 0, 1], o);
      o += 4;
      data.set(p, o);
      o += p.length;
    }
    try {
      this.decoder.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: this.ts, data }));
    } catch (err) {
      this.onError((err as Error).message);
      this.reset();
    }
    this.ts += 33_333;
  }

  private paint(frame: VideoFrame) {
    const fw = frame.displayWidth;
    const fh = frame.displayHeight;
    let c = this.crop;
    if (c && (c.x < 0 || c.y < 0 || c.x + c.w > fw || c.y + c.h > fh || c.w < 16 || c.h < 16)) c = null;
    const w = c ? c.w : fw;
    const h = c ? c.h : fh;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const ctx = this.canvas.getContext('2d');
    if (ctx) {
      if (c) ctx.drawImage(frame, c.x, c.y, c.w, c.h, 0, 0, w, h);
      else ctx.drawImage(frame, 0, 0, w, h);
    }
    frame.close();
    this.onFrame();
  }
}

const ENGINE_LABEL: Record<EmulatorStatus['state'], string> = {
  absent: 'No camera engine',
  stopped: 'Engine off',
  starting: 'Starting engine',
  booting: 'Starting engine',
  preparing: 'Starting engine',
  ready: 'Ready',
  error: 'Engine problem',
};

/** Pairs the engine's camera names (as named in the Hue app) with the bridge's camera devices. */
export function pairCameras(engineNames: string[], bridgeCams: CameraView[]): { name: string; cam: CameraView | null }[] {
  const left = [...bridgeCams];
  const take = (pred: (c: CameraView) => boolean) => {
    const i = left.findIndex(pred);
    return i >= 0 ? left.splice(i, 1)[0] : null;
  };
  const pairs = engineNames.map((name) => {
    const n = name.toLowerCase();
    return { name, cam: take((c) => c.name.toLowerCase() === n) ?? take((c) => (c.roomName ?? '').toLowerCase() === n) };
  });
  for (const p of pairs) if (!p.cam && left.length) p.cam = left.shift()!;
  return pairs;
}

interface Tile {
  key: string;
  /** What the tile says: the Hue app's name once the engine has listed the cameras, else the bridge's. */
  label: string;
  engineName: string | null;
  cam: CameraView | null;
}

function buildTiles(engineNames: string[], bridgeCams: CameraView[]): Tile[] {
  if (engineNames.length) return pairCameras(engineNames, bridgeCams).map(({ name, cam }) => ({ key: cam?.id ?? name, label: name, engineName: name, cam }));
  return bridgeCams.map((c) => ({ key: c.id, label: c.roomName ?? c.name, engineName: null, cam: c }));
}

/**
 * Cameras: the live picture on the left, one tile per camera on the right. Click a tile to
 * watch it, click again (or the X) to stop. The engine starts with the app, so a camera is
 * normally one click away.
 */
export default function CameraStage() {
  const bridgeCams = useApp((s) => s.home.cameras);
  const wanted = useApp((s) => s.wantedCamera);
  const setWanted = useApp((s) => s.setWantedCamera);
  const openLight = useApp((s) => s.openLight);
  const toast = useApp((s) => s.toast);
  const [engine, setEngine] = useState<EmulatorStatus | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const [fps, setFps] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const decoderRef = useRef<H264Canvas | null>(null);
  const frameCount = useRef(0);

  useEffect(() => {
    let alive = true;
    window.hue.getEmulatorStatus().then((s) => alive && setEngine(s)).catch(() => undefined);
    const off = window.hue.onEmulatorStatus((s) => alive && setEngine(s));
    return () => {
      alive = false;
      off();
    };
  }, []);

  // Frame pump while a camera is open.
  useEffect(() => {
    if (!active || !canvasRef.current) return;
    const dec = new H264Canvas(
      canvasRef.current,
      () => {
        frameCount.current += 1;
        setLive(true);
      },
      (m) => setError(m),
    );
    dec.crop = engine?.videoBox ?? null;
    decoderRef.current = dec;
    const off = window.hue.onEmulatorFrame((f) => {
      if (f instanceof Uint8Array) dec.push(f);
      else dec.reset();
    });
    const timer = setInterval(() => {
      setFps(frameCount.current);
      frameCount.current = 0;
    }, 1000);
    return () => {
      off();
      clearInterval(timer);
      dec.reset();
      decoderRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    if (decoderRef.current) decoderRef.current.crop = engine?.videoBox ?? null;
  }, [engine?.videoBox]);

  const engineNames = engine?.cameras ?? [];
  const tiles = useMemo(() => buildTiles(engineNames, bridgeCams), [engineNames, bridgeCams]);

  const run = useCallback(async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }, []);

  const watch = useCallback(
    (tile: Tile) =>
      run(tile.key, async () => {
        if (active && active !== tile.key) await window.hue.emulatorStopStream();
        setLive(false);
        setActive(tile.key);
        let name = tile.engineName;
        if (!name) {
          // The engine has not listed the cameras yet: bring it up, then map this tile to the app's name.
          const s = await window.hue.emulatorEnsureRunning();
          if (s.state !== 'ready') {
            setActive(null);
            throw new Error(s.error ?? ENGINE_LABEL[s.state]);
          }
          const match = buildTiles(s.cameras, bridgeCams).find((t) => t.cam && t.cam.id === tile.cam?.id);
          name = match?.engineName ?? tile.label;
        }
        const s = await window.hue.emulatorOpenCamera(name);
        if (s.state !== 'ready' || s.error) {
          setActive(null);
          throw new Error(s.error ?? ENGINE_LABEL[s.state]);
        }
        await window.hue.emulatorStartStream();
      }),
    [active, run, bridgeCams],
  );

  const close = useCallback(
    () =>
      run('close', async () => {
        await window.hue.emulatorStopStream();
        await window.hue.emulatorCloseCamera();
        setActive(null);
        setLive(false);
      }),
    [run],
  );

  // A camera requested from the tray / shortcuts.
  useEffect(() => {
    if (!wanted || busy) return;
    const w = wanted.toLowerCase();
    const tile = tiles.find((t) => t.label.toLowerCase() === w || t.cam?.name.toLowerCase() === w || (t.cam?.roomName ?? '').toLowerCase() === w);
    setWanted(null);
    if (tile) watch(tile);
  }, [wanted, busy, tiles, watch, setWanted]);

  useEffect(
    () => () => {
      window.hue.emulatorStopStream().catch(() => undefined);
      window.hue.emulatorCloseCamera().catch(() => undefined);
    },
    [],
  );

  if (!tiles.length) return null;
  const activeTile = tiles.find((t) => t.key === active) ?? null;
  const ready = engine?.state === 'ready';
  const engineBusy = !!engine && ['starting', 'booting', 'preparing'].includes(engine.state);
  const shownError = error ?? engine?.error ?? null;
  const canWatch = !!engine?.available && engine.state !== 'absent';

  return (
    <section className="surface rounded-2xl overflow-hidden camstage">
      <div className="relative bg-black" style={{ aspectRatio: engine?.videoBox ? `${engine.videoBox.w} / ${engine.videoBox.h}` : '16 / 9' }}>
        <canvas ref={canvasRef} className={cx('h-full w-full object-contain', !active && 'hidden')} />
        {!active && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/60">
            <Cctv size={30} />
            <div className="text-sm">{canWatch ? 'Pick a camera' : 'Camera engine unavailable'}</div>
          </div>
        )}
        {activeTile && !live && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white/85">
            <Loader2 size={16} className="spin" /> Opening {activeTile.label}…
          </div>
        )}
        <div className="absolute left-3 bottom-3 flex items-center gap-2 rounded-full bg-black/55 px-2.5 h-7 text-[11px] text-white/90 backdrop-blur">
          <span className={cx('h-1.5 w-1.5 rounded-full', live ? 'bg-emerald-400' : ready ? 'bg-amber-300' : engine?.state === 'error' || engine?.state === 'absent' ? 'bg-rose-400' : 'bg-white/50')} />
          {live ? `Live · ${fps} fps` : active ? 'Connecting' : engine ? ENGINE_LABEL[engine.state] : 'Checking'}
          {engineBusy && <Loader2 size={11} className="spin" />}
        </div>
        {active && (
          <IconButton title="Close" onClick={close} className="absolute right-2 top-2 bg-black/55 text-white hover:bg-black/70 hover:text-white">
            <X size={16} />
          </IconButton>
        )}
      </div>

      <div className="flex flex-col border-t sm:border-t-0 sm:border-l border-base p-2 gap-1.5">
        {tiles.map((tile) => {
          const { key, label, cam } = tile;
          const isActive = active === key;
          const motion = !!cam && cam.motionEnabled && cam.motion === true;
          const floodlight = cam?.floodlightLightId;
          const place = cam?.roomName && cam.roomName.toLowerCase() !== label.toLowerCase() ? cam.roomName : null;
          return (
            <div
              key={key}
              role="button"
              tabIndex={0}
              onClick={() => (busy && busy !== key ? undefined : isActive ? close() : watch(tile))}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (isActive ? close() : watch(tile))}
              className={cx(
                'group flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors cursor-pointer outline-none',
                isActive ? 'bg-accent/15 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_45%,transparent)]' : 'hover:bg-black/5 dark:hover:bg-white/5',
                !canWatch && 'opacity-60',
              )}
            >
              <div className={cx('relative h-9 w-9 rounded-xl flex items-center justify-center shrink-0', motion ? 'bg-rose-500/15' : 'surface-2')}>
                {busy === key ? <Loader2 size={16} className="spin text-muted" /> : <Cctv size={16} className={motion ? 'text-rose-400' : isActive ? 'text-accent' : 'text-muted'} />}
                {motion && (
                  <span className="absolute -right-0.5 -top-0.5 h-3 w-3">
                    <span className="absolute inset-0 rounded-full bg-rose-400/60 pulse-ring" />
                    <span className="absolute inset-[2px] rounded-full bg-rose-400" />
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold truncate">{label}</div>
                <div className="text-[11px] text-muted flex items-center gap-2 truncate">
                  {motion && <span className="text-rose-400 font-medium">Motion</span>}
                  {place && <span className="truncate">{place}</span>}
                  {cam && cam.batteryLevel !== null && (
                    <span className="inline-flex items-center gap-1">
                      <BatteryIcon level={cam.batteryLevel} state={cam.batteryState} size={12} />
                      {cam.batteryLevel}%
                    </span>
                  )}
                  {cam && cam.lux !== null && (
                    <span className="inline-flex items-center gap-1">
                      <Sun size={11} /> {cam.lux.toLocaleString()} lx
                    </span>
                  )}
                  {cam?.connectivity && cam.connectivity !== 'connected' && <span className="text-rose-400">{cam.connectivity.replace(/_/g, ' ')}</span>}
                </div>
              </div>
              {floodlight && (
                <button
                  title="Floodlight"
                  onClick={(e) => {
                    e.stopPropagation();
                    openLight(floodlight);
                  }}
                  className="text-muted hover:text-[var(--fg)]"
                >
                  <Lightbulb size={14} />
                </button>
              )}
              {cam?.cameraMotionId && (
                <span title="Motion detection">
                  <Toggle size="sm" checked={cam.motionEnabled} label="Motion detection" onChange={(v) => window.hue.setCameraMotionDetection(cam.cameraMotionId!, v).catch((e) => toast(e.message, 'error'))} />
                </span>
              )}
            </div>
          );
        })}
        <div className="mt-auto pt-1 px-1 flex items-center justify-between gap-2 text-[11px] text-muted min-h-[18px]">
          <span className="truncate">{shownError ? <span className="text-rose-400">{shownError}</span> : ''}</span>
          {engine?.available && (engine.state === 'stopped' || engine.state === 'error') && (
            <button className="inline-flex items-center gap-1 hover:text-[var(--fg)] shrink-0" onClick={() => run('engine', () => window.hue.emulatorEnsureRunning())}>
              <Power size={11} /> Start engine
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
