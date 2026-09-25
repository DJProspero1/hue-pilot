import type { GroupView, LightView, SceneView } from '@hue/core';
import { ArrowLeft, Check, MoreHorizontal, Pencil, Play, Save, Sparkles, Trash2, Zap } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PresetRow } from '../components/LightSheet';
import { Button, Chip, cx, EmptyState, Field, IconButton, Input, Modal, SectionTitle, Slider, Swatch, Toggle, useThrottle } from '../components/ui';
import { lightIcon, roomIcon } from '../lib/icons';
import { selectRoomLights, useApp } from '../store';

export function LightRow({ light, showRoom }: { light: LightView; showRoom?: boolean }) {
  const setLight = useApp((s) => s.setLight);
  const openLight = useApp((s) => s.openLight);
  const throttled = useThrottle((v: number) => setLight(light.id, { brightness: v, on: true }), 120);
  const Icon = lightIcon(light.archetype);
  const unreachable = light.connectivity && light.connectivity !== 'connected';
  return (
    <div onClick={() => openLight(light.id)} className="surface flex items-center gap-3 rounded-xl px-3 py-2.5 cursor-pointer hover:border-[var(--border-strong)] transition-colors">
      <div className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: light.on ? `${light.hex}2e` : 'var(--bg-elev-2)' }}>
        <Icon size={18} style={{ color: light.on ? light.hex : 'var(--fg-muted)' }} />
      </div>
      <div className="min-w-0 w-[200px]">
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
      <div className="flex-1 flex items-center gap-2 min-w-[120px]">
        <Slider value={light.on ? Math.round(light.brightness) : 0} min={1} max={100} disabled={!light.supportsDimming} onChange={throttled} onCommit={(v) => setLight(light.id, { brightness: v, on: true })} label={`${light.name} brightness`} />
      </div>
      <Swatch hex={light.hex} on={light.on} size={14} />
      <Toggle checked={light.on} onChange={(v) => setLight(light.id, { on: v })} size="sm" label={`${light.name} power`} />
    </div>
  );
}

export function SceneChip({ scene, large }: { scene: SceneView; large?: boolean }) {
  const recallScene = useApp((s) => s.recallScene);
  const active = scene.active !== 'inactive';
  const gradient = scene.palette.length ? `linear-gradient(135deg, ${scene.palette.length === 1 ? `${scene.palette[0]}, ${scene.palette[0]}` : scene.palette.join(', ')})` : 'linear-gradient(135deg, #ffd9a0, #ffb36b)';
  return (
    <button
      onClick={() => recallScene(scene.id, 'active')}
      className={cx('group relative shrink-0 overflow-hidden rounded-2xl border text-left transition-all', large ? 'h-[104px] w-[180px]' : 'h-[76px] w-[148px]', active ? 'border-accent shadow-[0_0_0_2px_rgba(255,138,61,0.35)]' : 'border-[var(--border)] hover:border-[var(--border-strong)] hover:-translate-y-px')}
      title={`Activate ${scene.name}`}
    >
      <div className="absolute inset-0 opacity-90" style={{ background: gradient }} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
      <div className="absolute bottom-2 left-3 right-2 text-white drop-shadow">
        <div className="text-sm font-semibold truncate">{scene.name}</div>
        {active && <div className="text-[10px] uppercase tracking-wide opacity-90">{scene.active === 'dynamic_palette' ? 'Dynamic' : 'Active'}</div>}
      </div>
      {scene.supportsDynamic && (
        <span
          role="button"
          title="Start dynamic scene"
          onClick={(e) => {
            e.stopPropagation();
            recallScene(scene.id, scene.active === 'dynamic_palette' ? 'static' : 'dynamic_palette');
          }}
          className={cx('absolute right-2 top-2 rounded-full bg-black/40 p-1.5 text-white backdrop-blur transition-opacity hover:bg-black/60', scene.active === 'dynamic_palette' ? 'opacity-100 ring-2 ring-white/70' : 'opacity-0 group-hover:opacity-100')}
        >
          <Sparkles size={12} />
        </span>
      )}
    </button>
  );
}

export default function RoomView({ id }: { id: string }) {
  const home = useApp((s) => s.home);
  const navigate = useApp((s) => s.navigate);
  const setGroup = useApp((s) => s.setGroup);
  const toast = useApp((s) => s.toast);
  const group: GroupView | undefined = home.groupById[id];
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [saveScene, setSaveScene] = useState(false);
  const [sceneName, setSceneName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const throttled = useThrottle((v: number) => group && setGroup(group.id, { brightness: v, on: true }), 150);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  if (!group) {
    return <EmptyState title="Room not found" action={<Button onClick={() => navigate({ view: 'home' })}>Back to home</Button>} />;
  }
  const Icon = roomIcon(group.archetype);
  const lights = selectRoomLights(home, group);
  const scenes = group.sceneIds.map((sid) => home.sceneById[sid]).filter(Boolean);
  const supportsColor = lights.some((l) => l.supportsColor);
  const supportsCt = lights.some((l) => l.supportsColorTemperature);
  const glow = group.anyOn ? (group.colors[0] ?? '#ffcc88') : '#94a3b8';

  const submitRename = async () => {
    if (name.trim() && name.trim() !== group.name) {
      try {
        await window.hue.rename(group.kind, group.id, name.trim());
        toast('Renamed', 'success');
      } catch (err) {
        toast((err as Error).message, 'error');
      }
    }
    setRenaming(false);
  };

  const submitScene = async () => {
    if (!sceneName.trim()) return;
    try {
      await window.hue.createScene({ name: sceneName.trim(), groupId: group.id, groupType: group.kind === 'zone' ? 'zone' : 'room', actions: [], fromCurrentState: true });
      toast(`Scene "${sceneName.trim()}" saved`, 'success');
      setSaveScene(false);
      setSceneName('');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <div className="fade-in">
      <div className="flex items-center gap-3 mb-4">
        <IconButton title="Back" onClick={() => navigate({ view: 'home' })}>
          <ArrowLeft size={18} />
        </IconButton>
        <div className="h-12 w-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: `${glow}2e`, boxShadow: group.anyOn ? `0 0 28px -6px ${glow}` : 'none' }}>
          <Icon size={24} style={{ color: group.anyOn ? glow : 'var(--fg-muted)' }} />
        </div>
        <div className="min-w-0 flex-1">
          {renaming ? (
            <div className="flex items-center gap-1 max-w-sm">
              <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={32} onKeyDown={(e) => (e.key === 'Enter' ? submitRename() : e.key === 'Escape' ? setRenaming(false) : null)} />
              <IconButton title="Save" onClick={submitRename}>
                <Check size={16} />
              </IconButton>
            </div>
          ) : (
            <h1 className="text-2xl font-semibold tracking-tight truncate">{group.name}</h1>
          )}
          <div className="text-sm text-muted">
            {group.kind === 'zone' ? 'Zone' : 'Room'} · {lights.length} light{lights.length === 1 ? '' : 's'} · {group.anyOn ? `${lights.filter((l) => l.on).length} on` : 'off'}
            {group.activeSceneId && home.sceneById[group.activeSceneId] && ` · ${home.sceneById[group.activeSceneId].name}`}
          </div>
        </div>
        <Toggle checked={group.anyOn} onChange={(v) => setGroup(group.id, { on: v })} size="lg" label="Power" />
        <div className="relative" ref={menuRef}>
          <IconButton title="More" onClick={() => setMenu((m) => !m)}>
            <MoreHorizontal size={18} />
          </IconButton>
          {menu && (
            <div className="absolute right-0 top-10 z-30 w-56 surface rounded-xl shadow-soft p-1 fade-in">
              <MenuItem icon={<Pencil size={14} />} label="Rename" onClick={() => { setName(group.name); setRenaming(true); setMenu(false); }} />
              <MenuItem icon={<Save size={14} />} label="Save current state as scene" onClick={() => { setSaveScene(true); setMenu(false); }} />
              <MenuItem icon={<Play size={14} />} label="Identify lights (blink)" onClick={() => { window.hue.identifyGroup(group.id).catch((e) => toast(e.message, 'error')); setMenu(false); }} />
              {group.kind === 'zone' && <MenuItem icon={<Trash2 size={14} />} label="Delete zone" danger onClick={() => { setConfirmDelete(true); setMenu(false); }} />}
            </div>
          )}
        </div>
      </div>

      <div className="surface rounded-2xl p-4 mb-5">
        <div className="flex items-center gap-4">
          <span className="text-xs text-muted w-20">Brightness</span>
          <Slider value={group.anyOn ? Math.round(group.brightness) : 0} min={1} max={100} thick onChange={throttled} onCommit={(v) => setGroup(group.id, { brightness: v, on: true })} label="Room brightness" />
          <span className="w-10 text-right text-sm tabular-nums">{group.anyOn ? `${Math.round(group.brightness)}%` : '—'}</span>
        </div>
        {(supportsColor || supportsCt) && (
          <div className="mt-3 flex items-start gap-4">
            <span className="text-xs text-muted w-20 pt-1.5">Quick colour</span>
            <PresetRow supportsColor={supportsColor} supportsCt={supportsCt} onPick={(s) => setGroup(group.id, s)} />
          </div>
        )}
      </div>

      <SectionTitle action={<Button size="sm" variant="ghost" icon={<Save size={14} />} onClick={() => setSaveScene(true)}>Save scene</Button>}>Scenes</SectionTitle>
      {scenes.length ? (
        <div className="flex gap-3 overflow-x-auto pb-2 scroll mb-4">
          {scenes.map((s) => (
            <SceneChip key={s.id} scene={s} large />
          ))}
        </div>
      ) : (
        <div className="text-sm text-muted mb-5">No scenes for this {group.kind}. Set the lights the way you like and save a scene.</div>
      )}

      <SectionTitle>Lights</SectionTitle>
      <div className="space-y-2">
        {lights.map((l) => (
          <LightRow key={l.id} light={l} />
        ))}
        {!lights.length && <div className="text-sm text-muted">No lights in this {group.kind}.</div>}
      </div>

      <Modal open={saveScene} title={`Save scene in ${group.name}`} onClose={() => setSaveScene(false)} footer={<><Button variant="ghost" onClick={() => setSaveScene(false)}>Cancel</Button><Button variant="primary" onClick={submitScene} disabled={!sceneName.trim()}>Save scene</Button></>}>
        <p className="text-sm text-muted mb-3">The current state of every light in this {group.kind} (on/off, brightness, colour) is stored as a scene on the bridge.</p>
        <Field label="Scene name">
          <Input autoFocus value={sceneName} onChange={(e) => setSceneName(e.target.value)} placeholder="e.g. Movie night" maxLength={32} onKeyDown={(e) => e.key === 'Enter' && submitScene()} />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {['Relax', 'Focus', 'Movie night', 'Dinner', 'Nightlight', 'Party'].map((n) => (
            <Chip key={n} onClick={() => setSceneName(n)} active={sceneName === n}>{n}</Chip>
          ))}
        </div>
      </Modal>

      <Modal open={confirmDelete} title="Delete zone?" onClose={() => setConfirmDelete(false)} footer={<><Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="danger" onClick={async () => { try { await window.hue.deleteGroup('zone', group.id); navigate({ view: 'home' }); toast('Zone deleted'); } catch (e) { toast((e as Error).message, 'error'); } }}>Delete</Button></>}>
        <p className="text-sm">The zone "{group.name}" and its scenes will be removed from the bridge. Lights are not affected.</p>
      </Modal>
    </div>
  );
}

function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={cx('flex w-full items-center gap-2 rounded-lg px-3 h-9 text-sm hover:bg-black/5 dark:hover:bg-white/10', danger && 'text-rose-400')}>
      {icon} {label}
    </button>
  );
}
