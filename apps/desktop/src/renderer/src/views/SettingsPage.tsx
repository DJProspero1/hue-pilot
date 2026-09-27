import { Check, Copy, Cpu, Download, Eye, EyeOff, FolderOpen, Moon, Power, RefreshCw, ShieldCheck, Sun, SunMoon, Terminal, Unplug } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button, cx, Input, Modal, Select, Spinner, Toggle } from '../components/ui';
import { useApp } from '../store';
import type { AgentInfo, AgentTarget, AppInfo, EmulatorStatus } from '../../../shared/ipc-types.ts';
import { PROVIDERS, providerMeta, type ModelInfo, type ProviderId } from '../../../shared/providers.ts';

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted mb-2">{title}</h2>
      <div className="surface rounded-2xl divide-y divide-[var(--border)]">{children}</div>
    </section>
  );
}

function Row({ label, sub, children }: { label: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3 min-h-[52px]">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium truncate">{label}</div>
        {sub && <div className="text-xs text-muted truncate">{sub}</div>}
      </div>
      {children}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={done ? <Check size={13} /> : <Copy size={13} />}
      onClick={async () => {
        await window.hue.copyText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? 'Copied' : 'Copy'}
    </Button>
  );
}

function ProviderRows() {
  const settings = useApp((s) => s.settings);
  const updateSettings = useApp((s) => s.updateSettings);
  const toast = useApp((s) => s.toast);
  const id = settings.assistantProvider;
  const meta = providerMeta(id);
  const cfg = settings.providers[id] ?? { apiKey: '', model: meta.defaultModel };
  const [key, setKey] = useState(cfg.apiKey);
  const [show, setShow] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setKey(cfg.apiKey);
    setModels([]);
  }, [id, cfg.apiKey]);

  const saveKey = async () => {
    try {
      await window.hue.updateProvider(id, { apiKey: key.trim() });
      toast(key.trim() ? 'Key saved' : 'Key removed', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  const setModel = (model: string) => window.hue.updateProvider(id, { model }).catch((e) => toast(e.message, 'error'));
  const fetchModels = async () => {
    setLoading(true);
    try {
      if (key.trim() !== cfg.apiKey) await window.hue.updateProvider(id, { apiKey: key.trim() });
      setModels(await window.hue.listModels(id));
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Row label="Provider">
        <div className="w-56 shrink-0">
          <Select value={id} onChange={(e) => updateSettings({ assistantProvider: e.target.value as ProviderId })}>
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}{settings.providers[p.id]?.apiKey ? '' : ' (no key)'}</option>
            ))}
          </Select>
        </div>
      </Row>
      <Row label="API key" sub={<button className="hover:text-[var(--fg)] underline-offset-2 hover:underline" onClick={() => window.hue.openExternal(meta.keyUrl)}>{meta.keyUrl.replace(/^https?:\/\//, '')}</button>}>
        <div className="relative w-64">
          <Input type={show ? 'text' : 'password'} value={key} onChange={(e) => setKey(e.target.value)} placeholder={meta.keyPlaceholder} className="pr-9" onKeyDown={(e) => e.key === 'Enter' && saveKey()} />
          <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-[var(--fg)]" onClick={() => setShow((v) => !v)} title={show ? 'Hide' : 'Show'}>
            {show ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
        </div>
        <Button variant={key.trim() !== cfg.apiKey ? 'primary' : 'subtle'} onClick={saveKey} disabled={key.trim() === cfg.apiKey}>Save</Button>
      </Row>
      <Row label="Model" sub={meta.modelHint}>
        <div className="w-64 shrink-0">
          {models.length ? (
            <Select value={cfg.model} onChange={(e) => setModel(e.target.value)}>
              {!models.some((m) => m.name === cfg.model) && <option value={cfg.model}>{cfg.model}</option>}
              {models.map((m) => (
                <option key={m.name} value={m.name}>{m.name}</option>
              ))}
            </Select>
          ) : (
            <Input value={cfg.model} onChange={(e) => setModel(e.target.value)} placeholder={meta.defaultModel} />
          )}
        </div>
        <Button variant="outline" loading={loading} onClick={fetchModels} disabled={!key.trim()}>List</Button>
      </Row>
      <Row label="Reply language">
        <div className="w-48 shrink-0">
          <Select value={settings.language} onChange={(e) => updateSettings({ language: e.target.value as typeof settings.language })}>
            <option value="auto">Match my message</option>
            <option value="en">English</option>
            <option value="pt">Português</option>
          </Select>
        </div>
      </Row>
      <Row label="Speak replies aloud">
        <Toggle checked={settings.speakReplies} onChange={(v) => updateSettings({ speakReplies: v })} />
      </Row>
    </>
  );
}

const TARGETS: AgentTarget[] = ['claude-desktop', 'claude-code', 'gemini-cli', 'codex', 'cursor', 'vscode'];

function AgentRows() {
  const settings = useApp((s) => s.settings);
  const updateSettings = useApp((s) => s.updateSettings);
  const toast = useApp((s) => s.toast);
  const [info, setInfo] = useState<AgentInfo | null>(null);
  const [open, setOpen] = useState<AgentTarget | null>(null);
  const [installing, setInstalling] = useState<AgentTarget | null>(null);
  const [showToken, setShowToken] = useState(false);
  const [port, setPort] = useState(String(settings.httpApiPort));

  const load = useCallback(async () => setInfo(await window.hue.getAgentInfo()), []);
  useEffect(() => {
    load();
  }, [load, settings.httpApiEnabled, settings.httpApiPort]);

  const install = async (target: AgentTarget) => {
    setInstalling(target);
    try {
      const res = await window.hue.installAgent(target);
      toast(res.message, res.ok ? 'success' : 'error');
      await load();
    } finally {
      setInstalling(null);
    }
  };

  if (!info) return <div className="flex justify-center py-6"><Spinner /></div>;
  return (
    <>
      {TARGETS.map((key) => {
        const s = info.snippets[key];
        const installed = info.installed[key];
        return (
          <div key={key}>
            <Row
              label={
                <span className="inline-flex items-center gap-2">
                  {s.title}
                  {installed && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400"><ShieldCheck size={10} /> ready</span>}
                </span>
              }
              sub={<span className="font-mono text-[11px]">{s.file}</span>}
            >
              <Button size="sm" variant="ghost" onClick={() => setOpen(open === key ? null : key)}>{open === key ? 'Hide' : 'Config'}</Button>
              <Button size="sm" variant={installed ? 'outline' : 'primary'} icon={key === 'claude-code' ? <Terminal size={13} /> : <Download size={13} />} loading={installing === key} onClick={() => install(key)}>
                {installed ? 'Reinstall' : 'Install'}
              </Button>
            </Row>
            {open === key && (
              <div className="px-4 pb-3 fade-in">
                <pre className="scroll max-h-48 rounded-xl surface-2 p-3 text-[11px] whitespace-pre-wrap break-all">{s.content}</pre>
                <div className="mt-2"><CopyButton text={s.content} /></div>
              </div>
            )}
          </div>
        );
      })}
      <Row label="Local HTTP API" sub={settings.httpApiEnabled ? info.httpApi.url : 'Off'}>
        {settings.httpApiEnabled && (
          <>
            <div className="w-20 shrink-0">
              <Input value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} className="h-8 text-xs" title="Port" />
            </div>
            {Number(port) !== settings.httpApiPort && Number(port) > 0 && <Button size="sm" variant="outline" onClick={() => updateSettings({ httpApiPort: Number(port) })}>Apply</Button>}
          </>
        )}
        <Toggle checked={settings.httpApiEnabled} onChange={(v) => updateSettings({ httpApiEnabled: v })} />
      </Row>
      {settings.httpApiEnabled && (
        <Row label="Token" sub={<span className={cx('font-mono text-[11px]', !showToken && 'blur-[3px] select-none')}>{info.httpApi.token}</span>}>
          <Button size="sm" variant="ghost" onClick={() => setShowToken((v) => !v)}>{showToken ? 'Hide' : 'Show'}</Button>
          <CopyButton text={info.httpApi.token} />
        </Row>
      )}
    </>
  );
}

const ENGINE_LABEL: Record<EmulatorStatus['state'], string> = {
  absent: 'Android SDK not found',
  stopped: 'Off',
  starting: 'Starting…',
  booting: 'Starting…',
  preparing: 'Starting…',
  ready: 'Ready',
  error: 'Problem',
};

function CameraEngineRow() {
  const [engine, setEngine] = useState<EmulatorStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    window.hue.getEmulatorStatus().then((s) => alive && setEngine(s)).catch(() => undefined);
    const off = window.hue.onEmulatorStatus((s) => alive && setEngine(s));
    return () => {
      alive = false;
      off();
    };
  }, []);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  if (!engine) return null;
  const running = ['starting', 'booting', 'preparing', 'ready'].includes(engine.state);
  return (
    <Row label="Camera engine" sub={engine.error ?? engine.hint ?? `${ENGINE_LABEL[engine.state]}${engine.cameras.length ? ` · ${engine.cameras.join(', ')}` : ''}`}>
      {engine.available && (
        <Button size="sm" variant="outline" loading={busy} icon={<Power size={13} />} onClick={() => run(() => (running ? window.hue.emulatorStop() : window.hue.emulatorEnsureRunning()))}>
          {running ? 'Stop' : 'Start'}
        </Button>
      )}
    </Row>
  );
}

/** Settings: bridge, assistant, look and behaviour, AI agents, about. */
export default function SettingsPage() {
  const settings = useApp((s) => s.settings);
  const updateSettings = useApp((s) => s.updateSettings);
  const connection = useApp((s) => s.connection);
  const status = useApp((s) => s.status);
  const home = useApp((s) => s.home);
  const toast = useApp((s) => s.toast);
  const refreshConnection = useApp((s) => s.refreshConnection);
  const navigate = useApp((s) => s.navigate);
  const [forget, setForget] = useState(false);
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    window.hue.getAppInfo().then(setInfo);
  }, []);

  return (
    <div className="fade-in max-w-3xl pt-1">
      <Group title="Bridge">
        {connection ? (
          <Row
            label={
              <span className="inline-flex items-center gap-2">
                <Cpu size={15} className="text-accent" />
                {home.bridge?.name ?? connection.name ?? 'Hue Bridge'}
                <span className={cx('h-2 w-2 rounded-full', status.state === 'connected' ? (status.stream === 'open' ? 'bg-emerald-400' : 'bg-amber-400') : status.state === 'connecting' ? 'bg-amber-400 animate-pulse' : 'bg-rose-400')} />
              </span>
            }
            sub={`${connection.host} · ${status.state === 'connected' ? (status.stream === 'open' ? 'live' : 'polling') : status.state === 'connecting' ? 'connecting…' : status.error ?? status.state}${home.bridge?.softwareVersion ? ` · v${home.bridge.softwareVersion}` : ''}`}
          >
            <Button size="sm" variant="outline" icon={<RefreshCw size={13} />} onClick={() => window.hue.reconnect().catch((e) => toast(e.message, 'error'))}>Reconnect</Button>
            <Button size="sm" variant="danger" icon={<Unplug size={13} />} onClick={() => setForget(true)}>Forget</Button>
          </Row>
        ) : (
          <Row label="No bridge paired">
            <Button variant="primary" onClick={() => navigate({ view: 'home' })}>Pair</Button>
          </Row>
        )}
        <CameraEngineRow />
      </Group>

      <Group title="Assistant">
        <ProviderRows />
      </Group>

      <Group title="Look & behaviour">
        <Row label="Theme">
          <div className="flex gap-1 rounded-xl surface-2 p-1">
            {([
              ['system', SunMoon, 'System'],
              ['light', Sun, 'Light'],
              ['dark', Moon, 'Dark'],
            ] as const).map(([t, Icon, label]) => (
              <button key={t} onClick={() => updateSettings({ theme: t })} className={cx('flex items-center gap-1.5 rounded-lg px-3 h-8 text-xs font-medium', settings.theme === t ? 'surface shadow-sm' : 'text-muted hover:text-[var(--fg)]')}>
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>
        </Row>
        <Row label="Fade time" sub={`${(settings.transitionMs / 1000).toFixed(1)} s`}>
          <div className="w-56 shrink-0">
            <input type="range" className="slider" min={0} max={3000} step={100} value={settings.transitionMs} onChange={(e) => updateSettings({ transitionMs: Number(e.target.value) })} />
          </div>
        </Row>
        <Row label="Keep running in the tray">
          <Toggle checked={settings.minimizeToTray} onChange={(v) => updateSettings({ minimizeToTray: v })} />
        </Row>
        <Row label="Start with Windows">
          <Toggle checked={settings.launchAtLogin} onChange={(v) => updateSettings({ launchAtLogin: v })} />
        </Row>
      </Group>

      <Group title="AI agents">
        <AgentRows />
      </Group>

      <Group title="About">
        <Row label={`Hue Pilot ${info?.version ?? ''}`} sub={info ? `Electron ${info.electron} · ${info.platform}` : ''}>
          {info && <Button size="sm" variant="ghost" icon={<FolderOpen size={13} />} onClick={() => window.hue.openPath(info.configPath.replace(/[\\/][^\\/]+$/, ''))}>Config folder</Button>}
        </Row>
      </Group>

      <Modal open={forget} title="Forget this bridge?" onClose={() => setForget(false)} footer={<><Button variant="ghost" onClick={() => setForget(false)}>Cancel</Button><Button variant="danger" onClick={async () => { await window.hue.forgetBridge(); await refreshConnection(); setForget(false); navigate({ view: 'home' }); }}>Forget</Button></>}>
        <p className="text-sm">The app key is deleted from this computer. Nothing on the bridge changes.</p>
      </Modal>
    </div>
  );
}
