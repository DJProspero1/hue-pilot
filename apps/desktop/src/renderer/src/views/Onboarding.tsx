import type { BridgeConfigV1, DiscoveredBridge } from '@hue/core';
import { ChevronDown, Cpu, Lightbulb, Plug2, RefreshCw, Search, Settings, Wifi } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, cx, Field, Input, Select, Spinner } from '../components/ui';
import { useApp } from '../store';
import type { PairTarget } from '../../../shared/ipc-types.ts';

type Found = DiscoveredBridge & { config?: BridgeConfigV1; error?: string };

export default function Onboarding() {
  const toast = useApp((s) => s.toast);
  const refreshConnection = useApp((s) => s.refreshConnection);
  const navigate = useApp((s) => s.navigate);
  const [found, setFound] = useState<Found[]>([]);
  const [scanning, setScanning] = useState(true);
  const [manual, setManual] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [port, setPort] = useState('');
  const [protocol, setProtocol] = useState<'https' | 'http'>('https');
  const [pairing, setPairing] = useState<{ target: PairTarget; name?: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [pairError, setPairError] = useState<string | null>(null);
  const stopRef = useRef(false);

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const list = await window.hue.discover();
      const withConfig = await Promise.all(
        list.map(async (b): Promise<Found> => {
          try {
            const config = await window.hue.probe({ host: b.internalipaddress, port: b.port && b.port !== 443 ? b.port : undefined });
            return { ...b, config };
          } catch (err) {
            return { ...b, error: (err as Error).message };
          }
        }),
      );
      setFound(withConfig);
    } finally {
      setScanning(false);
    }
  }, []);

  useEffect(() => {
    scan();
  }, [scan]);

  const startPairing = async (target: PairTarget, name?: string) => {
    setPairError(null);
    setPairing({ target, name });
    setElapsed(0);
    stopRef.current = false;
    const started = Date.now();
    while (!stopRef.current && Date.now() - started < 90_000) {
      const res = await window.hue.pair(target);
      if (res.ok) {
        toast(`Paired with ${res.bridge.name ?? 'your Hue bridge'}`, 'success');
        await refreshConnection();
        navigate({ view: 'home' });
        return;
      }
      if (!res.linkButton) {
        setPairError(res.error);
        setPairing(null);
        return;
      }
      await new Promise((r) => setTimeout(r, 1500));
      setElapsed(Math.round((Date.now() - started) / 1000));
    }
    if (!stopRef.current) setPairError('Timed out. Press the button on the bridge and try again.');
    setPairing(null);
  };

  const manualTarget = (): PairTarget | null => {
    const host = manual.trim();
    if (!host) return null;
    return { host, port: port ? Number(port) : undefined, protocol };
  };

  return (
    <div className="h-full flex flex-col">
      <div className="drag h-[52px] shrink-0 flex items-center justify-end pr-[150px]">
        <div className="no-drag flex gap-1">
          <Button size="sm" variant="ghost" icon={<Plug2 size={14} />} onClick={() => navigate({ view: 'agents' })}>AI agents</Button>
          <Button size="sm" variant="ghost" icon={<Settings size={14} />} onClick={() => navigate({ view: 'settings' })}>Settings</Button>
        </div>
      </div>
      <div className="scroll flex-1 flex items-start justify-center px-6 pb-10">
        <div className="w-full max-w-2xl fade-in">
          <div className="flex items-center gap-4 mb-8 mt-4">
            <div className="h-16 w-16 rounded-3xl bg-gradient-to-br from-accent via-accent-2 to-accent-3 shadow-lg flex items-center justify-center"><Lightbulb size={30} className="text-white" /></div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Welcome to Hue Pilot</h1>
              <p className="text-muted mt-1">Control your Philips Hue lights from the desktop and with AI. First, connect to your bridge.</p>
            </div>
          </div>

          {pairing ? (
            <div className="surface rounded-3xl p-8 text-center">
              <div className="relative mx-auto h-40 w-40 mb-6">
                <div className="absolute inset-0 rounded-full bg-accent/30 pulse-ring" />
                <div className="absolute inset-0 rounded-full bg-accent/20 pulse-ring" style={{ animationDelay: '0.6s' }} />
                <div className="absolute inset-4 rounded-full surface-2 shadow-soft flex items-center justify-center">
                  <div className="h-16 w-16 rounded-full bg-gradient-to-br from-accent to-accent-2 shadow-lg" />
                </div>
              </div>
              <h2 className="text-xl font-semibold">Press the round button on your Hue bridge</h2>
              <p className="text-muted mt-2">Waiting for {pairing.name ?? pairing.target.host}… {elapsed > 0 && `(${elapsed}s)`}</p>
              <p className="text-xs text-muted mt-1">The button is on top of the bridge, in the centre. This pairs Hue Pilot and the AI agents in one go.</p>
              <Button variant="ghost" className="mt-6" onClick={() => { stopRef.current = true; setPairing(null); }}>Cancel</Button>
            </div>
          ) : (
            <>
              <div className="surface rounded-3xl p-5 mb-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 font-medium"><Search size={16} className="text-accent" /> Bridges on your network</div>
                  <Button size="sm" variant="ghost" icon={scanning ? <Spinner size={14} /> : <RefreshCw size={14} />} onClick={scan} disabled={scanning}>{scanning ? 'Scanning…' : 'Scan again'}</Button>
                </div>
                {scanning && !found.length && <div className="text-sm text-muted py-6 text-center">Looking for bridges via the Hue discovery service…</div>}
                {!scanning && !found.length && <div className="text-sm text-muted py-4 text-center">No bridge found automatically. Enter its IP address below (you can find it in the Hue app under Settings → Bridge settings).</div>}
                <div className="space-y-2">
                  {found.map((b) => (
                    <div key={b.id} className="flex items-center gap-3 rounded-2xl surface-2 px-4 py-3">
                      <div className="h-10 w-10 rounded-xl surface flex items-center justify-center"><Cpu size={18} className="text-accent" /></div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{b.config?.name ?? 'Hue Bridge'}</div>
                        <div className="text-xs text-muted truncate">{b.internalipaddress} · {b.config ? `${b.config.modelid} · firmware ${b.config.swversion}` : b.error ?? 'not reachable'} · id {b.id}</div>
                      </div>
                      <Button variant="primary" icon={<Wifi size={14} />} onClick={() => startPairing({ host: b.internalipaddress, port: b.port && b.port !== 443 ? b.port : undefined }, b.config?.name)} disabled={!b.config}>Connect</Button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="surface rounded-3xl p-5">
                <div className="font-medium mb-3">Connect by IP address</div>
                <div className="flex gap-2">
                  <Input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="192.168.1.74" onKeyDown={(e) => { const t = manualTarget(); if (e.key === 'Enter' && t) startPairing(t); }} />
                  <Button variant="primary" disabled={!manual.trim()} onClick={() => { const t = manualTarget(); if (t) startPairing(t); }}>Connect</Button>
                </div>
                <button className="mt-3 inline-flex items-center gap-1 text-xs text-muted hover:text-[var(--fg)]" onClick={() => setAdvanced((v) => !v)}>
                  <ChevronDown size={14} className={cx('transition-transform', advanced && 'rotate-180')} /> Advanced
                </button>
                {advanced && (
                  <div className="grid grid-cols-2 gap-4 mt-2 fade-in">
                    <Field label="Port" hint="Leave empty for the default">
                      <Input value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} placeholder={protocol === 'https' ? '443' : '80'} />
                    </Field>
                    <Field label="Protocol" hint="Real bridges use HTTPS">
                      <Select value={protocol} onChange={(e) => setProtocol(e.target.value as 'https' | 'http')}>
                        <option value="https">https</option>
                        <option value="http">http (mock / dev bridge)</option>
                      </Select>
                    </Field>
                  </div>
                )}
              </div>
              {pairError && <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm">{pairError}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
