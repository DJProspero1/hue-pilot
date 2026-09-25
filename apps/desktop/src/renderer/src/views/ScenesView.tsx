import type { SceneView } from '@hue/core';
import { MoreHorizontal, Palette, Pencil, Play, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, Chip, cx, EmptyState, Field, IconButton, Input, Modal, SectionTitle, Select } from '../components/ui';
import { useApp } from '../store';

function SceneCard({ scene }: { scene: SceneView }) {
  const recallScene = useApp((s) => s.recallScene);
  const toast = useApp((s) => s.toast);
  const [menu, setMenu] = useState(false);
  const [rename, setRename] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);
  const active = scene.active !== 'inactive';
  const gradient = scene.palette.length ? `linear-gradient(135deg, ${scene.palette.length === 1 ? `${scene.palette[0]}, ${scene.palette[0]}` : scene.palette.join(', ')})` : 'linear-gradient(135deg, #ffd9a0, #ffb36b)';
  return (
    <div className={cx('surface rounded-2xl overflow-hidden transition-all', active && 'border-accent shadow-[0_0_0_2px_rgba(255,138,61,0.3)]')}>
      <button className="block w-full h-16 relative" style={{ background: gradient }} onClick={() => recallScene(scene.id, 'active')} title="Activate">
        {active && <span className="absolute left-3 top-3 rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur">{scene.active === 'dynamic_palette' ? 'Dynamic' : 'Active'}</span>}
      </button>
      <div className="p-3">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="font-medium truncate">{scene.name}</div>
            <div className="text-[11px] text-muted truncate">{scene.groupName} · {scene.lightCount} light{scene.lightCount === 1 ? '' : 's'}</div>
          </div>
          <IconButton title="Activate" onClick={() => recallScene(scene.id, 'active')} className="h-8 w-8">
            <Play size={15} />
          </IconButton>
          {scene.supportsDynamic && (
            <IconButton title={scene.active === 'dynamic_palette' ? 'Stop dynamic' : 'Play dynamic'} onClick={() => recallScene(scene.id, scene.active === 'dynamic_palette' ? 'static' : 'dynamic_palette')} className={cx('h-8 w-8', scene.active === 'dynamic_palette' && 'text-accent')}>
              <Sparkles size={15} />
            </IconButton>
          )}
          <div className="relative" ref={ref}>
            <IconButton title="More" onClick={() => setMenu((m) => !m)} className="h-8 w-8">
              <MoreHorizontal size={15} />
            </IconButton>
            {menu && (
              <div className="absolute right-0 top-9 z-30 w-44 surface rounded-xl shadow-soft p-1 fade-in">
                <button onClick={() => { setRename(scene.name); setMenu(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 h-9 text-sm hover:bg-black/5 dark:hover:bg-white/10"><Pencil size={14} /> Rename</button>
                <button onClick={() => { setConfirm(true); setMenu(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 h-9 text-sm text-rose-400 hover:bg-black/5 dark:hover:bg-white/10"><Trash2 size={14} /> Delete</button>
              </div>
            )}
          </div>
        </div>
      </div>
      <Modal open={rename !== null} title="Rename scene" onClose={() => setRename(null)} footer={<><Button variant="ghost" onClick={() => setRename(null)}>Cancel</Button><Button variant="primary" onClick={async () => { try { await window.hue.updateScene(scene.id, { name: rename! }); toast('Scene renamed', 'success'); } catch (e) { toast((e as Error).message, 'error'); } setRename(null); }}>Save</Button></>}>
        <Input autoFocus value={rename ?? ''} onChange={(e) => setRename(e.target.value)} maxLength={32} />
      </Modal>
      <Modal open={confirm} title="Delete scene?" onClose={() => setConfirm(false)} footer={<><Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button><Button variant="danger" onClick={async () => { try { await window.hue.deleteScene(scene.id); toast('Scene deleted'); } catch (e) { toast((e as Error).message, 'error'); } setConfirm(false); }}>Delete</Button></>}>
        <p className="text-sm">"{scene.name}" will be removed from {scene.groupName}.</p>
      </Modal>
    </div>
  );
}

export default function ScenesView() {
  const home = useApp((s) => s.home);
  const search = useApp((s) => s.search.trim().toLowerCase());
  const toast = useApp((s) => s.toast);
  const [create, setCreate] = useState(false);
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState('');
  const scenes = home.scenes.filter((s) => !search || s.name.toLowerCase().includes(search) || s.groupName.toLowerCase().includes(search));
  const byGroup = new Map<string, SceneView[]>();
  for (const s of scenes) byGroup.set(s.groupName || 'Other', [...(byGroup.get(s.groupName || 'Other') ?? []), s]);

  const submit = async () => {
    const g = home.groupById[groupId];
    if (!g || !name.trim()) return;
    try {
      await window.hue.createScene({ name: name.trim(), groupId: g.id, groupType: g.kind === 'zone' ? 'zone' : 'room', actions: [], fromCurrentState: true });
      toast(`Scene "${name.trim()}" saved`, 'success');
      setCreate(false);
      setName('');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <div className="fade-in">
      <div className="flex items-end justify-between mb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Scenes</h1>
          <p className="text-sm text-muted mt-0.5">{home.scenes.length} scenes · click a scene to activate, ✨ for dynamic mode</p>
        </div>
        <Button variant="primary" icon={<Plus size={15} />} onClick={() => { setGroupId(home.groups[0]?.id ?? ''); setCreate(true); }}>
          New scene
        </Button>
      </div>
      {!scenes.length && <EmptyState icon={<Palette size={40} />} title="No scenes" hint="Save the current look of a room as a scene." />}
      {[...byGroup.entries()].map(([groupName, list]) => (
        <div key={groupName} className="mb-6">
          <SectionTitle>{groupName}</SectionTitle>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
            {list.map((s) => (
              <SceneCard key={s.id} scene={s} />
            ))}
          </div>
        </div>
      ))}
      <Modal open={create} title="Save current state as scene" onClose={() => setCreate(false)} footer={<><Button variant="ghost" onClick={() => setCreate(false)}>Cancel</Button><Button variant="primary" onClick={submit} disabled={!name.trim() || !groupId}>Save scene</Button></>}>
        <Field label="Room or zone">
          <Select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            {home.groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}{g.kind === 'zone' ? ' (zone)' : ''}</option>
            ))}
          </Select>
        </Field>
        <Field label="Scene name">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={32} placeholder="e.g. Movie night" onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {['Relax', 'Focus', 'Movie night', 'Dinner', 'Nightlight', 'Party'].map((n) => (
            <Chip key={n} onClick={() => setName(n)} active={name === n}>{n}</Chip>
          ))}
        </div>
      </Modal>
    </div>
  );
}
