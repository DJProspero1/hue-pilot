import type { LightView } from '@hue/core';
import { Zap } from 'lucide-react';
import { lightIcon } from '../lib/icons';
import { useApp } from '../store';
import { cx, Slider, Swatch, Toggle, useThrottle } from './ui';

/** One light: icon, name, brightness pill, colour dot, power. Click opens the light sheet. */
export default function LightRow({ light, showRoom, className }: { light: LightView; showRoom?: boolean; className?: string }) {
  const setLight = useApp((s) => s.setLight);
  const openLight = useApp((s) => s.openLight);
  const throttled = useThrottle((v: number) => setLight(light.id, { brightness: v, on: true }), 120);
  const Icon = lightIcon(light.archetype);
  const unreachable = light.connectivity && light.connectivity !== 'connected';
  return (
    <div onClick={() => openLight(light.id)} className={cx('flex items-center gap-3 rounded-xl px-3 py-2 cursor-pointer transition-colors hover:brightness-110', className ?? 'surface')}>
      <div className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: light.on ? `${light.hex}2e` : 'var(--bg-elev-2)' }}>
        <Icon size={18} style={{ color: light.on ? light.hex : 'var(--fg-muted)' }} />
      </div>
      <div className="min-w-0 w-[170px]">
        <div className="text-sm font-medium truncate">{light.name}</div>
        <div className="text-[11px] text-muted truncate">
          {showRoom && light.roomName ? `${light.roomName} · ` : ''}
          {unreachable ? <span className="text-rose-400">unreachable</span> : light.on ? `${Math.round(light.brightness)}%${light.colorMode === 'ct' && light.kelvin ? ` · ${light.kelvin}K` : ''}` : 'Off'}
          {light.effect && light.effect !== 'no_effect' && (
            <span className="ml-1 inline-flex items-center gap-0.5 text-accent">
              <Zap size={10} /> {light.effect}
            </span>
          )}
        </div>
      </div>
      <div className="flex-1 min-w-[100px]">
        <Slider value={light.on ? Math.round(light.brightness) : 0} min={1} max={100} disabled={!light.supportsDimming} onChange={throttled} onCommit={(v) => setLight(light.id, { brightness: v, on: true })} label={`${light.name} brightness`} />
      </div>
      <Swatch hex={light.hex} on={light.on} size={14} />
      <Toggle checked={light.on} onChange={(v) => setLight(light.id, { on: v })} size="sm" label={`${light.name} power`} />
    </div>
  );
}
