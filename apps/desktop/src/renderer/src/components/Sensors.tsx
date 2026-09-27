import type { AccessoryView } from '@hue/core';
import { Battery, BatteryLow, BatteryWarning, Cctv, DoorClosed, DoorOpen, Radar, ToggleLeft } from 'lucide-react';
import { useApp } from '../store';
import { cx, Toggle } from './ui';

export function ago(iso?: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return '';
  const m = Math.round(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

export function clock(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return sameDay ? time : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`;
}

export function BatteryIcon({ level, state, size = 13 }: { level?: number | null; state?: string | null; size?: number }) {
  if (level === null || level === undefined) return null;
  if (state === 'critical' || level < 15) return <BatteryWarning size={size} className="text-rose-400" />;
  if (state === 'low' || level < 30) return <BatteryLow size={size} className="text-amber-400" />;
  return <Battery size={size} className="text-emerald-400" />;
}

function SensorRow({ a }: { a: AccessoryView }) {
  const toast = useApp((s) => s.toast);
  const motionActive = !!a.motion?.active;
  const Icon = a.kind === 'switch' ? ToggleLeft : a.kind === 'contact' ? (a.contact?.state === 'no_contact' ? DoorOpen : DoorClosed) : Radar;
  const readings: string[] = [];
  if (a.motion) readings.push(motionActive ? 'Motion' : `Clear${a.motion.changed ? ` · ${ago(a.motion.changed)}` : ''}`);
  if (a.temperature?.celsius !== undefined) readings.push(`${a.temperature.celsius.toFixed(1)} °C`);
  if (a.lightLevel?.lux !== undefined) readings.push(`${a.lightLevel.lux.toLocaleString()} lx`);
  if (a.contact) readings.push(a.contact.state === 'no_contact' ? 'Open' : a.contact.state === 'contact' ? 'Closed' : '');
  if (a.buttons.length) {
    const last = [...a.buttons].filter((b) => b.updated).sort((x, y) => (y.updated ?? '').localeCompare(x.updated ?? ''))[0];
    readings.push(last?.lastEvent ? `${last.lastEvent.replace(/_/g, ' ')} · ${ago(last.updated)}` : 'No presses yet');
  }
  const offline = a.connectivity && a.connectivity !== 'connected';
  return (
    <div className={cx('surface flex items-center gap-3 rounded-xl px-3 py-2', motionActive && 'border-rose-500/40')}>
      <div className={cx('h-8 w-8 rounded-lg flex items-center justify-center shrink-0', motionActive ? 'bg-rose-500/15' : 'surface-2')}>
        <Icon size={15} className={motionActive ? 'text-rose-400' : 'text-muted'} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{a.name}</div>
        <div className="text-[11px] text-muted truncate">
          {offline ? <span className="text-rose-400">{a.connectivity!.replace(/_/g, ' ')}</span> : readings.filter(Boolean).join(' · ')}
        </div>
      </div>
      {a.battery && (
        <span className="inline-flex items-center gap-1 text-[11px] text-muted" title="Battery">
          <BatteryIcon level={a.battery.level} state={a.battery.state} />
          {a.battery.level !== undefined && `${a.battery.level}%`}
        </span>
      )}
      {a.motion && (
        <Toggle
          size="sm"
          checked={a.motion.enabled}
          label="Motion sensing"
          onChange={(v) => window.hue.setSensorEnabled('motion', a.motion!.sensorId, v).catch((e) => toast(e.message, 'error'))}
        />
      )}
    </div>
  );
}

/** Motion sensors, switches and contact sensors, one compact row each. */
export default function Sensors() {
  const accessories = useApp((s) => s.home.accessories);
  const list = accessories.filter((a) => a.kind !== 'bridge');
  if (!list.length) return null;
  return (
    <div className="space-y-1.5">
      {list.map((a) => (
        <SensorRow key={a.deviceId} a={a} />
      ))}
    </div>
  );
}

/** The last motion events from cameras and sensors, newest first. */
export function RecentMotion({ limit = 8 }: { limit?: number }) {
  const events = useApp((s) => s.motionEvents);
  if (!events.length) return <div className="text-xs text-muted px-1">Nothing yet.</div>;
  return (
    <ul className="surface rounded-xl px-1 py-1">
      {[...events].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit).map((e) => {
        const Icon = e.kind === 'camera' ? Cctv : Radar;
        return (
          <li key={e.id} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
            <Icon size={14} className={e.motion ? 'text-rose-400' : 'text-muted'} />
            <span className="text-sm truncate flex-1">{e.sourceName}</span>
            <span className="text-[11px] text-muted tabular-nums shrink-0">{clock(e.at)}</span>
          </li>
        );
      })}
    </ul>
  );
}
