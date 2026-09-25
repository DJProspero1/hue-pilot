import { Check, Cpu, Eye, EyeOff, FolderOpen, KeyRound, Moon, RefreshCw, Sun, SunMoon, Unplug } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Card, cx, Field, Input, Modal, SectionTitle, Select, Toggle } from '../components/ui';
import { useApp } from '../store';
import type { AppInfo } from '../../../shared/ipc-types.ts';
import { PROVIDERS, type ModelInfo, type ProviderId } from '../../../shared/providers.ts';

function ProviderCard({ id }: { id: ProviderId }) {
  const meta = PROVIDERS.find((p) => p.id === id)!;
  const settings = useApp((s) => s.settings);
  const updateSettings = useApp((s) => s.updateSettings);
  const toast = useApp((s) => s.toast);
  const cfg = settings.providers[id] ?? { apiKey: '', model: meta.defaultModel };
  const active = settings.assistantProvider === id;
  const [key, setKey] = useState(cfg.apiKey);
  const [show, setShow] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => setKey(cfg.apiKey), [cfg.apiKey]);

  const saveKey = async () => {
    await window.hue.updateProvider(id, { apiKey: key.trim() });
    toast(key.trim() ? `${meta.label} key saved` : `${meta.label} key removed`, 'success');
  };
  const setModel = (model: string) => window.hue.updateProvider(id, { model }).catch((e) => toast(e.message, 'error'));
  const fetchModels = async () => {
    setLoading(true);
    try {
      if (key.trim() !== cfg.apiKey) await window.hue.updateProvider(id, { apiKey: key.trim() });
      const list = await window.hue.listModels(id);
      setModels(list);
      toast(`${list.length} ${meta.label} models available`, 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className={cx('mb-3', active && 'border-accent/60 shadow-[0_0_0_2px_rgba(255,138,61,0.25)]')}>
      <div className="flex items-center gap-3 mb-3">
        <button
          onClick={() => updateSettings({ assistantProvider: id })}
          className={cx('h-6 w-6 rounded-full border-2 flex items-center justify-center transition-colors', active ? 'border-accent bg-accent text-white' : 'border-[var(--border-strong)] hover:border-accent')}
          title={active ? 'Provider in use' : `Use ${meta.label}`}
        >
          {active && <Check size={13} />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="font-semibold flex items-center gap-2">
            {meta.label}
            {active && <span className="rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">in use</span>}
            {cfg.apiKey && !active && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">key set</span>}
          </div>
          <div className="text-xs text-muted">{meta.modelHint}</div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => window.hue.openExternal(meta.keyUrl)}>Get a key</Button>
      </div>
      <div className="grid gap-3" style={{ gridTemplateColumns: '1.3fr 1fr' }}>
        <div>
          <div className="text-xs text-muted mb-1">API key</div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <Input type={show ? 'text' : 'password'} value={key} onChange={(e) => setKey(e.target.value)} placeholder={meta.keyPlaceholder} className="pl-8 pr-9" onKeyDown={(e) => e.key === 'Enter' && saveKey()} />
              <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-[var(--fg)]" onClick={() => setShow((v) => !v)} title={show ? 'Hide' : 'Show'}>
                {show ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <Button variant={key.trim() !== cfg.apiKey ? 'primary' : 'subtle'} onClick={saveKey} disabled={key.trim() === cfg.apiKey}>Save</Button>
          </div>
        </div>
        <div>
          <div className="text-xs text-muted mb-1">Model</div>
          <div className="flex gap-2">
            {models.length ? (
              <Select value={cfg.model} onChange={(e) => setModel(e.target.value)}>
                {!models.some((m) => m.name === cfg.model) && <option value={cfg.model}>{cfg.model}</option>}
                {models.map((m) => (
                  <option key={m.name} value={m.name}>{m.displayName && m.displayName !== m.name ? `${m.name} — ${m.displayName}` : m.name}</option>
                ))}
              </Select>
            ) : (
              <Input value={cfg.model} onChange={(e) => setModel(e.target.value)} placeholder={meta.defaultModel} />
            )}
            <Button variant="outline" loading={loading} onClick={fetchModels} disabled={!key.trim()} title="List the models available to this key">Fetch</Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

export default function SettingsView() {
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
  const [port, setPort] = useState(String(settings.httpApiPort));

  useEffect(() => {
    window.hue.getAppInfo().then(setInfo);
  }, []);

  const theme = settings.theme;
  const activeMeta = PROVIDERS.find((p) => p.id === settings.assistantProvider) ?? PROVIDERS[0];

  return (
    <div className="fade-in max-w-3xl">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      </div>

      <SectionTitle>Hue bridge</SectionTitle>
      <Card className="mb-6">
        {connection ? (
          <div className="flex items-start gap-3">
            <div className="h-11 w-11 rounded-2xl surface-2 flex items-center justify-center"><Cpu size={22} className="text-accent" /></div>
            <div className="flex-1 min-w-0 text-sm">
              <div className="font-semibold">{home.bridge?.name ?? connection.name ?? 'Hue Bridge'}</div>
              <div className="text-xs text-muted mt-0.5">
                {connection.protocol === 'http' ? 'http://' : 'https://'}{connection.host}{connection.port ? `:${connection.port}` : ''} · id {home.bridge?.bridgeId ?? connection.bridgeId ?? '—'}{home.bridge?.modelId ? ` · ${home.bridge.modelId}` : ''}{home.bridge?.softwareVersion ? ` · firmware ${home.bridge.softwareVersion}` : ''}
              </div>
              <div className={cx('text-xs mt-1', status.state === 'connected' ? 'text-emerald-400' : status.state === 'error' ? 'text-rose-400' : 'text-amber-400')}>
                {status.state === 'connected' ? `Connected · event stream ${status.stream}` : status.state === 'connecting' ? 'Connecting…' : status.error ?? status.state}
              </div>
              <div className="text-xs text-muted mt-1">{home.lights.length} lights · {home.rooms.length} rooms · {home.zones.length} zones · {home.scenes.length} scenes · {home.accessories.length} accessories</div>
            </div>
            <div className="flex flex-col gap-2">
              <Button size="sm" variant="outline" icon={<RefreshCw size={13} />} onClick={() => window.hue.reconnect().then(() => toast('Reconnecting…'))}>Reconnect</Button>
              <Button size="sm" variant="danger" icon={<Unplug size={13} />} onClick={() => setForget(true)}>Forget bridge</Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div className="text-sm">No bridge paired.</div>
            <Button variant="primary" onClick={() => navigate({ view: 'home' })}>Pair a bridge</Button>
          </div>
        )}
      </Card>

      <SectionTitle>Assistant</SectionTitle>
      <Card className="mb-3">
        <Field label="Provider in use" hint="Each provider keeps its own key and model. Keys are stored only in this app's config file and are sent only to that provider." inline>
          <Select value={settings.assistantProvider} onChange={(e) => updateSettings({ assistantProvider: e.target.value as ProviderId })} className="w-56">
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}{settings.providers[p.id]?.apiKey ? '' : ' (no key)'}</option>
            ))}
          </Select>
        </Field>
        <div className="text-xs text-muted">Currently answering with <span className="text-[var(--fg)] font-medium">{activeMeta.label} · {settings.providers[settings.assistantProvider]?.model}</span>.</div>
      </Card>
      {PROVIDERS.map((p) => (
        <ProviderCard key={p.id} id={p.id} />
      ))}
      <Card className="mb-6 mt-3">
        <Field label="Reply language" inline>
          <Select value={settings.language} onChange={(e) => updateSettings({ language: e.target.value as typeof settings.language })} className="w-44">
            <option value="auto">Match my message</option>
            <option value="en">English</option>
            <option value="pt">Português</option>
          </Select>
        </Field>
        <Field label="Speak replies aloud" hint="Uses the system text-to-speech voice." inline>
          <Toggle checked={settings.speakReplies} onChange={(v) => updateSettings({ speakReplies: v })} />
        </Field>
      </Card>

      <SectionTitle>Appearance & behaviour</SectionTitle>
      <Card className="mb-6">
        <Field label="Theme" inline>
          <div className="flex gap-1 rounded-xl surface-2 p-1">
            {([
              ['system', SunMoon, 'System'],
              ['light', Sun, 'Light'],
              ['dark', Moon, 'Dark'],
            ] as const).map(([t, Icon, label]) => (
              <button key={t} onClick={() => updateSettings({ theme: t })} className={cx('flex items-center gap-1.5 rounded-lg px-3 h-8 text-xs font-medium', theme === t ? 'surface shadow-sm' : 'text-muted hover:text-[var(--fg)]')}>
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>
        </Field>
        <Field label={`Transition time · ${(settings.transitionMs / 1000).toFixed(1)} s`} hint="How smoothly lights fade when you change them." inline>
          <input type="range" className="slider w-56" min={0} max={3000} step={100} value={settings.transitionMs} onChange={(e) => updateSettings({ transitionMs: Number(e.target.value) })} />
        </Field>
        <Field label="Keep running in the system tray" hint="Closing the window hides it; right-click the tray icon for quick toggles." inline>
          <Toggle checked={settings.minimizeToTray} onChange={(v) => updateSettings({ minimizeToTray: v })} />
        </Field>
        <Field label="Start with Windows" hint="Launches minimized to the tray so the local API and tray toggles are always available." inline>
          <Toggle checked={settings.launchAtLogin} onChange={(v) => updateSettings({ launchAtLogin: v })} />
        </Field>
        <Field label="Local HTTP API port" hint="Used by scripts and agents on this computer (see AI agents)." inline>
          <div className="flex gap-2">
            <Input value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} className="w-24" />
            <Button size="sm" variant="outline" disabled={Number(port) === settings.httpApiPort || !Number(port)} onClick={() => updateSettings({ httpApiPort: Number(port) }).then(() => toast('Port updated', 'success'))}>Apply</Button>
          </div>
        </Field>
      </Card>

      <SectionTitle>About</SectionTitle>
      <Card className="text-sm text-muted">
        <div>Hue Pilot {info?.version ?? ''} · Electron {info?.electron ?? ''} · {info?.platform ?? ''}</div>
        <div className="mt-1 flex items-center gap-2">
          <span className="font-mono text-xs break-all">{info?.configPath}</span>
          {info && <Button size="sm" variant="ghost" icon={<FolderOpen size={13} />} onClick={() => window.hue.openPath(info.configPath.replace(/[\\/][^\\/]+$/, ''))}>Open folder</Button>}
        </div>
        <div className="mt-2">Built for a Philips Hue bridge on the local network. Not affiliated with Signify.</div>
      </Card>

      <Modal open={forget} title="Forget this bridge?" onClose={() => setForget(false)} footer={<><Button variant="ghost" onClick={() => setForget(false)}>Cancel</Button><Button variant="danger" onClick={async () => { await window.hue.forgetBridge(); await refreshConnection(); setForget(false); navigate({ view: 'home' }); }}>Forget</Button></>}>
        <p className="text-sm">The app key is deleted from this computer and the AI agents lose access until you pair again. Nothing on the bridge is changed.</p>
      </Modal>
    </div>
  );
}
