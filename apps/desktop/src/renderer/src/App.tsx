import { AlertTriangle, ArrowLeft, Bot, CheckCircle2, Info, Lightbulb, Search, Settings, X } from 'lucide-react';
import { useEffect } from 'react';
import AssistantPanel from './components/AssistantPanel';
import LightSheet from './components/LightSheet';
import { cx, Spinner } from './components/ui';
import { useApp } from './store';
import Dashboard from './views/Dashboard';
import Onboarding from './views/Onboarding';
import SettingsPage from './views/SettingsPage';

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
  const navigate = useApp((s) => s.navigate);
  const search = useApp((s) => s.search);
  const setSearch = useApp((s) => s.setSearch);
  const status = useApp((s) => s.status);
  const assistantOpen = useApp((s) => s.assistantOpen);
  const toggleAssistant = useApp((s) => s.toggleAssistant);
  const settings = route.view === 'settings';
  const dot = status.state === 'connected' ? (status.stream === 'open' ? 'bg-emerald-400' : 'bg-amber-400') : status.state === 'connecting' ? 'bg-amber-400 animate-pulse' : 'bg-rose-400';
  return (
    <div className="drag flex h-[52px] shrink-0 items-center gap-3 px-5 pr-[150px]">
      <div className="no-drag flex items-center gap-2.5 w-[200px]">
        {settings ? (
          <button onClick={() => navigate({ view: 'home' })} className="inline-flex items-center gap-2 rounded-xl px-2 h-9 text-sm font-semibold hover:bg-black/5 dark:hover:bg-white/10">
            <ArrowLeft size={17} /> Settings
          </button>
        ) : (
          <>
            <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-accent to-accent-2 flex items-center justify-center">
              <Lightbulb size={16} className="text-[#1c1814]" />
            </div>
            <span className="font-semibold text-sm">Hue Pilot</span>
          </>
        )}
      </div>
      <div className="flex-1 flex justify-center">
        {!settings && (
          <div className="no-drag relative w-full max-w-[420px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search"
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
      <div className="no-drag flex items-center gap-1.5 justify-end w-[200px]">
        <button onClick={() => navigate({ view: 'settings' })} title={status.error ?? status.host ?? ''} className="inline-flex items-center gap-2 rounded-full surface px-3 h-8 text-xs font-medium hover:border-[var(--border-strong)] max-w-[150px]">
          <span className={cx('h-2 w-2 rounded-full shrink-0', dot)} />
          <span className="truncate">{status.bridgeName ?? (status.state === 'connected' ? 'Bridge' : status.state === 'connecting' ? 'Connecting' : 'Offline')}</span>
        </button>
        <button onClick={() => toggleAssistant()} title="Assistant" className={cx('inline-flex h-9 w-9 items-center justify-center rounded-xl transition-colors', assistantOpen ? 'bg-accent/15 text-accent' : 'text-muted hover:bg-black/5 hover:text-[var(--fg)] dark:hover:bg-white/10')}>
          <Bot size={18} />
        </button>
        {!settings && (
          <button onClick={() => navigate({ view: 'settings' })} title="Settings" className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-muted hover:bg-black/5 hover:text-[var(--fg)] dark:hover:bg-white/10 transition-colors">
            <Settings size={18} />
          </button>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const ready = useApp((s) => s.ready);
  const initError = useApp((s) => s.initError);
  const init = useApp((s) => s.init);
  const connection = useApp((s) => s.connection);
  const route = useApp((s) => s.route);
  const assistantOpen = useApp((s) => s.assistantOpen);
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
          <button className="mt-4 rounded-xl bg-accent px-4 h-10 text-[#1c1814] font-medium" onClick={() => location.reload()}>Retry</button>
        </div>
      </div>
    );
  }
  if (!connection && route.view !== 'settings') {
    return (
      <>
        <Onboarding />
        <Toasts />
      </>
    );
  }
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <main className="scroll min-w-0 flex-1 px-6 pb-10">{route.view === 'settings' ? <SettingsPage /> : <Dashboard />}</main>
        {assistantOpen && <AssistantPanel />}
      </div>
      <LightSheet />
      <Toasts />
    </div>
  );
}
