import type { AccessoryView } from '@hue/core';
import { Battery, BatteryLow, BatteryWarning, Cpu, DoorClosed, Radar, Sun, Thermometer, ToggleLeft } from 'lucide-react';
import { Card, cx, EmptyState, SectionTitle, Toggle } from '../components/ui';
import { useApp } from '../store';

function ago(iso?: string): string {
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

function BatteryIcon({ level, state }: { level?: number; state?: string }) {
  if (state === 'critical' || (level ?? 100) < 15) return <BatteryWarning size={14} className="text-rose-400" />;
  if (state === 'low' || (level ?? 100) < 30) return <BatteryLow size={14} className="text-amber-400" />;
  return <Battery size={14} className="text-emerald-400" />;
}

function AccessoryCard({ a }: { a: AccessoryView }) {
  const toast = useApp((s) => s.toast);
  const setEnabled = async (type: string, id: string, enabled: boolean) => {
    try {
      await window.hue.setSensorEnabled(type, id, enabled);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  const Icon = a.kind === 'bridge' ? Cpu : a.kind === 'switch' ? ToggleLeft : a.kind === 'contact' ? DoorClosed : Radar;
  const motionActive = a.motion?.active;
  return (
    <Card glow={motionActive ? 'rgba(52, 211, 153, 0.5)' : undefined}>
      <div className="flex items-start gap-3">
        <div className={cx('h-11 w-11 rounded-2xl flex items-center justify-center shrink-0', motionActive ? 'bg-emerald-500/20' : 'surface-2')}>
          <Icon size={22} className={motionActive ? 'text-emerald-400' : 'text-muted'} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold truncate">{a.name}</div>
          <div className="text-xs text-muted truncate">{a.productName || a.modelId}{a.softwareVersion ? ` · v${a.softwareVersion}` : ''}</div>
        </div>
        {a.battery && (
          <div className="flex items-center gap-1 text-xs text-muted" title={`Battery ${a.battery.state ?? ''}`}>
            <BatteryIcon level={a.battery.level} state={a.battery.state} />
            {a.battery.level !== undefined && <span>{a.battery.level}%</span>}
          </div>
        )}
      </div>
      {a.connectivity && a.connectivity !== 'connected' && <div className="mt-2 text-xs text-rose-400">{a.connectivity.replace(/_/g, ' ')}</div>}
      <div className="mt-3 space-y-2 text-sm">
        {a.motion && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className={cx('h-2.5 w-2.5 rounded-full', motionActive ? 'bg-emerald-400 shadow-[0_0_10px_#34d399]' : 'bg-slate-400')} />
              <span>{motionActive ? 'Motion detected' : 'No motion'}</span>
              <span className="text-xs text-muted">{ago(a.motion.changed)}</span>
            </div>
            <Toggle size="sm" checked={a.motion.enabled} onChange={(v) => setEnabled('motion', a.motion!.sensorId, v)} label="Motion sensing" />
          </div>
        )}
        {a.temperature && a.temperature.celsius !== undefined && (
          <div className="flex items-center gap-2">
            <Thermometer size={15} className="text-muted" />
            <span>{a.temperature.celsius.toFixed(1)} °C</span>
            <span className="text-xs text-muted">{ago(a.temperature.changed)}</span>
          </div>
        )}
        {a.lightLevel && a.lightLevel.lux !== undefined && (
          <div className="flex items-center gap-2">
            <Sun size={15} className="text-muted" />
            <span>{a.lightLevel.lux.toLocaleString()} lux</span>
            <span className="text-xs text-muted">{ago(a.lightLevel.changed)}</span>
          </div>
        )}
        {a.contact && (
          <div className="flex items-center gap-2">
            <DoorClosed size={15} className="text-muted" />
            <span>{a.contact.state === 'no_contact' ? 'Open' : a.contact.state === 'contact' ? 'Closed' : 'Unknown'}</span>
            <span className="text-xs text-muted">{ago(a.contact.changed)}</span>
          </div>
        )}
        {a.buttons.length > 0 && (
          <div className="grid grid-cols-2 gap-1.5 pt-1">
            {a.buttons.map((b) => (
              <div key={b.id} className="surface-2 rounded-lg px-2.5 py-1.5 text-xs">
                <div className="text-muted">Button {b.controlId}</div>
                <div className="truncate">{b.lastEvent ? b.lastEvent.replace(/_/g, ' ') : '—'} <span className="text-muted">{ago(b.updated)}</span></div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}

export default function AccessoriesView() {
  const home = useApp((s) => s.home);
  const sensors = home.accessories.filter((a) => a.kind !== 'bridge');
  const bridge = home.bridge;
  return (
    <div className="fade-in">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Accessories</h1>
        <p className="text-sm text-muted mt-0.5">Sensors, switches and the bridge. Readings update live.</p>
      </div>
      {bridge && (
        <>
          <SectionTitle>Bridge</SectionTitle>
          <Card className="mb-6 flex items-center gap-3">
            <div className="h-11 w-11 rounded-2xl surface-2 flex items-center justify-center"><Cpu size={22} className="text-accent" /></div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{bridge.name}</div>
              <div className="text-xs text-muted">{bridge.modelId ?? 'Hue Bridge'}{bridge.softwareVersion ? ` · firmware ${bridge.softwareVersion}` : ''} · id {bridge.bridgeId}{bridge.timeZone ? ` · ${bridge.timeZone}` : ''}</div>
            </div>
          </Card>
        </>
      )}
      <SectionTitle>Sensors & switches</SectionTitle>
      {sensors.length ? (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
          {sensors.map((a) => (
            <AccessoryCard key={a.deviceId} a={a} />
          ))}
        </div>
      ) : (
        <EmptyState icon={<Radar size={40} />} title="No accessories" hint="Motion sensors, dimmer switches and buttons paired with the bridge show up here." />
      )}
    </div>
  );
}
