import { Check, Copy, Download, ExternalLink, Plug2, RefreshCw, ShieldCheck, Terminal } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, cx, IconButton, SectionTitle, Spinner, Toggle } from '../components/ui';
import { useApp } from '../store';
import type { AgentInfo, AgentTarget } from '../../../shared/ipc-types.ts';

const TARGETS: { key: AgentTarget; blurb: string }[] = [
  { key: 'claude-desktop', blurb: 'Chat with Claude and let it control the lights.' },
  { key: 'claude-code', blurb: 'Adds the "hue" server to Claude Code (user scope).' },
  { key: 'gemini-cli', blurb: 'Gemini CLI picks up the server from ~/.gemini/settings.json.' },
  { key: 'codex', blurb: 'OpenAI Codex CLI, via ~/.codex/config.toml.' },
  { key: 'cursor', blurb: 'Cursor editor agent.' },
  { key: 'vscode', blurb: 'GitHub Copilot agent mode in VS Code.' },
];

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      icon={done ? <Check size={13} /> : <Copy size={13} />}
      onClick={async () => {
        await window.hue.copyText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? 'Copied' : label}
    </Button>
  );
}

export default function AgentsView() {
  const settings = useApp((s) => s.settings);
  const updateSettings = useApp((s) => s.updateSettings);
  const toast = useApp((s) => s.toast);
  const connection = useApp((s) => s.connection);
  const [info, setInfo] = useState<AgentInfo | null>(null);
  const [open, setOpen] = useState<AgentTarget | null>(null);
  const [installing, setInstalling] = useState<AgentTarget | null>(null);
  const [showToken, setShowToken] = useState(false);

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

  if (!info) return <div className="flex justify-center py-10"><Spinner /></div>;
  const curl = `curl -H "Authorization: Bearer ${info.httpApi.token}" -H "Content-Type: application/json" -d "{\\"room\\":\\"Office\\",\\"on\\":true}" ${info.httpApi.url}/api/tools/set_room`;

  return (
    <div className="fade-in max-w-4xl">
      <div className="mb-5">
        <h1 className="text-2xl font-semibold tracking-tight">AI agents</h1>
        <p className="text-sm text-muted mt-0.5">Give any AI agent the same tools the built-in assistant uses. Works with Claude, Gemini CLI, Codex, Cursor, VS Code and anything that speaks MCP (Model Context Protocol).</p>
      </div>

      <Card className="mb-6">
        <div className="flex items-start gap-3">
          <div className="h-11 w-11 rounded-2xl surface-2 flex items-center justify-center"><Plug2 size={22} className="text-accent" /></div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold">Hue Pilot MCP server</div>
            <div className="text-xs text-muted mt-0.5">A small local program that exposes 11 tools (set_room, set_light, activate_scene, create_schedule, …). It reads the bridge pairing from this app's config file, so it works even when Hue Pilot is closed.</div>
            <div className="mt-3 grid grid-cols-[110px_1fr] gap-y-1.5 text-xs">
              <span className="text-muted">Bridge</span>
              <span className={connection ? 'text-emerald-400' : 'text-rose-400'}>{connection ? `${connection.name ?? 'Hue Bridge'} (${connection.host}) paired` : 'Not paired — pair a bridge first'}</span>
              <span className="text-muted">Node.js</span>
              <span>{info.nodeCommand ? <span className="font-mono break-all">{info.nodeCommand}</span> : <span className="text-amber-400">Not found on PATH — configs below use Hue Pilot itself to run the server</span>}</span>
              <span className="text-muted">Server script</span>
              <span className="font-mono break-all">{info.mcpPath}</span>
              <span className="text-muted">Config file</span>
              <span className="font-mono break-all">{info.configPath}</span>
            </div>
          </div>
          <IconButton title="Refresh" onClick={load}><RefreshCw size={16} /></IconButton>
        </div>
      </Card>

      <SectionTitle>One-click setup</SectionTitle>
      <div className="grid gap-3 mb-6" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
        {TARGETS.map(({ key, blurb }) => {
          const s = info.snippets[key];
          const installed = info.installed[key];
          return (
            <Card key={key} className="flex flex-col">
              <div className="flex items-start gap-2">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold flex items-center gap-2">
                    {s.title}
                    {installed && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400"><ShieldCheck size={10} /> configured</span>}
                  </div>
                  <div className="text-xs text-muted mt-0.5">{blurb}</div>
                  <div className="text-[10px] text-muted mt-1 font-mono truncate" title={s.file}>{s.file}</div>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant={installed ? 'outline' : 'primary'} icon={key === 'claude-code' ? <Terminal size={13} /> : <Download size={13} />} loading={installing === key} onClick={() => install(key)}>
                  {installed ? 'Re-install' : key === 'claude-code' ? 'Run claude mcp add' : 'Install'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setOpen(open === key ? null : key)}>{open === key ? 'Hide config' : 'Show config'}</Button>
              </div>
              {open === key && (
                <div className="mt-3 fade-in">
                  <pre className="scroll max-h-52 rounded-xl surface-2 p-3 text-[11px] whitespace-pre-wrap break-all">{s.content}</pre>
                  <div className="mt-2 flex gap-2"><CopyButton text={s.content} /></div>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <SectionTitle>Local HTTP API</SectionTitle>
      <Card className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold">REST endpoint on this computer</div>
            <div className="text-xs text-muted mt-0.5">For scripts, Stream Deck buttons, Home Assistant, or any agent that can call HTTP. Only reachable from this machine (127.0.0.1) while Hue Pilot is running.</div>
          </div>
          <Toggle checked={settings.httpApiEnabled} onChange={(v) => updateSettings({ httpApiEnabled: v })} />
        </div>
        {settings.httpApiEnabled && (
          <div className="mt-3 space-y-2 text-xs">
            <div className="grid grid-cols-[110px_1fr_auto] items-center gap-2">
              <span className="text-muted">Base URL</span>
              <span className="font-mono">{info.httpApi.url}</span>
              <CopyButton text={info.httpApi.url} />
              <span className="text-muted">Token</span>
              <span className={cx('font-mono break-all', !showToken && 'blur-[3px] select-none')}>{info.httpApi.token}</span>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setShowToken((v) => !v)}>{showToken ? 'Hide' : 'Show'}</Button>
                <CopyButton text={info.httpApi.token} />
              </div>
            </div>
            <div className="text-muted pt-1">Endpoints: <code>GET /api/tools</code> · <code>GET /api/home</code> · <code>POST /api/tools/&lt;name&gt;</code> · <code>POST /api/chat</code> (Gemini)</div>
            <pre className="scroll rounded-xl surface-2 p-3 text-[11px] whitespace-pre-wrap break-all">{curl}</pre>
            <CopyButton text={curl} label="Copy example" />
          </div>
        )}
      </Card>

      <SectionTitle>How it works</SectionTitle>
      <Card className="text-sm text-muted space-y-2">
        <p>Every agent gets the same 11 tools with plain-language arguments ("Office", "warm white", "40%"). Names are matched fuzzily, so "the office lights" works. Ambiguous names return the candidates so the agent can ask you.</p>
        <p>Tools available: get_home_overview, set_room, set_light, set_all_lights, activate_scene, set_effect, identify_light, get_sensor_readings, list_schedules, create_schedule, delete_schedule.</p>
        <p className="flex items-center gap-1">Learn more about MCP at <button className="inline-flex items-center gap-1 text-accent hover:underline" onClick={() => window.hue.openExternal('https://modelcontextprotocol.io')}>modelcontextprotocol.io <ExternalLink size={12} /></button></p>
      </Card>
    </div>
  );
}
