import { Cctv, Loader2, Power, Video, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Card, cx } from '../components/ui';
import type { EmulatorStatus } from '../../../shared/ipc-types.ts';

/**
 * Decodes a raw Annex-B H.264 byte stream (as `adb screenrecord --output-format=h264` emits it)
 * with WebCodecs and paints every frame on a canvas. Parameter sets arrive in-band, so the decoder
 * is configured from the first SPS/PPS and re-created when the stream restarts.
 */
class H264Canvas {
  private decoder: VideoDecoder | null = null;
  private sps: Uint8Array | null = null;
  private pps: Uint8Array | null = null;
  private pending = new Uint8Array(0);
  private au: Uint8Array[] = [];
  private ts = 0;
  frames = 0;
  width = 0;
  height = 0;
  /** Source rectangle (emulator pixels) to show; null = the whole screen. */
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

  destroy() {
    this.reset();
  }

  push(chunk: Uint8Array) {
    const buf = new Uint8Array(this.pending.length + chunk.length);
    buf.set(this.pending, 0);
    buf.set(chunk, this.pending.length);
    // Split on 00 00 01 start codes; keep the trailing (possibly incomplete) NAL for the next chunk.
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
      while (end > starts[k] + 3 && buf[end - 1] === 0) end--; // drop the leading zero of a 4-byte start code
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
      const dec = new VideoDecoder({
        output: (frame) => this.paint(frame),
        error: (e) => this.onError(`Video decoder: ${e.message}`),
      });
      try {
        dec.configure({ codec, optimizeForLatency: true });
      } catch (err) {
        this.onError(`Video decoder configure failed (${codec}): ${(err as Error).message}`);
        return;
      }
      this.decoder = dec;
    }
    if (this.decoder.state !== 'configured') return;
    const parts = key && this.sps && this.pps ? [this.sps, this.pps, ...au] : au;
    const total = parts.reduce((n, p) => n + 4 + p.length, 0);
    const data = new Uint8Array(total);
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
      this.onError(`Video decode: ${(err as Error).message}`);
      this.reset();
    }
    this.ts += 33_333;
  }

  private paint(frame: VideoFrame) {
    const fw = frame.displayWidth;
    const fh = frame.displayHeight;
    // Clamp the crop to the frame; fall back to the whole frame when it does not fit.
    let c = this.crop;
    if (c && (c.x < 0 || c.y < 0 || c.x + c.w > fw || c.y + c.h > fh || c.w < 16 || c.h < 16)) c = null;
    const w = c ? c.w : fw;
    const h = c ? c.h : fh;
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.width = w;
      this.height = h;
    }
    const ctx = this.canvas.getContext('2d');
    if (ctx) {
      if (c) ctx.drawImage(frame, c.x, c.y, c.w, c.h, 0, 0, w, h);
      else ctx.drawImage(frame, 0, 0, w, h);
    }
    frame.close();
    this.frames++;
    this.onFrame();
  }
}

const STATE_LABEL: Record<EmulatorStatus['state'], string> = {
  absent: 'Android SDK not found',
  stopped: 'Camera engine off',
  starting: 'Starting the camera engine…',
  booting: 'Booting Android…',
  preparing: 'Preparing the Hue app…',
  ready: 'Camera engine ready',
  error: 'Camera engine problem',
};

/**
 * Live view on this PC: the official Philips Hue app runs in a hidden Android emulator on this
 * computer and its screen is streamed into this card. One click per camera; nothing to install,
 * plug in or mirror. See main/hue-emulator.ts for why this is the route that works.
 */
export function EmulatorLiveViewCard({ cameras }: { cameras: { id: string; name: string }[] }) {
  const [status, setStatus] = useState<EmulatorStatus | null>(null);
  const [cloudNames, setCloudNames] = useState<string[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [live, setLive] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const decoderRef = useRef<H264Canvas | null>(null);
  const frameCountRef = useRef(0);

  useEffect(() => {
    let alive = true;
    window.hue.getEmulatorStatus().then((s) => alive && setStatus(s)).catch(() => undefined);
    window.hue
      .getCloudStatus()
      .then((c) => alive && setCloudNames(c.cameras.map((x) => x.name)))
      .catch(() => undefined);
    const off = window.hue.onEmulatorStatus((s) => alive && setStatus(s));
    const offCloud = window.hue.onCloudStatus((c) => alive && setCloudNames(c.cameras.map((x) => x.name)));
    return () => {
      alive = false;
      off();
      offCloud();
    };
  }, []);

  // Frame pump: decode chunks while a camera is open.
  useEffect(() => {
    if (!active || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const dec = new H264Canvas(
      canvas,
      () => {
        frameCountRef.current += 1;
        if (!live) setLive(true);
      },
      (m) => setError(m),
    );
    decoderRef.current = dec;
    dec.crop = status?.videoBox ?? null;
    const off = window.hue.onEmulatorFrame((frame) => {
      if (frame instanceof Uint8Array) dec.push(frame);
      else if (frame && typeof frame === 'object' && 'restart' in frame) dec.reset();
    });
    const fpsTimer = setInterval(() => {
      setFps(frameCountRef.current);
      frameCountRef.current = 0;
    }, 1000);
    return () => {
      off();
      clearInterval(fpsTimer);
      dec.destroy();
      decoderRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Keep the crop in step with where the Hue app placed the video.
  useEffect(() => {
    if (decoderRef.current) decoderRef.current.crop = status?.videoBox ?? null;
  }, [status?.videoBox]);

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

  const watch = (name: string) =>
    run(name, async () => {
      // Switching from another camera: stop its stream first so the decoder restarts cleanly.
      if (active && active !== name) {
        await window.hue.emulatorStopStream();
        setActive(null);
      }
      setLive(false);
      setActive(name);
      const s = await window.hue.emulatorOpenCamera(name);
      if (s.state !== 'ready' || s.error) {
        setActive(null);
        throw new Error(s.error ?? STATE_LABEL[s.state]);
      }
      await window.hue.emulatorStartStream();
    });

  const close = () =>
    run('close', async () => {
      await window.hue.emulatorStopStream();
      await window.hue.emulatorCloseCamera();
      setActive(null);
      setLive(false);
    });

  // Stop streaming when the card unmounts (navigating away).
  useEffect(() => {
    return () => {
      window.hue.emulatorStopStream().catch(() => undefined);
      window.hue.emulatorCloseCamera().catch(() => undefined);
    };
  }, []);

  // Prefer the names the Hue app itself uses (from the Hue account); the bridge names differ.
  const names = cloudNames.length ? cloudNames : cameras.map((c) => c.name);
  const engineBusy = status ? ['starting', 'booting', 'preparing'].includes(status.state) : false;
  const ready = status?.state === 'ready';

  return (
    <Card className="mt-4">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 shrink-0 rounded-xl surface-2 flex items-center justify-center">
          <Cctv size={20} className="text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium flex items-center gap-2">
            Live view
            {live && <span className="text-xs font-normal text-emerald-400">● live · {fps} fps</span>}
          </div>
          <div className="text-sm text-muted mt-0.5">
            Your cameras' live feed on this PC. Hue Pilot runs the official Philips Hue app in a hidden Android engine on this computer and shows its picture here: no phone, nothing to plug in.
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span className={cx('inline-block h-2 w-2 rounded-full', ready ? 'bg-emerald-400' : status?.state === 'error' || status?.state === 'absent' ? 'bg-rose-400' : engineBusy ? 'bg-amber-400' : 'bg-zinc-500')} />
        <span className="text-muted">{status ? STATE_LABEL[status.state] : 'Checking the camera engine…'}</span>
        {engineBusy && <Loader2 size={14} className="spin text-muted" />}
        <span className="ml-auto" />
        {status && (status.state === 'stopped' || status.state === 'error') && (
          <Button variant="subtle" size="sm" icon={<Power size={14} />} loading={busy === 'engine'} onClick={() => run('engine', () => window.hue.emulatorEnsureRunning())}>
            Start camera engine
          </Button>
        )}
        {ready && !active && (
          <Button variant="ghost" size="sm" icon={<Power size={14} />} loading={busy === 'stop'} onClick={() => run('stop', () => window.hue.emulatorStop())}>
            Stop engine
          </Button>
        )}
      </div>
      {status?.state === 'starting' && <div className="mt-1 text-xs text-muted">First start after a reboot takes about a minute; after that it stays ready in the background.</div>}

      <div className="mt-3 flex flex-wrap gap-2">
        {names.length ? (
          names.map((n) => (
            <Button key={n} variant={active === n ? 'primary' : 'outline'} icon={<Video size={14} />} loading={busy === n} disabled={!!busy && busy !== n} onClick={() => (active === n ? close() : watch(n))}>
              {n}
            </Button>
          ))
        ) : (
          <span className="text-xs text-muted">No cameras found yet.</span>
        )}
      </div>

      {(error || status?.error) && (
        <div className="mt-3 text-sm rounded-xl px-3 py-2 bg-rose-500/10 text-rose-400">{error ?? status?.error}</div>
      )}

      {active && (
        <div className="mt-3 rounded-xl overflow-hidden border border-base bg-black">
          <div className="relative" style={{ aspectRatio: status?.videoBox ? `${status.videoBox.w} / ${status.videoBox.h}` : '16 / 9' }}>
            <canvas ref={canvasRef} className="h-full w-full object-contain" />
            {!live && (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80 p-6 text-center">
                <Loader2 size={16} className="spin mr-2" /> Opening {active}…
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 px-3 py-2 text-xs text-muted surface-2">
            <span className={cx('inline-block h-2 w-2 rounded-full', live ? 'bg-emerald-400' : 'bg-amber-400')} />
            <span>{active}</span>
            {live && <span>· {fps} fps</span>}
            <span className="ml-auto" />
            <Button size="sm" variant="ghost" icon={<X size={14} />} loading={busy === 'close'} onClick={close}>
              Close
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
