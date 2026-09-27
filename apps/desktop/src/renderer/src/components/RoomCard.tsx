import type { GroupView } from '@hue/core';
import { Check, ChevronDown, MoreHorizontal, Pencil, Play, Save, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { roomIcon } from '../lib/icons';
import { selectRoomLights, useApp } from '../store';
import LightRow from './LightRow';
import { PresetRow } from './LightSheet';
import SceneChip from './SceneChip';
import { Button, Chip, cx, Field, IconButton, Input, Modal, Slider, Swatch, Toggle, useThrottle } from './ui';

/** A room or zone, washed with the colour of its lights. Click to open it inline. */
export function RoomCard({ group }: { group: GroupView }) {
  const home = useApp((s) => s.home);
  const setGroup = useApp((s) => s.setGroup);
  const expanded = useApp((s) => s.expandedGroup === group.id);
  const expandGroup = useApp((s) => s.expandGroup);
  const Icon = roomIcon(group.archetype);
  const throttled = useThrottle((v: number) => setGroup(group.id, { brightness: v, on: true }), 150);
  const activeScene = group.activeSceneId ? home.sceneById[group.activeSceneId] : undefined;
  const onCount = group.lightIds.filter((id) => home.lightById[id]?.on).length;
  const tint = group.colors[0] ?? '#ffb454';
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => expandGroup(group.id)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && expandGroup(group.id)}
      style={{ '--tint': tint } as React.CSSProperties}
      className={cx('ambient rounded-2xl p-4 cursor-pointer transition-all select-none outline-none', !group.anyOn && 'off', expanded ? 'ring-2 ring-accent/60' : 'hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-accent/40')}
    >
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: group.anyOn ? `${tint}33` : 'var(--bg-elev-2)' }}>
          <Icon size={20} style={{ color: group.anyOn ? tint : 'var(--fg-muted)' }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[15px] truncate flex items-center gap-1.5">
            {group.name}
            {group.kind === 'zone' && <span className="rounded-md surface-2 px-1.5 text-[10px] font-medium uppercase tracking-wide text-muted">zone</span>}
          </div>
          <div className="text-xs text-muted truncate">{group.anyOn ? `${onCount} of ${group.lightIds.length} on${activeScene ? ` · ${activeScene.name}` : ''}` : 'Off'}</div>
        </div>
        <Toggle checked={group.anyOn} onChange={(v) => setGroup(group.id, { on: v })} label={`${group.name} power`} />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Slider value={group.anyOn ? Math.round(group.brightness) : 0} min={1} max={100} disabled={!group.lightIds.length} onChange={throttled} onCommit={(v) => setGroup(group.id, { brightness: v, on: true })} label={`${group.name} brightness`} />
        <span className="w-9 text-right text-xs text-muted tabular-nums">{group.anyOn ? `${Math.round(group.brightness)}%` : ''}</span>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-1">
          {group.lightIds.slice(0, 8).map((id) => {
            const l = home.lightById[id];
            return l ? <Swatch key={id} hex={l.hex} on={l.on} size={10} /> : null;
          })}
          {group.lightIds.length > 8 && <span className="text-[10px] text-muted ml-1">+{group.lightIds.length - 8}</span>}
        </div>
        <ChevronDown size={16} className={cx('text-muted transition-transform', expanded && 'rotate-180')} />
      </div>
    </div>
  );
}

/** The open room: brightness and quick colours, its scenes and its lights. */
export function RoomDetail({ group }: { group: GroupView }) {
  const home = useApp((s) => s.home);
  const setGroup = useApp((s) => s.setGroup);
  const expandGroup = useApp((s) => s.expandGroup);
  const toast = useApp((s) => s.toast);
  const [menu, setMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(group.name);
  const [saveScene, setSaveScene] = useState(false);
  const [sceneName, setSceneName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const throttled = useThrottle((v: number) => setGroup(group.id, { brightness: v, on: true }), 150);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  const Icon = roomIcon(group.archetype);
  const lights = selectRoomLights(home, group);
  const scenes = group.sceneIds.map((sid) => home.sceneById[sid]).filter(Boolean);
  const supportsColor = lights.some((l) => l.supportsColor);
  const supportsCt = lights.some((l) => l.supportsColorTemperature);
  const tint = group.anyOn ? (group.colors[0] ?? '#ffb454') : 'var(--fg-muted)';

  const submitRename = async () => {
    if (name.trim() && name.trim() !== group.name) {
      try {
        await window.hue.rename(group.kind, group.id, name.trim());
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
      toast(`Saved "${sceneName.trim()}"`, 'success');
      setSaveScene(false);
      setSceneName('');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <div className="surface rounded-2xl p-4 fade-in" style={{ gridColumn: '1 / -1' }}>
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: group.anyOn ? `${group.colors[0] ?? '#ffb454'}33` : 'var(--bg-elev-2)' }}>
          <Icon size={20} style={{ color: tint }} />
        </div>
        <div className="min-w-0 flex-1">
          {renaming ? (
            <div className="flex items-center gap-1 max-w-xs">
              <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={32} className="h-9" onKeyDown={(e) => (e.key === 'Enter' ? submitRename() : e.key === 'Escape' ? setRenaming(false) : null)} />
              <IconButton title="Save" onClick={submitRename}>
                <Check size={16} />
              </IconButton>
            </div>
          ) : (
            <div className="text-lg font-semibold truncate leading-tight">{group.name}</div>
          )}
          <div className="text-xs text-muted">
            {lights.length} light{lights.length === 1 ? '' : 's'} · {group.anyOn ? `${lights.filter((l) => l.on).length} on` : 'off'}
          </div>
        </div>
        <Toggle checked={group.anyOn} onChange={(v) => setGroup(group.id, { on: v })} size="lg" label="Power" />
        <div className="relative" ref={menuRef}>
          <IconButton title="More" onClick={() => setMenu((m) => !m)}>
            <MoreHorizontal size={18} />
          </IconButton>
          {menu && (
            <div className="absolute right-0 top-10 z-30 w-52 surface rounded-xl shadow-soft p-1 fade-in">
              <MenuItem icon={<Pencil size={14} />} label="Rename" onClick={() => { setName(group.name); setRenaming(true); setMenu(false); }} />
              <MenuItem icon={<Save size={14} />} label="Save as scene" onClick={() => { setSaveScene(true); setMenu(false); }} />
              <MenuItem icon={<Play size={14} />} label="Blink lights" onClick={() => { window.hue.identifyGroup(group.id).catch((e) => toast(e.message, 'error')); setMenu(false); }} />
              {group.kind === 'zone' && <MenuItem icon={<Trash2 size={14} />} label="Delete zone" danger onClick={() => { setConfirmDelete(true); setMenu(false); }} />}
            </div>
          )}
        </div>
        <IconButton title="Close" onClick={() => expandGroup(null)}>
          <X size={18} />
        </IconButton>
      </div>

      <div className="mt-4 flex items-center gap-4">
        <Slider value={group.anyOn ? Math.round(group.brightness) : 0} min={1} max={100} thick onChange={throttled} onCommit={(v) => setGroup(group.id, { brightness: v, on: true })} label="Brightness" />
        <span className="w-10 text-right text-sm tabular-nums">{group.anyOn ? `${Math.round(group.brightness)}%` : ''}</span>
      </div>
      {(supportsColor || supportsCt) && (
        <div className="mt-3">
          <PresetRow supportsColor={supportsColor} supportsCt={supportsCt} onPick={(s) => setGroup(group.id, s)} compact />
        </div>
      )}

      {scenes.length > 0 && (
        <div className="mt-4 flex gap-2.5 overflow-x-auto pb-1 scroll">
          {scenes.map((s) => (
            <SceneChip key={s.id} scene={s} />
          ))}
        </div>
      )}

      <div className="mt-4 grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))' }}>
        {lights.map((l) => (
          <LightRow key={l.id} light={l} className="surface-2" />
        ))}
      </div>

      <Modal open={saveScene} title={`Save scene · ${group.name}`} onClose={() => setSaveScene(false)} footer={<><Button variant="ghost" onClick={() => setSaveScene(false)}>Cancel</Button><Button variant="primary" onClick={submitScene} disabled={!sceneName.trim()}>Save</Button></>}>
        <Field label="Name">
          <Input autoFocus value={sceneName} onChange={(e) => setSceneName(e.target.value)} placeholder="Movie night" maxLength={32} onKeyDown={(e) => e.key === 'Enter' && submitScene()} />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {['Relax', 'Focus', 'Movie night', 'Dinner', 'Nightlight', 'Party'].map((n) => (
            <Chip key={n} onClick={() => setSceneName(n)} active={sceneName === n}>{n}</Chip>
          ))}
        </div>
      </Modal>

      <Modal open={confirmDelete} title="Delete zone?" onClose={() => setConfirmDelete(false)} footer={<><Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button><Button variant="danger" onClick={async () => { try { await window.hue.deleteGroup('zone', group.id); expandGroup(null); } catch (e) { toast((e as Error).message, 'error'); } }}>Delete</Button></>}>
        <p className="text-sm">"{group.name}" and its scenes are removed. Lights are not affected.</p>
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
