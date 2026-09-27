import { WEEKDAYS, type Weekday } from '@hue/core';
import { CalendarClock, Plus, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useApp } from '../store';
import type { ScheduleSpec, ScheduleView } from '../../../shared/ipc-types.ts';
import { Button, Chip, cx, Field, IconButton, Input, Modal, Select, Spinner, Toggle } from './ui';

const DAY_LABEL: Record<Weekday, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

/** Bridge schedules: a compact list with a "+" to add one. */
export default function Automations() {
  const home = useApp((s) => s.home);
  const connected = useApp((s) => s.status.state === 'connected' || s.home.updatedAt > 0);
  const toast = useApp((s) => s.toast);
  const [items, setItems] = useState<ScheduleView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [create, setCreate] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [time, setTime] = useState('22:00');
  const [repeat, setRepeat] = useState<'daily' | 'weekdays' | 'weekends' | 'custom' | 'once'>('daily');
  const [days, setDays] = useState<Weekday[]>([...WEEKDAYS]);
  const [onceDate, setOnceDate] = useState(new Date(Date.now() + 86400000).toISOString().slice(0, 10));
  const [targetKey, setTargetKey] = useState('');
  const [action, setAction] = useState<'on' | 'off' | 'brightness' | 'scene'>('off');
  const [brightness, setBrightness] = useState(50);
  const [sceneId, setSceneId] = useState('');

  const load = useCallback(async () => {
    if (!connected) return;
    try {
      setError(null);
      setItems(await window.hue.listSchedules());
    } catch (err) {
      setError((err as Error).message);
      setItems([]);
    }
  }, [connected]);

  useEffect(() => {
    load();
  }, [load]);

  const targets = [
    ...(home.home ? [{ key: `group:${home.home.id}`, label: 'All lights', kind: 'group' as const, id: home.home.id }] : []),
    ...home.groups.map((g) => ({ key: `group:${g.id}`, label: `${g.name}${g.kind === 'zone' ? ' (zone)' : ''}`, kind: 'group' as const, id: g.id })),
    ...home.lights.map((l) => ({ key: `light:${l.id}`, label: `${l.name}${l.roomName ? ` · ${l.roomName}` : ''}`, kind: 'light' as const, id: l.id })),
  ];
  const target = targets.find((t) => t.key === targetKey) ?? targets[0];
  const targetScenes = target?.kind === 'group' ? home.scenes.filter((s) => s.groupId === target.id) : [];

  const submit = async () => {
    if (!target) return;
    const spec: ScheduleSpec = {
      name: (name.trim() || `${target.label} ${action === 'scene' ? home.sceneById[sceneId]?.name ?? '' : action}`).slice(0, 32),
      time,
      days: repeat === 'weekdays' ? ['weekdays'] : repeat === 'weekends' ? ['weekends'] : repeat === 'custom' ? days : undefined,
      onceDate: repeat === 'once' ? onceDate : undefined,
      target: { kind: target.kind, id: target.id },
    };
    if (action === 'on') spec.on = true;
    else if (action === 'off') spec.on = false;
    else if (action === 'brightness') spec.brightness = brightness;
    else if (action === 'scene') {
      if (!sceneId) return toast('Choose a scene', 'error');
      spec.sceneId = sceneId;
    }
    setSaving(true);
    try {
      await window.hue.createSchedule(spec);
      setCreate(false);
      setName('');
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (s: ScheduleView, enabled: boolean) => {
    try {
      await window.hue.updateSchedule(s.id, { status: enabled ? 'enabled' : 'disabled' });
      setItems((list) => list?.map((x) => (x.id === s.id ? { ...x, status: enabled ? 'enabled' : 'disabled' } : x)) ?? null);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const remove = async (s: ScheduleView) => {
    try {
      await window.hue.deleteSchedule(s.id);
      setItems((list) => list?.filter((x) => x.id !== s.id) ?? null);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Automations</h2>
        <IconButton title="New automation" className="h-7 w-7" disabled={!connected} onClick={() => { setTargetKey(targets[0]?.key ?? ''); setCreate(true); }}>
          <Plus size={15} />
        </IconButton>
      </div>
      {items === null && <div className="flex justify-center py-4"><Spinner /></div>}
      {error && <div className="text-xs text-rose-400 px-1">{error}</div>}
      {items && !items.length && !error && <div className="text-xs text-muted px-1">None yet.</div>}
      <div className="space-y-1.5">
        {items?.map((s) => (
          <div key={s.id} className={cx('group surface rounded-xl px-3 py-2 flex items-center gap-2.5', s.status !== 'enabled' && 'opacity-60')}>
            <CalendarClock size={15} className="text-accent shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{s.name}</div>
              <div className="text-[11px] text-muted truncate">{s.when} · {s.target?.name ?? '?'} · {s.action.summary}</div>
            </div>
            <button onClick={() => remove(s)} title="Delete" className="text-muted opacity-0 group-hover:opacity-100 hover:text-rose-400 transition-opacity">
              <Trash2 size={14} />
            </button>
            <Toggle checked={s.status === 'enabled'} onChange={(v) => toggle(s, v)} size="sm" />
          </div>
        ))}
      </div>

      <Modal open={create} title="New automation" onClose={() => setCreate(false)} width="max-w-xl" footer={<><Button variant="ghost" onClick={() => setCreate(false)}>Cancel</Button><Button variant="primary" loading={saving} onClick={submit}>Save</Button></>}>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Time">
            <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <Field label="Repeat">
            <Select value={repeat} onChange={(e) => setRepeat(e.target.value as typeof repeat)}>
              <option value="daily">Every day</option>
              <option value="weekdays">Weekdays</option>
              <option value="weekends">Weekends</option>
              <option value="custom">Custom days</option>
              <option value="once">Once</option>
            </Select>
          </Field>
        </div>
        {repeat === 'custom' && (
          <div className="flex gap-1.5 mb-4">
            {WEEKDAYS.map((d) => (
              <Chip key={d} active={days.includes(d)} onClick={() => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]))}>{DAY_LABEL[d]}</Chip>
            ))}
          </div>
        )}
        {repeat === 'once' && (
          <Field label="Date">
            <Input type="date" value={onceDate} onChange={(e) => setOnceDate(e.target.value)} />
          </Field>
        )}
        <Field label="Target">
          <Select value={target?.key ?? ''} onChange={(e) => { setTargetKey(e.target.value); setSceneId(''); if (action === 'scene') setAction('off'); }}>
            {targets.map((t) => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </Select>
        </Field>
        <Field label="Action">
          <div className="flex flex-wrap gap-1.5">
            <Chip active={action === 'on'} onClick={() => setAction('on')}>On</Chip>
            <Chip active={action === 'off'} onClick={() => setAction('off')}>Off</Chip>
            <Chip active={action === 'brightness'} onClick={() => setAction('brightness')}>Brightness</Chip>
            {targetScenes.length > 0 && <Chip active={action === 'scene'} onClick={() => setAction('scene')}>Scene</Chip>}
          </div>
        </Field>
        {action === 'brightness' && (
          <Field label={`Brightness · ${brightness}%`}>
            <input type="range" className="slider" min={1} max={100} value={brightness} onChange={(e) => setBrightness(Number(e.target.value))} />
          </Field>
        )}
        {action === 'scene' && (
          <Field label="Scene">
            <Select value={sceneId} onChange={(e) => setSceneId(e.target.value)}>
              <option value="">Choose…</option>
              {targetScenes.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} placeholder="Optional" />
        </Field>
      </Modal>
    </div>
  );
}
