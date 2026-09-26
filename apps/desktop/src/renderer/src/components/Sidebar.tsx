import { Bot, CalendarClock, Cctv, Home, Lightbulb, Palette, Plug2, Radar, Settings, Wifi, WifiOff } from 'lucide-react';
import { useApp, type Route } from '../store';
import { cx } from './ui';

const NAV: { route: Route; label: string; icon: typeof Home }[] = [
  { route: { view: 'home' }, label: 'Home', icon: Home },
  { route: { view: 'lights' }, label: 'Lights', icon: Lightbulb },
  { route: { view: 'scenes' }, label: 'Scenes', icon: Palette },
  { route: { view: 'automations' }, label: 'Automations', icon: CalendarClock },
  { route: { view: 'accessories' }, label: 'Accessories', icon: Radar },
  { route: { view: 'cameras' }, label: 'Cameras', icon: Cctv },
  { route: { view: 'assistant' }, label: 'Assistant', icon: Bot },
  { route: { view: 'agents' }, label: 'AI agents', icon: Plug2 },
  { route: { view: 'settings' }, label: 'Settings', icon: Settings },
];

export default function Sidebar() {
  const route = useApp((s) => s.route);
  const navigate = useApp((s) => s.navigate);
  const status = useApp((s) => s.status);
  const home = useApp((s) => s.home);
  const activeView = route.view === 'room' ? 'home' : route.view;
  const connected = status.state === 'connected';
  const camerasWithMotion = home.cameras.filter((c) => c.motion === true).length;

  return (
    <aside className="flex h-full w-[232px] shrink-0 flex-col border-r border-base" style={{ background: 'var(--sidebar)' }}>
      <div className="drag flex items-center gap-2.5 px-4 pt-3 pb-3 h-[52px]">
        <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-accent via-accent-2 to-accent-3 shadow-md flex items-center justify-center">
          <Lightbulb size={16} className="text-white" />
        </div>
        <div className="leading-tight">
          <div className="font-semibold text-sm">Hue Pilot</div>
          <div className="text-[10px] text-muted">Philips Hue control</div>
        </div>
      </div>
      <nav className="flex-1 px-2.5 py-1 space-y-0.5">
        {NAV.map(({ route: r, label, icon: Icon }) => {
          const active = activeView === r.view;
          return (
            <button
              key={r.view}
              onClick={() => navigate(r)}
              className={cx(
                'flex w-full items-center gap-3 rounded-xl px-3 h-10 text-sm font-medium transition-colors',
                active ? 'bg-accent/15 text-[var(--fg)] shadow-[inset_0_0_0_1px_rgba(255,138,61,0.35)]' : 'text-muted hover:bg-black/5 hover:text-[var(--fg)] dark:hover:bg-white/5',
              )}
            >
              <Icon size={18} className={active ? 'text-accent' : ''} />
              {label}
              {r.view === 'lights' && home.totalLightsOn > 0 && (
                <span className="ml-auto rounded-full bg-accent/20 px-2 py-0.5 text-[10px] font-semibold text-accent">{home.totalLightsOn}</span>
              )}
              {r.view === 'cameras' && camerasWithMotion > 0 && (
                <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-400" title="Motion detected">
                  <span className="h-1.5 w-1.5 rounded-full bg-rose-400 animate-pulse" />
                  {camerasWithMotion}
                </span>
              )}
            </button>
          );
        })}
      </nav>
      <div className="px-3 pb-3">
        <button onClick={() => navigate({ view: 'settings' })} className="w-full surface rounded-xl px-3 py-2.5 text-left hover:border-[var(--border-strong)] transition-colors">
          <div className="flex items-center gap-2">
            <span className={cx('h-2 w-2 rounded-full', connected ? (status.stream === 'open' ? 'bg-emerald-400' : 'bg-amber-400') : status.state === 'connecting' ? 'bg-amber-400 animate-pulse' : 'bg-rose-400')} />
            <span className="text-xs font-medium truncate flex-1">{status.bridgeName ?? (connected ? 'Hue Bridge' : 'No bridge')}</span>
            {connected ? <Wifi size={14} className="text-muted" /> : <WifiOff size={14} className="text-muted" />}
          </div>
          <div className="text-[10px] text-muted mt-0.5 truncate">
            {status.state === 'connected'
              ? `${status.host}${status.stream === 'open' ? ' · live' : status.stream === 'connecting' ? ' · connecting stream' : ' · polling'}`
              : status.state === 'connecting'
                ? 'Connecting…'
                : status.state === 'error'
                  ? status.error ?? 'Connection error'
                  : 'Pair a bridge in Settings'}
          </div>
        </button>
      </div>
    </aside>
  );
}
