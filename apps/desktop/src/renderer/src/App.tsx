import { AlertTriangle, CheckCircle2, Info, Search, X } from 'lucide-react';
import { useEffect } from 'react';
import LightSheet from './components/LightSheet';
import Sidebar from './components/Sidebar';
import { cx, Spinner } from './components/ui';
import { useApp } from './store';
import AccessoriesView from './views/AccessoriesView';
import AgentsView from './views/AgentsView';
import AssistantView from './views/AssistantView';
import AutomationsView from './views/AutomationsView';
import CamerasView from './views/CamerasView';
import HomeView from './views/HomeView';
import LightsView from './views/LightsView';
import Onboarding from './views/Onboarding';
import RoomView from './views/RoomView';
import ScenesView from './views/ScenesView';
import SettingsView from './views/SettingsView';

function Toasts() {
  const toasts = useApp((s) => s.toasts);
  const dismiss = useApp((s) => s.dismissToast);
  if (!toasts.length) return null;
  return (
    <div className="fixed bottom-5 right-5 z-[60] flex flex-col gap-2 w-[360px]">
      {toasts.map((t) => (
        <div key={t.id} className={cx('surface shadow-soft rounded-xl px-4 py-3 flex items-start gap-3 fade-in', t.kind === 'error' && 'border-rose-500/40', t.kind === 'success' && 'border-emerald-500/40')}>
          {t.kind === 'error' ? <AlertTriangle size={18} className="text-rose-400 shrink-0 mt-0.5" /> : t.kind === 'success' ? <CheckCircle2 size={18} className="text-emerald-400 shrink-0 mt-0.5" /> : <Info size={18} className="text-accent shrink-0 mt-0.5" />}
          <div className="text-sm flex-1 break-words">{t.text}</div>
          <button onClick={() => dismiss(t.id)} className="text-muted hover:text-[var(--fg)]">
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

function TopBar() {
  const route = useApp((s) => s.route);
  const search = useApp((s) => s.search);
  const setSearch = useApp((s) => s.setSearch);
  const showSearch = ['home', 'lights', 'scenes'].includes(route.view);
  return (
    <div className="drag flex h-[52px] shrink-0 items-center gap-3 px-6 pr-[150px]">
      <div className="flex-1" />
      {showSearch && (
        <div className="no-drag relative w-[280px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search rooms, lights, scenes…"
            className="h-9 w-full rounded-xl surface pl-9 pr-8 text-sm outline-none focus:border-accent/60 placeholder:text-muted"
          />
          {search && (
            <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-[var(--fg)]" onClick={() => setSearch('')}>
              <X size={14} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Screen() {
  const route = useApp((s) => s.route);
  switch (route.view) {
    case 'home':
      return <HomeView />;
    case 'room':
      return <RoomView id={route.id} />;
    case 'lights':
      return <LightsView />;
    case 'scenes':
      return <ScenesView />;
    case 'automations':
      return <AutomationsView />;
    case 'accessories':
      return <AccessoriesView />;
    case 'cameras':
      return <CamerasView />;
    case 'assistant':
      return <AssistantView />;
    case 'agents':
      return <AgentsView />;
    case 'settings':
      return <SettingsView />;
    default:
      return null;
  }
}

export default function App() {
  const ready = useApp((s) => s.ready);
  const initError = useApp((s) => s.initError);
  const init = useApp((s) => s.init);
  const connection = useApp((s) => s.connection);
  const route = useApp((s) => s.route);
  useEffect(() => {
    init();
  }, [init]);

  if (!ready) {
    return (
      <div className="drag flex h-full items-center justify-center">
        <Spinner size={28} />
      </div>
    );
  }
  if (initError) {
    return (
      <div className="drag flex h-full items-center justify-center p-8">
        <div className="no-drag surface rounded-2xl p-6 max-w-lg text-center">
          <AlertTriangle size={28} className="mx-auto text-rose-400 mb-3" />
          <div className="font-semibold">Hue Pilot could not start</div>
          <div className="text-sm text-muted mt-1 break-words">{initError}</div>
          <button className="mt-4 rounded-xl bg-accent px-4 h-10 text-white" onClick={() => location.reload()}>Retry</button>
        </div>
      </div>
    );
  }
  if (!connection && route.view !== 'settings' && route.view !== 'agents') {
    return (
      <>
        <Onboarding />
        <Toasts />
      </>
    );
  }
  return (
    <div className="flex h-full">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="scroll flex-1 px-6 pb-8">
          <Screen />
        </main>
      </div>
      <LightSheet />
      <Toasts />
    </div>
  );
}
