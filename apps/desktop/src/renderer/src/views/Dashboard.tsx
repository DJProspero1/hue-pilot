import type { GroupView } from '@hue/core';
import { Cctv, Power, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import Automations from '../components/Automations';
import CameraStage from '../components/CameraStage';
import LightRow from '../components/LightRow';
import { RoomCard, RoomDetail } from '../components/RoomCard';
import SceneChip from '../components/SceneChip';
import Sensors, { RecentMotion } from '../components/Sensors';
import { Button, cx, Spinner, Toggle } from '../components/ui';
import { useApp } from '../store';

function Section({ title, aside, children, className }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      <div className="flex items-center justify-between mb-2.5">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

function RoomGrid({ groups }: { groups: GroupView[] }) {
  const expanded = useApp((s) => s.expandedGroup);
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))' }}>
      {groups.map((g) => (
        <RoomCard key={g.id} group={g} />
      ))}
      {groups.map((g) => (expanded === g.id ? <RoomDetail key={`${g.id}-detail`} group={g} /> : null))}
    </div>
  );
}

/**
 * The one page. Cameras first, then rooms (each opens inline), with sensors, automations and
 * the motion log in a side rail once the window is wide enough.
 */
export default function Dashboard() {
  const home = useApp((s) => s.home);
  const status = useApp((s) => s.status);
  const setGroup = useApp((s) => s.setGroup);
  const toast = useApp((s) => s.toast);
  const q = useApp((s) => s.search.trim().toLowerCase());

  if (status.state !== 'connected' && !home.lights.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center fade-in">
        {status.state === 'error' ? <Power size={26} className="text-rose-400" /> : <Spinner size={26} />}
        <div className="text-base font-medium">{status.state === 'error' ? 'Bridge unreachable' : `Connecting to ${status.bridgeName ?? 'the bridge'}…`}</div>
        {status.error && <div className="text-xs text-muted max-w-md">{status.error}</div>}
        <Button variant="outline" size="sm" icon={<RefreshCw size={13} />} onClick={() => window.hue.reconnect().catch((e) => toast(e.message, 'error'))}>Retry now</Button>
      </div>
    );
  }

  const match = (g: GroupView) =>
    !q || g.name.toLowerCase().includes(q) || g.lightIds.some((id) => home.lightById[id]?.name.toLowerCase().includes(q)) || g.sceneIds.some((id) => home.sceneById[id]?.name.toLowerCase().includes(q));
  const rooms = home.rooms.filter(match);
  const zones = home.zones.filter(match);
  const loose = home.lights.filter((l) => !l.roomName && (!q || l.name.toLowerCase().includes(q)));
  const scenesHit = q ? home.scenes.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 24) : [];
  const motionCams = home.cameras.filter((c) => c.motionEnabled && c.motion === true);
  const onRooms = home.rooms.filter((g) => g.anyOn).map((g) => g.name);
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="fade-in pt-1">
      <div className="flex items-end justify-between gap-4 mb-6">
        <div className="min-w-0">
          <h1 className="text-[28px] font-bold tracking-tight leading-none">{greeting}</h1>
          <p className="text-sm text-muted mt-2 truncate">
            {home.totalLightsOn === 0 ? 'All lights are off' : `${home.totalLightsOn} of ${home.lights.length} lights on${onRooms.length ? ` · ${onRooms.slice(0, 4).join(', ')}${onRooms.length > 4 ? '…' : ''}` : ''}`}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {motionCams.length > 0 && (
            <span className="inline-flex items-center gap-2 rounded-full border border-rose-500/40 bg-rose-500/10 px-3 h-9 text-sm font-medium text-rose-400">
              <span className="h-2 w-2 rounded-full bg-rose-400 animate-pulse" />
              Motion · {motionCams.map((c) => c.name).join(', ')}
            </span>
          )}
          {home.home && (
            <div className={cx('surface rounded-full pl-4 pr-2 h-10 flex items-center gap-3', home.home.anyOn && 'glow-on')}>
              <Power size={15} className={home.home.anyOn ? 'text-accent' : 'text-muted'} />
              <span className="text-sm font-medium">All lights</span>
              <Toggle checked={home.home.anyOn} onChange={(v) => setGroup(home.home!.id, { on: v })} label="All lights" />
            </div>
          )}
        </div>
      </div>

      <div className="dash">
        <div className="min-w-0 space-y-8">
          {home.cameras.length > 0 && !q && (
            <Section title="Cameras" aside={<span className="text-[11px] text-muted inline-flex items-center gap-1"><Cctv size={12} /> {home.cameras.length}</span>}>
              <CameraStage />
            </Section>
          )}

          {scenesHit.length > 0 && (
            <Section title="Scenes">
              <div className="flex flex-wrap gap-2.5">
                {scenesHit.map((s) => (
                  <SceneChip key={s.id} scene={s} showGroup />
                ))}
              </div>
            </Section>
          )}

          <Section title="Rooms">
            {rooms.length ? <RoomGrid groups={rooms} /> : <div className="text-sm text-muted">{q ? 'No match.' : 'No rooms on this bridge.'}</div>}
          </Section>

          {zones.length > 0 && (
            <Section title="Zones">
              <RoomGrid groups={zones} />
            </Section>
          )}

          {loose.length > 0 && (
            <Section title="Other lights">
              <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))' }}>
                {loose.map((l) => (
                  <LightRow key={l.id} light={l} />
                ))}
              </div>
            </Section>
          )}
        </div>

        <aside className="min-w-0 space-y-8">
          {home.accessories.some((a) => a.kind !== 'bridge') && (
            <Section title="Sensors">
              <Sensors />
            </Section>
          )}
          <Automations />
          {(home.cameras.length > 0 || home.accessories.some((a) => a.motion)) && (
            <Section title="Recent motion">
              <RecentMotion />
            </Section>
          )}
        </aside>
      </div>
    </div>
  );
}
