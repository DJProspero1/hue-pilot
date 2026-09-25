import { WEEKDAYS, type Weekday } from '@hue/core';
import { CalendarClock, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button, Chip, cx, EmptyState, Field, IconButton, Input, Modal, Select, Spinner, Toggle } from '../components/ui';
import { useApp } from '../store';
import type { ScheduleSpec, ScheduleView } from '../../../shared/ipc-types.ts';

const DAY_LABEL: Record<Weekday, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

export default function AutomationsView() {
  const home = useApp((s) => s.home);
  const status = useApp((s) => s.status);
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
    if (status.state !== 'connected') return;
    try {
      setError(null);
      setItems(await window.hue.listSchedules());
    } catch (err) {
      setError((err as Error).message);
      setItems([]);
    }
  }, [status.state]);

  useEffect(() => {
    load();
  }, [load]);

  const targets = [
    ...(home.home ? [{ key: `group:${home.home.id}`, label: 'All lights', kind: 'group' as const, id: home.home.id }] : []),
    ...home.groups.map((g) => ({ key: `group:${g.id}`, label: `${g.name}${g.kind === 'zone' ? ' (zone)' : ''}`, kind: 'group' as const, id: g.id })),
    ...home.lights.map((l) => ({ key: `light:${l.id}`, label: `💡 ${l.name}${l.roomName ? ` · ${l.roomName}` : ''}`, kind: 'light' as const, id: l.id })),
  ];
  const target = targets.find((t) => t.key === targetKey) ?? targets[0];
  const targetScenes = target?.kind === 'group' ? home.scenes.filter((s) => s.groupId === target.id) : [];

  const openCreate = () => {
    setTargetKey(targets[0]?.key ?? '');
    setCreate(true);
  };

  const submit = async () => {
    if (!target) return;
    const spec: ScheduleSpec = {
      name: name.trim() || `${target.label} ${action === 'scene' ? home.sceneById[sceneId]?.name ?? '' : action}`.slice(0, 32),
      time,
      days: repeat === 'daily' ? undefined : repeat === 'weekdays' ? ['weekdays'] : repeat === 'weekends' ? ['weekends'] : repeat === 'custom' ? days : undefined,
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
      toast('Automation saved on the bridge', 'success');
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
      toast('Automation deleted');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <div className="fade-in">
      <div className="flex items-end justify-between mb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Automations</h1>
          <p className="text-sm text-muted mt-0.5">Time-based schedules stored on the bridge. They run even when this app is closed.</p>
        </div>
        <div className="flex gap-2">
          <IconButton title="Refresh" onClick={load}>
            <RefreshCw size={16} />
          </IconButton>
          <Button variant="primary" icon={<Plus size={15} />} onClick={openCreate} disabled={status.state !== 'connected'}>
            New automation
          </Button>
        </div>
      </div>

      {items === null && <div className="flex justify-center py-10"><Spinner /></div>}
      {error && <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm mb-4">Could not load schedules: {error}</div>}
      {items && !items.length && !error && <EmptyState icon={<CalendarClock size={40} />} title="No automations yet" hint='Try "Turn the office off at 23:00 on weekdays" — or ask the assistant to create one.' action={<Button variant="primary" onClick={openCreate}>Create one</Button>} />}
      <div className="space-y-2">
        {items?.map((s) => (
          <div key={s.id} className={cx('surface rounded-xl px-4 py-3 flex items-center gap-4', s.status !== 'enabled' && 'opacity-60')}>
            <div className="h-10 w-10 rounded-xl surface-2 flex items-center justify-center shrink-0">
              <CalendarClock size={18} className="text-accent" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-medium truncate">{s.name}</div>
              <div className="text-xs text-muted truncate">
                {s.when} → <span className="text-[var(--fg)]">{s.target?.name ?? 'Unknown target'}</span> · {s.action.summary}
                {s.createdBy !== 'hue-pilot' && <span className="ml-2 rounded-md surface-2 px-1.5 py-0.5 text-[10px] uppercase">other app</span>}
              </div>
            </div>
            <Toggle checked={s.status === 'enabled'} onChange={(v) => toggle(s, v)} size="sm" />
            <IconButton title="Delete" onClick={() => remove(s)} className="text-rose-400 hover:text-rose-400">
              <Trash2 size={16} />
            </IconButton>
          </div>
        ))}
      </div>

      <Modal open={create} title="New automation" onClose={() => setCreate(false)} width="max-w-xl" footer={<><Button variant="ghost" onClick={() => setCreate(false)}>Cancel</Button><Button variant="primary" loading={saving} onClick={submit}>Save to bridge</Button></>}>
        <Field label="Name" hint="Optional">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} placeholder="e.g. Office off at night" />
        </Field>
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
              <option value="once">Once, on a date</option>
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
            <Chip active={action === 'on'} onClick={() => setAction('on')}>Turn on</Chip>
            <Chip active={action === 'off'} onClick={() => setAction('off')}>Turn off</Chip>
            <Chip active={action === 'brightness'} onClick={() => setAction('brightness')}>Set brightness</Chip>
            {targetScenes.length > 0 && <Chip active={action === 'scene'} onClick={() => setAction('scene')}>Activate scene</Chip>}
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
              <option value="">Choose a scene…</option>
              {targetScenes.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>
        )}
      </Modal>
    </div>
  );
}
