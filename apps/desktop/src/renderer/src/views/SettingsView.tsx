import { Cpu, Eye, EyeOff, FolderOpen, KeyRound, Moon, RefreshCw, Sun, SunMoon, Unplug } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, Card, cx, Field, Input, Modal, SectionTitle, Select, Toggle } from '../components/ui';
import { useApp } from '../store';
import type { AppInfo } from '../../../shared/ipc-types.ts';

export default function SettingsView() {
  const settings = useApp((s) => s.settings);
  const updateSettings = useApp((s) => s.updateSettings);
  const connection = useApp((s) => s.connection);
  const status = useApp((s) => s.status);
  const home = useApp((s) => s.home);
  const toast = useApp((s) => s.toast);
  const refreshConnection = useApp((s) => s.refreshConnection);
  const navigate = useApp((s) => s.navigate);
  const [key, setKey] = useState(settings.geminiApiKey);
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<{ name: string; displayName: string }[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [forget, setForget] = useState(false);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [port, setPort] = useState(String(settings.httpApiPort));

  useEffect(() => {
    window.hue.getAppInfo().then(setInfo);
  }, []);
  useEffect(() => setKey(settings.geminiApiKey), [settings.geminiApiKey]);

  const saveKey = async () => {
    await updateSettings({ geminiApiKey: key.trim() });
    toast(key.trim() ? 'Gemini API key saved' : 'Gemini API key removed', 'success');
  };

  const fetchModels = async () => {
    setLoadingModels(true);
    try {
      if (key.trim() !== settings.geminiApiKey) await updateSettings({ geminiApiKey: key.trim() });
      const list = await window.hue.listGeminiModels();
      setModels(list);
      toast(`${list.length} models available`, 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setLoadingModels(false);
    }
  };

  const theme = settings.theme;

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

      <SectionTitle>Gemini assistant</SectionTitle>
      <Card className="mb-6">
        <Field label="Gemini API key" hint="Create a free key at aistudio.google.com/apikey. Stored locally in this app's config file.">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <Input type={showKey ? 'text' : 'password'} value={key} onChange={(e) => setKey(e.target.value)} placeholder="AIza…" className="pl-9 pr-10" onKeyDown={(e) => e.key === 'Enter' && saveKey()} />
              <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-[var(--fg)]" onClick={() => setShowKey((v) => !v)} title={showKey ? 'Hide' : 'Show'}>
                {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            <Button variant="primary" onClick={saveKey} disabled={key.trim() === settings.geminiApiKey}>Save</Button>
            <Button variant="outline" onClick={() => window.hue.openExternal('https://aistudio.google.com/apikey')}>Get a key</Button>
          </div>
        </Field>
        <Field label="Model" hint="gemini-2.5-flash is fast and cheap; fetch the list to pick another.">
          <div className="flex gap-2">
            {models.length ? (
              <Select value={settings.geminiModel} onChange={(e) => updateSettings({ geminiModel: e.target.value })}>
                {!models.some((m) => m.name === settings.geminiModel) && <option value={settings.geminiModel}>{settings.geminiModel}</option>}
                {models.map((m) => (
                  <option key={m.name} value={m.name}>{m.name} — {m.displayName}</option>
                ))}
              </Select>
            ) : (
              <Input value={settings.geminiModel} onChange={(e) => updateSettings({ geminiModel: e.target.value })} placeholder="gemini-2.5-flash" />
            )}
            <Button variant="outline" loading={loadingModels} onClick={fetchModels} disabled={!key.trim()}>Fetch models</Button>
          </div>
        </Field>
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
