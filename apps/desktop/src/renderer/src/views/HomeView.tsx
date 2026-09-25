import type { GroupView } from '@hue/core';
import { ChevronRight, Power, Star } from 'lucide-react';
import { roomIcon } from '../lib/icons';
import { useApp } from '../store';
import { Card, cx, EmptyState, SectionTitle, Slider, Swatch, Toggle, useThrottle } from '../components/ui';

export function GroupCard({ group }: { group: GroupView }) {
  const navigate = useApp((s) => s.navigate);
  const setGroup = useApp((s) => s.setGroup);
  const home = useApp((s) => s.home);
  const favourites = useApp((s) => s.settings.favouriteGroupIds);
  const updateSettings = useApp((s) => s.updateSettings);
  const Icon = roomIcon(group.archetype);
  const throttled = useThrottle((v: number) => setGroup(group.id, { brightness: v, on: true }), 150);
  const activeScene = group.activeSceneId ? home.sceneById[group.activeSceneId] : undefined;
  const fav = favourites.includes(group.id);
  const onCount = group.lightIds.filter((id) => home.lightById[id]?.on).length;
  const glow = group.anyOn ? (group.colors[0] ?? '#ffcc88') : undefined;

  return (
    <Card onClick={() => navigate({ view: 'room', id: group.id })} glow={glow ? `${glow}66` : undefined} className="group relative">
      <div className="flex items-start gap-3">
        <div className="h-11 w-11 rounded-2xl flex items-center justify-center shrink-0 transition-colors" style={{ background: group.anyOn ? `${glow}2e` : 'var(--bg-elev-2)' }}>
          <Icon size={22} style={{ color: group.anyOn ? glow : 'var(--fg-muted)' }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="font-semibold truncate">{group.name}</h3>
            {group.kind === 'zone' && <span className="rounded-md surface-2 px-1.5 text-[10px] uppercase tracking-wide text-muted">zone</span>}
          </div>
          <div className="text-xs text-muted truncate">
            {group.anyOn ? `${onCount} of ${group.lightIds.length} on` : `${group.lightIds.length} light${group.lightIds.length === 1 ? '' : 's'} · off`}
            {activeScene && ` · ${activeScene.name}`}
          </div>
        </div>
        <Toggle checked={group.anyOn} onChange={(v) => setGroup(group.id, { on: v })} label={`${group.name} power`} />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Slider value={group.anyOn ? Math.round(group.brightness) : 0} min={1} max={100} disabled={!group.lightIds.length} onChange={throttled} onCommit={(v) => setGroup(group.id, { brightness: v, on: true })} label={`${group.name} brightness`} />
        <span className="w-9 text-right text-xs text-muted tabular-nums">{group.anyOn ? `${Math.round(group.brightness)}%` : '—'}</span>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-1">
          {group.lightIds.slice(0, 8).map((id) => {
            const l = home.lightById[id];
            return l ? <Swatch key={id} hex={l.hex} on={l.on} size={10} /> : null;
          })}
          {group.lightIds.length > 8 && <span className="text-[10px] text-muted ml-1">+{group.lightIds.length - 8}</span>}
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            title={fav ? 'Remove from favourites' : 'Add to favourites (tray menu)'}
            onClick={(e) => {
              e.stopPropagation();
              updateSettings({ favouriteGroupIds: fav ? favourites.filter((x) => x !== group.id) : [...favourites, group.id] });
            }}
            className={cx('rounded-lg p-1 hover:bg-black/5 dark:hover:bg-white/10', fav && 'opacity-100')}
          >
            <Star size={14} className={fav ? 'fill-amber-400 text-amber-400' : 'text-muted'} />
          </button>
          <ChevronRight size={16} className="text-muted" />
        </div>
      </div>
      {fav && <Star size={12} className="absolute right-3 top-3 fill-amber-400 text-amber-400 group-hover:opacity-0 transition-opacity" />}
    </Card>
  );
}

export default function HomeView() {
  const home = useApp((s) => s.home);
  const status = useApp((s) => s.status);
  const setGroup = useApp((s) => s.setGroup);
  const search = useApp((s) => s.search.trim().toLowerCase());
  const favourites = useApp((s) => s.settings.favouriteGroupIds);
  const filter = (g: GroupView) => !search || g.name.toLowerCase().includes(search) || g.lightIds.some((id) => home.lightById[id]?.name.toLowerCase().includes(search));
  const rooms = home.rooms.filter(filter);
  const zones = home.zones.filter(filter);
  const favs = favourites.map((id) => home.groupById[id]).filter(Boolean).filter(filter);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  if (status.state !== 'connected' && !home.lights.length) {
    return <EmptyState title={status.state === 'connecting' ? 'Connecting to your bridge…' : 'Bridge not connected'} hint={status.error ?? 'Waiting for the Hue bridge.'} />;
  }

  return (
    <div className="fade-in">
      <div className="flex items-end justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{greeting}</h1>
          <p className="text-sm text-muted mt-0.5">
            {home.totalLightsOn === 0 ? 'All lights are off' : `${home.totalLightsOn} of ${home.lights.length} lights on`} · {home.rooms.length} rooms · {home.zones.length} zones
          </p>
        </div>
        {home.home && (
          <div className="surface rounded-2xl px-4 py-2.5 flex items-center gap-3">
            <Power size={16} className={home.home.anyOn ? 'text-accent' : 'text-muted'} />
            <span className="text-sm font-medium">All lights</span>
            <Toggle checked={home.home.anyOn} onChange={(v) => setGroup(home.home!.id, { on: v })} label="All lights" />
          </div>
        )}
      </div>

      {favs.length > 0 && !search && (
        <>
          <SectionTitle>Favourites</SectionTitle>
          <div className="grid gap-3 mb-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {favs.map((g) => (
              <GroupCard key={g.id} group={g} />
            ))}
          </div>
        </>
      )}

      <SectionTitle>Rooms</SectionTitle>
      {rooms.length ? (
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
          {rooms.map((g) => (
            <GroupCard key={g.id} group={g} />
          ))}
        </div>
      ) : (
        <EmptyState title={search ? 'No rooms match your search' : 'No rooms yet'} hint={search ? undefined : 'Create rooms in the Philips Hue app; they appear here automatically.'} />
      )}

      {zones.length > 0 && (
        <>
          <SectionTitle>Zones</SectionTitle>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {zones.map((g) => (
              <GroupCard key={g.id} group={g} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
