import { COLOR_NAMES, hexToRgb, kelvinToMirek, mirekToHex, mirekToKelvin, rgbToXy, type Gamut, type LightState, type LightView, type XY } from '@hue/core';
import { Check, Flame, Info, Palette, Pencil, Sparkles, Sun, X, Zap } from 'lucide-react';
import { useEffect, useState } from 'react';
import { lightIcon, archetypeLabel } from '../lib/icons';
import { useApp } from '../store';
import ColorWheel from './ColorWheel';
import { Button, Chip, cx, IconButton, Slider, Swatch, Toggle, useThrottle } from './ui';

export const WHITE_CHIPS: { label: string; kelvin: number }[] = [
  { label: 'Candle', kelvin: 2000 },
  { label: 'Relax', kelvin: 2237 },
  { label: 'Warm', kelvin: 2700 },
  { label: 'Read', kelvin: 3000 },
  { label: 'Neutral', kelvin: 3500 },
  { label: 'Cool', kelvin: 4000 },
  { label: 'Energize', kelvin: 6000 },
  { label: 'Daylight', kelvin: 6500 },
];

export const COLOR_CHIPS = ['red', 'orange', 'amber', 'yellow', 'lime', 'green', 'teal', 'cyan', 'sky blue', 'blue', 'indigo', 'purple', 'magenta', 'pink', 'coral'] as const;

export function PresetRow({ supportsColor, supportsCt, gamut, onPick, compact }: { supportsColor: boolean; supportsCt: boolean; gamut?: Gamut; onPick: (state: LightState) => void; compact?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {(supportsCt || supportsColor) &&
        WHITE_CHIPS.filter((_, i) => !compact || i % 2 === 0 || i === WHITE_CHIPS.length - 1).map((w) => {
          const mirek = kelvinToMirek(w.kelvin);
          const hex = mirekToHex(mirek);
          return (
            <button
              key={w.label}
              title={`${w.label} · ${w.kelvin}K`}
              onClick={(e) => {
                e.stopPropagation();
                onPick(supportsCt ? { on: true, mirek } : { on: true, xy: rgbToXy(hexToRgb(hex)!, gamut) });
              }}
              className="h-7 rounded-full px-2.5 text-[11px] font-medium border border-black/10 hover:scale-105 transition-transform"
              style={{ background: hex, color: '#1f2937' }}
            >
              {w.label}
            </button>
          );
        })}
      {supportsColor &&
        COLOR_CHIPS.filter((_, i) => !compact || i % 2 === 0).map((name) => {
          const hex = COLOR_NAMES[name];
          return (
            <button
              key={name}
              title={name}
              onClick={(e) => {
                e.stopPropagation();
                onPick({ on: true, xy: rgbToXy(hexToRgb(hex)!, gamut) });
              }}
              className="h-7 w-7 rounded-full border border-black/10 hover:scale-110 transition-transform"
              style={{ background: hex, boxShadow: `0 0 10px ${hex}66` }}
            />
          );
        })}
    </div>
  );
}

export function CtSlider({ light, onChange, onCommit }: { light: LightView; onChange: (mirek: number) => void; onCommit?: (mirek: number) => void }) {
  const kMin = mirekToKelvin(light.mirekMax);
  const kMax = mirekToKelvin(light.mirekMin);
  const value = light.kelvin ?? 2700;
  const track = `linear-gradient(90deg, ${mirekToHex(light.mirekMax)}, ${mirekToHex(Math.round((light.mirekMax + light.mirekMin) / 2))}, ${mirekToHex(light.mirekMin)})`;
  return (
    <div>
      <Slider value={value} min={kMin} max={kMax} step={50} track={track} thick onChange={(k) => onChange(kelvinToMirek(k))} onCommit={(k) => onCommit?.(kelvinToMirek(k))} label="Colour temperature" />
      <div className="flex justify-between text-[11px] text-muted mt-1">
        <span>Warm · {kMin}K</span>
        <span className="font-medium text-[var(--fg)]">{value}K</span>
        <span>Cool · {kMax}K</span>
      </div>
    </div>
  );
}

const EFFECT_ICONS: Record<string, typeof Flame> = { candle: Flame, fire: Flame, prism: Sparkles, sparkle: Sparkles, opal: Sun, glisten: Sparkles, underwater: Palette, cosmos: Sparkles, sunbeam: Sun, enchant: Sparkles };

export default function LightSheet() {
  const id = useApp((s) => s.lightSheet);
  const light = useApp((s) => (id ? s.home.lightById[id] : undefined));
  const openLight = useApp((s) => s.openLight);
  const setLight = useApp((s) => s.setLight);
  const toast = useApp((s) => s.toast);
  const [tab, setTab] = useState<'color' | 'white' | 'effects'>('color');
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [wheelHex, setWheelHex] = useState<string | null>(null);

  useEffect(() => {
    if (!light) return;
    setName(light.name);
    setRenaming(false);
    setWheelHex(null);
    setTab(light.supportsColor ? (light.colorMode === 'ct' && light.supportsColorTemperature ? 'white' : 'color') : light.supportsColorTemperature ? 'white' : 'effects');
  }, [light?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && openLight(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openLight]);

  const throttledLight = useThrottle((state: LightState) => light && setLight(light.id, state), 110);
  const throttledXy = useThrottle((xy: XY) => light && setLight(light.id, { on: true, xy }), 140);

  if (!id || !light) return null;
  const Icon = lightIcon(light.archetype);
  const tabs = [
    light.supportsColor && { key: 'color' as const, label: 'Colour', icon: Palette },
    light.supportsColorTemperature && { key: 'white' as const, label: 'White', icon: Sun },
    light.effects.length > 1 && { key: 'effects' as const, label: 'Effects', icon: Zap },
  ].filter(Boolean) as { key: 'color' | 'white' | 'effects'; label: string; icon: typeof Sun }[];

  const submitRename = async () => {
    if (name.trim() && name.trim() !== light.name) {
      try {
        await window.hue.rename('light', light.id, name.trim());
        toast('Light renamed', 'success');
      } catch (err) {
        toast((err as Error).message, 'error');
      }
    }
    setRenaming(false);
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end" onMouseDown={() => openLight(null)}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px] fade-in" />
      <div className="relative h-full w-[420px] surface border-l shadow-soft slide-in-right flex flex-col" onMouseDown={(e) => e.stopPropagation()} style={{ borderRadius: 0 }}>
        <div className="flex items-start gap-3 px-5 pt-[52px] pb-3 border-b border-base">
          <div className="h-11 w-11 rounded-2xl flex items-center justify-center shrink-0" style={{ background: light.on ? `${light.hex}33` : 'var(--bg-elev-2)', boxShadow: light.on ? `0 0 24px -4px ${light.hex}` : 'none' }}>
            <Icon size={22} style={{ color: light.on ? light.hex : 'var(--fg-muted)' }} />
          </div>
          <div className="min-w-0 flex-1">
            {renaming ? (
              <div className="flex items-center gap-1">
                <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => (e.key === 'Enter' ? submitRename() : e.key === 'Escape' ? setRenaming(false) : null)} maxLength={32} className="h-8 flex-1 rounded-lg surface px-2 text-sm outline-none focus:border-accent/60" />
                <IconButton title="Save" onClick={submitRename}>
                  <Check size={16} />
                </IconButton>
              </div>
            ) : (
              <div className="flex items-center gap-1">
                <h2 className="text-lg font-semibold truncate">{light.name}</h2>
                <IconButton title="Rename" className="h-7 w-7" onClick={() => setRenaming(true)}>
                  <Pencil size={13} />
                </IconButton>
              </div>
            )}
            <div className="text-xs text-muted truncate">
              {light.roomName ?? 'No room'} · {light.productName ?? archetypeLabel(light.archetype)}
              {light.connectivity && light.connectivity !== 'connected' && <span className="ml-2 text-rose-400">· {light.connectivity.replace(/_/g, ' ')}</span>}
            </div>
          </div>
          <Toggle checked={light.on} onChange={(v) => setLight(light.id, { on: v })} size="lg" label="Power" />
          <IconButton title="Close" onClick={() => openLight(null)}>
            <X size={18} />
          </IconButton>
        </div>

        <div className="scroll flex-1 px-5 py-4 space-y-5">
          {light.supportsDimming && (
            <div>
              <div className="flex items-center justify-between text-xs text-muted mb-1">
                <span>Brightness</span>
                <span className="font-medium text-[var(--fg)]">{Math.round(light.brightness)}%</span>
              </div>
              <Slider value={Math.round(light.brightness)} min={1} max={100} thick onChange={(v) => throttledLight({ brightness: v, on: true })} onCommit={(v) => setLight(light.id, { brightness: v, on: true })} label="Brightness" />
            </div>
          )}

          {tabs.length > 0 && (
            <div className="flex gap-1 rounded-xl surface-2 p-1">
              {tabs.map((t) => (
                <button key={t.key} onClick={() => setTab(t.key)} className={cx('flex flex-1 items-center justify-center gap-1.5 rounded-lg h-8 text-xs font-medium transition-colors', tab === t.key ? 'surface shadow-sm' : 'text-muted hover:text-[var(--fg)]')}>
                  <t.icon size={14} /> {t.label}
                </button>
              ))}
            </div>
          )}

          {tab === 'color' && light.supportsColor && (
            <div className="space-y-4 fade-in">
              <ColorWheel
                hex={wheelHex ?? light.hex}
                gamut={light.gamut}
                size={260}
                onChange={(xy, hex) => {
                  setWheelHex(hex);
                  throttledXy(xy);
                }}
                onCommit={(xy, hex) => {
                  setWheelHex(hex);
                  setLight(light.id, { on: true, xy });
                }}
              />
              <PresetRow supportsColor supportsCt={false} gamut={light.gamut} onPick={(s) => { setWheelHex(null); setLight(light.id, s); }} />
            </div>
          )}

          {tab === 'white' && light.supportsColorTemperature && (
            <div className="space-y-4 fade-in">
              <div className="h-[110px] rounded-2xl flex items-center justify-center" style={{ background: `radial-gradient(circle at 50% 40%, ${light.colorMode === 'ct' ? light.hex : mirekToHex(370)} 0%, transparent 70%)` }}>
                <Swatch hex={light.colorMode === 'ct' ? light.hex : mirekToHex(370)} size={56} ring />
              </div>
              <CtSlider light={light} onChange={(m) => throttledLight({ on: true, mirek: m })} onCommit={(m) => setLight(light.id, { on: true, mirek: m })} />
              <PresetRow supportsColor={false} supportsCt gamut={light.gamut} onPick={(s) => setLight(light.id, s)} />
            </div>
          )}

          {tab === 'effects' && (
            <div className="fade-in">
              <div className="grid grid-cols-2 gap-2">
                {light.effects
                  .filter((e) => e !== 'no_effect')
                  .map((e) => {
                    const EIcon = EFFECT_ICONS[e] ?? Sparkles;
                    const active = light.effect === e;
                    return (
                      <button key={e} onClick={() => setLight(light.id, { on: true, effect: e })} className={cx('flex items-center gap-2 rounded-xl border px-3 h-11 text-sm capitalize transition-all', active ? 'border-accent/70 bg-accent/15' : 'border-[var(--border)] surface-2 hover:border-[var(--border-strong)]')}>
                        <EIcon size={16} className={active ? 'text-accent' : 'text-muted'} /> {e.replace(/_/g, ' ')}
                      </button>
                    );
                  })}
              </div>
              <Button variant="outline" className="mt-3 w-full" onClick={() => setLight(light.id, { effect: 'no_effect' })} disabled={!light.effect || light.effect === 'no_effect'}>
                Stop effect
              </Button>
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => window.hue.identify(light.id).then(() => toast(`${light.name} is blinking`)).catch((e) => toast(e.message, 'error'))}>
              Identify (blink)
            </Button>
          </div>

          <div className="rounded-xl surface-2 p-3 text-xs space-y-1.5">
            <div className="flex items-center gap-1.5 font-medium text-muted uppercase tracking-wider text-[10px]">
              <Info size={12} /> Details
            </div>
            <Row k="Type" v={archetypeLabel(light.archetype)} />
            {light.productName && <Row k="Product" v={light.productName} />}
            {light.modelId && <Row k="Model" v={light.modelId} />}
            {light.softwareVersion && <Row k="Firmware" v={light.softwareVersion} />}
            <Row k="Capabilities" v={[light.supportsDimming && 'dimming', light.supportsColor && `colour (gamut ${light.gamutType ?? 'C'})`, light.supportsColorTemperature && `white ${mirekToKelvin(light.mirekMax)}–${mirekToKelvin(light.mirekMin)}K`, light.gradientPoints && 'gradient'].filter(Boolean).join(', ')} />
            <Row k="Connectivity" v={light.connectivity ?? 'unknown'} />
            <Row k="Current" v={light.on ? `${Math.round(light.brightness)}% · ${light.colorMode === 'ct' ? `${light.kelvin}K` : light.hex}${light.effect && light.effect !== 'no_effect' ? ` · ${light.effect}` : ''}` : 'off'} />
            <Row k="ID" v={light.id} mono />
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex gap-3">
      <span className="w-24 shrink-0 text-muted">{k}</span>
      <span className={cx('min-w-0 break-all', mono && 'font-mono text-[10px]')}>{v}</span>
    </div>
  );
}
