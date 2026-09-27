import type { CameraView, LightView } from '@hue/core';
import { Battery, BatteryLow, BatteryWarning, Cctv, ChevronRight, Info, Radar, Sun, Wifi, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Card, cx, EmptyState, Slider, Toggle, useThrottle } from '../components/ui';
import { lightIcon } from '../lib/icons';
import { useApp } from '../store';
import { CloudLiveViewCard } from './CloudLiveView';
import { EmulatorLiveViewCard } from './EmulatorLiveView';
import type { MotionEvent } from '../../../shared/ipc-types.ts';

function ago(iso?: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return '';
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

function clock(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay ? time : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
}

function BatteryIcon({ level, state }: { level: number; state: string | null }) {
  if (state === 'critical' || level < 10) return <BatteryWarning size={14} className="text-rose-400" />;
  if (state === 'low' || level < 20) return <BatteryLow size={14} className="text-amber-400" />;
  return <Battery size={14} className="text-emerald-400" />;
}

function InfoChip({ icon, children, tone, title }: { icon: React.ReactNode; children: React.ReactNode; tone?: 'rose' | 'amber'; title?: string }) {
  return (
    <span
      title={title}
      className={cx(
        'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium whitespace-nowrap',
        tone === 'rose' ? 'border-rose-500/40 bg-rose-500/10 text-rose-400' : tone === 'amber' ? 'border-amber-500/40 bg-amber-500/10 text-amber-500' : 'border-[var(--border)] surface-2',
      )}
    >
      {icon}
      {children}
    </span>
  );
}

function FloodlightRow({ light }: { light: LightView }) {
  const setLight = useApp((s) => s.setLight);
  const openLight = useApp((s) => s.openLight);
  const throttled = useThrottle((v: number) => setLight(light.id, { brightness: v, on: true }), 120);
  const Icon = lightIcon(light.archetype);
  const unreachable = light.connectivity && light.connectivity !== 'connected';
  return (
    <div className="flex items-center gap-3 pt-3 mt-3 border-t border-base">
      <div className="w-[120px] shrink-0">
        <div className="text-sm font-medium">Floodlight</div>
        <div className="text-[11px] text-muted truncate" title={light.name}>
          {unreachable ? <span className="text-rose-400">unreachable</span> : light.on ? `On · ${Math.round(light.brightness)}%` : 'Off'}
        </div>
      </div>
      <button
        type="button"
        onClick={() => openLight(light.id)}
        title={`Open ${light.name}`}
        className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0 transition-colors hover:brightness-110"
        style={{ background: light.on ? `${light.hex}2e` : 'var(--bg-elev-2)' }}
      >
        <Icon size={18} style={{ color: light.on ? light.hex : 'var(--fg-muted)' }} />
      </button>
      <div className="flex-1 min-w-[120px]">
        <Slider value={light.on ? Math.round(light.brightness) : 0} min={1} max={100} disabled={!light.supportsDimming} onChange={throttled} onCommit={(v) => setLight(light.id, { brightness: v, on: true })} label="Floodlight brightness" />
      </div>
      <Toggle checked={light.on} onChange={(v) => setLight(light.id, { on: v })} size="sm" label="Floodlight power" />
      <button type="button" onClick={() => openLight(light.id)} className="text-muted hover:text-[var(--fg)]" title="Colour and effects">
        <ChevronRight size={16} />
      </button>
    </div>
  );
}

function CameraCard({ camera }: { camera: CameraView }) {
  const home = useApp((s) => s.home);
  const toast = useApp((s) => s.toast);
  const [pendingEnabled, setPendingEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    if (pendingEnabled === null) return;
    if (camera.motionEnabled === pendingEnabled) {
      setPendingEnabled(null);
      return;
    }
    const t = setTimeout(() => setPendingEnabled(null), 2500);
    return () => clearTimeout(t);
  }, [pendingEnabled, camera.motionEnabled]);

  const motionEnabled = pendingEnabled ?? camera.motionEnabled;
  const motionNow = motionEnabled && camera.motion === true;
  const floodlight = camera.floodlightLightId ? home.lightById[camera.floodlightLightId] : undefined;
  const offline = camera.connectivity && camera.connectivity !== 'connected';
  const lowBattery = camera.batteryLevel !== null && (camera.batteryLevel < 20 || camera.batteryState === 'low' || camera.batteryState === 'critical');

  const toggleMotion = async (enabled: boolean) => {
    if (!camera.cameraMotionId) return;
    setPendingEnabled(enabled);
    try {
      await window.hue.setCameraMotionDetection(camera.cameraMotionId, enabled);
    } catch (err) {
      setPendingEnabled(null);
      toast((err as Error).message, 'error');
    }
  };

  const statusLine = !motionEnabled
    ? 'Motion detection off'
    : camera.motion === null
      ? 'No motion reading yet'
      : motionNow
        ? `Motion detected · ${ago(camera.motionChanged) || 'now'}`
        : `Clear${camera.motionChanged ? ` · last motion ${clock(camera.motionChanged)}` : ''}`;

  return (
    <Card glow={motionNow ? 'rgba(251, 113, 133, 0.55)' : undefined} className={cx(motionNow && 'border-rose-500/40')}>
      <div className="flex items-start gap-4">
        <div className={cx('relative h-14 w-14 rounded-2xl flex items-center justify-center shrink-0 transition-colors', motionNow ? 'bg-rose-500/20' : 'surface-2')}>
          <Cctv size={26} className={motionNow ? 'text-rose-400' : 'text-muted'} />
          {motionNow && (
            <span className="absolute -right-0.5 -top-0.5 h-3.5 w-3.5">
              <span className="absolute inset-0 rounded-full bg-rose-400/60 pulse-ring" />
              <span className="absolute inset-[3px] rounded-full bg-rose-400 shadow-[0_0_8px_#fb7185]" />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold truncate">{camera.name}</h3>
            <span className="rounded-md surface-2 px-1.5 text-[10px] uppercase tracking-wide text-muted shrink-0">{camera.kind === 'battery' ? 'battery' : camera.kind === 'floodlight' ? 'floodlight' : 'camera'}</span>
          </div>
          <div className="text-xs text-muted truncate">
            {camera.productName || 'Hue Secure camera'}
            {camera.modelId ? ` · ${camera.modelId}` : ''}
            {camera.softwareVersion ? ` · v${camera.softwareVersion}` : ''}
            {camera.roomName ? ` · ${camera.roomName}` : ''}
          </div>
          <div className={cx('mt-1.5 flex items-center gap-2 text-sm', motionNow ? 'text-rose-400 font-medium' : !motionEnabled ? 'text-muted' : '')}>
            <span className={cx('h-2.5 w-2.5 rounded-full shrink-0', motionNow ? 'bg-rose-400 shadow-[0_0_10px_#fb7185]' : motionEnabled ? 'bg-emerald-400' : 'bg-slate-400')} />
            <span className="truncate">{statusLine}</span>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-1.5 max-w-[240px]">
          {camera.lux !== null && (
            <InfoChip icon={<Sun size={13} className="text-amber-400" />} title={camera.lightLevelChanged ? `Ambient light · ${ago(camera.lightLevelChanged)}` : 'Ambient light'}>
              {camera.lux.toLocaleString()} lux
            </InfoChip>
          )}
          {camera.batteryLevel !== null && (
            <InfoChip icon={<BatteryIcon level={camera.batteryLevel} state={camera.batteryState} />} tone={lowBattery ? 'rose' : undefined} title={`Battery ${camera.batteryState ?? ''}`.trim()}>
              {camera.batteryLevel}%
            </InfoChip>
          )}
          <InfoChip icon={offline ? <WifiOff size={13} /> : <Wifi size={13} className="text-emerald-400" />} tone={offline ? 'rose' : undefined} title="Zigbee connectivity">
            {offline ? camera.connectivity!.replace(/_/g, ' ') : 'connected'}
          </InfoChip>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3 pt-3 border-t border-base">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Motion detection</div>
          <div className="text-[11px] text-muted">{camera.cameraMotionId ? 'Report movement to the bridge and to Hue automations.' : 'This camera has no motion service on the bridge.'}</div>
        </div>
        <Toggle checked={motionEnabled} disabled={!camera.cameraMotionId} onChange={toggleMotion} label={`${camera.name} motion detection`} />
      </div>

      {floodlight && <FloodlightRow light={floodlight} />}
    </Card>
  );
}

function MotionTimeline({ events }: { events: MotionEvent[] }) {
  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-4 pt-3 pb-2 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wider text-muted">Recent motion</div>
        {events.length > 0 && <span className="text-[10px] text-muted">{events.length} event{events.length === 1 ? '' : 's'}</span>}
      </div>
      {events.length ? (
        <ul className="scroll max-h-[calc(100vh-260px)] px-2 pb-2">
          {events.map((e) => {
            const Icon = e.kind === 'camera' ? Cctv : Radar;
            return (
              <li key={e.id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-black/5 dark:hover:bg-white/5">
                <div className={cx('h-8 w-8 rounded-xl flex items-center justify-center shrink-0', e.motion ? 'bg-rose-500/15' : 'surface-2')}>
                  <Icon size={15} className={e.motion ? 'text-rose-400' : 'text-muted'} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm truncate">{e.sourceName}</div>
                  <div className="text-[11px] text-muted truncate">{e.motion ? 'Motion detected' : 'No motion'} · {clock(e.at)}</div>
                </div>
                <div className="text-[11px] text-muted tabular-nums shrink-0">{ago(e.at)}</div>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="px-4 pb-5 pt-2 text-center text-sm text-muted">
          <Radar size={28} className="mx-auto mb-2 opacity-60" />
          Motion events appear here while Hue Pilot is open.
        </div>
      )}
    </Card>
  );
}

function VideoNote() {
  return (
    <Card className="flex items-start gap-3 border-amber-500/30 bg-amber-500/5">
      <Info size={18} className="text-amber-500 shrink-0 mt-0.5" />
      <div className="text-sm">
        <div className="font-medium">Live video never reaches the bridge, so it can't be decoded here.</div>
        <div className="text-muted mt-0.5">
          Hue Secure cameras stream only to Signify's cloud, end-to-end encrypted, and expose no local stream (a full port scan of both cameras on this network found nothing open). Hue Pilot shows what the bridge does expose: motion, ambient light, battery, connectivity and firmware. The live picture is in the Live view card below.
        </div>
      </div>
    </Card>
  );
}

export default function CamerasView() {
  const home = useApp((s) => s.home);
  const status = useApp((s) => s.status);
  const events = useApp((s) => s.motionEvents);
  const cameras = home.cameras;
  const motionCount = cameras.filter((c) => c.motionEnabled && c.motion === true).length;

  return (
    <div className="fade-in">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Cameras</h1>
        <p className="text-sm text-muted mt-0.5">
          {cameras.length ? `${cameras.length} Hue Secure camera${cameras.length === 1 ? '' : 's'} · ${motionCount ? `motion at ${motionCount}` : 'no motion right now'}` : 'Hue Secure cameras paired with the bridge.'} · readings update live
        </p>
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
        <div className="min-w-0">
          {cameras.length ? (
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(420px, 1fr))' }}>
              {cameras.map((c) => (
                <CameraCard key={c.id} camera={c} />
              ))}
            </div>
          ) : (
            <Card>
              <EmptyState
                icon={<Cctv size={40} />}
                title={status.state === 'connected' ? 'No cameras' : 'Bridge not connected'}
                hint={status.state === 'connected' ? 'Hue Secure cameras added to this bridge in the Philips Hue app show up here automatically.' : status.error ?? 'Waiting for the Hue bridge.'}
              />
            </Card>
          )}
          <div className="mt-4">
            <VideoNote />
          </div>
          <EmulatorLiveViewCard cameras={cameras.map((c) => ({ id: c.id, name: c.name }))} />
          <CloudLiveViewCard cameras={cameras.map((c) => ({ id: c.id, name: c.name }))} />
        </div>
        <div className="min-w-0">
          <MotionTimeline events={events} />
        </div>
      </div>
    </div>
  );
}
