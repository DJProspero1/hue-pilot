import { AlertTriangle, Bot, Check, Mic, RotateCcw, Send, Volume2, VolumeX, Wrench, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store';
import type { ChatMessage } from '../../../shared/ipc-types.ts';
import { PROVIDERS, providerMeta, type ProviderId } from '../../../shared/providers.ts';
import { Button, cx, IconButton, Spinner } from './ui';

const SUGGESTIONS = ['Turn on the office', 'Living room warm white at 40%', 'Relax scene in the bedroom', 'Everything off at 23:00 on weekdays'];

function ToolLine({ m }: { m: ChatMessage }) {
  const ok = m.tool?.result.ok;
  return (
    <div className={cx('flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px]', ok ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-amber-500/30 bg-amber-500/10')}>
      {ok ? <Check size={12} className="text-emerald-400 shrink-0" /> : <AlertTriangle size={12} className="text-amber-400 shrink-0" />}
      <Wrench size={11} className="text-muted shrink-0" />
      <span className="font-mono text-muted">{m.tool?.name}</span>
      <span className="truncate">{m.text}</span>
    </div>
  );
}

/** The assistant, docked at the right of the dashboard. */
export default function AssistantPanel() {
  const chat = useApp((s) => s.chat);
  const busy = useApp((s) => s.chatBusy);
  const send = useApp((s) => s.sendChat);
  const reset = useApp((s) => s.resetChat);
  const settings = useApp((s) => s.settings);
  const updateSettings = useApp((s) => s.updateSettings);
  const navigate = useApp((s) => s.navigate);
  const toggleAssistant = useApp((s) => s.toggleAssistant);
  const connected = useApp((s) => s.status.state === 'connected');
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const provider = settings.assistantProvider;
  const meta = providerMeta(provider);
  const cfg = settings.providers[provider] ?? { apiKey: '', model: meta.defaultModel };
  const hasKey = !!cfg.apiKey;
  const speechSupported = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat.length, busy]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = async (value = text) => {
    const v = value.trim();
    if (!v || busy) return;
    setText('');
    await send(v);
    inputRef.current?.focus();
  };

  const startListening = () => {
    const Ctor = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!Ctor) return;
    try {
      const rec = new Ctor();
      rec.lang = settings.language === 'pt' ? 'pt-PT' : navigator.language || 'en-US';
      rec.interimResults = false;
      rec.onresult = (e: any) => {
        const t = e.results?.[0]?.[0]?.transcript;
        if (t) submit(t);
      };
      rec.onend = () => setListening(false);
      rec.onerror = () => setListening(false);
      setListening(true);
      rec.start();
    } catch {
      setListening(false);
    }
  };

  return (
    <aside className="dock-in flex h-full w-[380px] shrink-0 flex-col border-l border-base" style={{ background: 'var(--bg-elev)' }}>
      <div className="flex items-center gap-1.5 px-3 h-[52px] border-b border-base">
        <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-accent to-accent-2 flex items-center justify-center">
          <Bot size={15} className="text-[#1c1814]" />
        </div>
        <select
          value={provider}
          onChange={(e) => updateSettings({ assistantProvider: e.target.value as ProviderId })}
          className="h-8 min-w-0 flex-1 rounded-lg bg-transparent px-1 text-sm font-semibold outline-none hover:surface-2"
          title="Assistant provider"
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}{settings.providers[p.id]?.apiKey ? '' : ' (no key)'}</option>
          ))}
        </select>
        <IconButton title={settings.speakReplies ? 'Stop speaking replies' : 'Speak replies'} className="h-8 w-8" onClick={() => updateSettings({ speakReplies: !settings.speakReplies })}>
          {settings.speakReplies ? <Volume2 size={16} className="text-accent" /> : <VolumeX size={16} />}
        </IconButton>
        <IconButton title="New conversation" className="h-8 w-8" onClick={reset} disabled={!chat.length || busy}>
          <RotateCcw size={16} />
        </IconButton>
        <IconButton title="Close" className="h-8 w-8" onClick={() => toggleAssistant(false)}>
          <X size={17} />
        </IconButton>
      </div>

      {!hasKey && (
        <div className="m-3 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2.5 text-sm flex items-center gap-3">
          <span className="flex-1">No {meta.label} key yet.</span>
          <Button size="sm" variant="primary" onClick={() => navigate({ view: 'settings' })}>Settings</Button>
        </div>
      )}
      {!connected && <div className="mx-3 mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">Bridge not connected.</div>}

      <div className="scroll flex-1 px-3 py-3 space-y-2.5">
        {!chat.length && (
          <div className="pt-6 text-center">
            <div className="text-sm font-medium">What should the lights do?</div>
            <div className="flex flex-wrap justify-center gap-1.5 mt-4">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => submit(s)} disabled={!hasKey} className="rounded-full border border-[var(--border)] surface-2 px-3 h-8 text-xs hover:border-accent/60 disabled:opacity-50 transition-colors">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {chat.map((m) => {
          if (m.role === 'tool') return <div key={m.id} className="pl-6"><ToolLine m={m} /></div>;
          if (m.role === 'system') return <div key={m.id} className="text-center text-[11px] text-muted py-1">{m.text}</div>;
          if (m.role === 'error')
            return (
              <div key={m.id} className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm">
                <X size={14} className="text-rose-400 mt-0.5 shrink-0" /> {m.text}
              </div>
            );
          const user = m.role === 'user';
          return (
            <div key={m.id} className={cx('flex', user ? 'justify-end' : 'justify-start')}>
              <div className={cx('rounded-2xl px-3.5 py-2 text-sm max-w-[88%] whitespace-pre-wrap leading-relaxed', user ? 'bg-accent text-[#1c1814] rounded-br-md' : 'surface-2 rounded-bl-md')}>{m.text}</div>
            </div>
          );
        })}
        {busy && <div className="flex items-center gap-2 text-xs text-muted"><Spinner size={13} /> Thinking…</div>}
        <div ref={bottomRef} />
      </div>

      <div className="m-3 mt-0 surface rounded-2xl p-1.5 flex items-end gap-1">
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={hasKey ? 'Ask…' : 'Add a key in Settings'}
          disabled={!hasKey}
          className="flex-1 resize-none bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted max-h-32"
          style={{ minHeight: 36 }}
        />
        {speechSupported && (
          <IconButton title="Speak" className="h-8 w-8" onClick={startListening} disabled={!hasKey || busy}>
            <Mic size={16} className={listening ? 'text-rose-400 animate-pulse' : ''} />
          </IconButton>
        )}
        <IconButton title="Send" className="h-8 w-8 text-accent" onClick={() => submit()} disabled={!hasKey || !text.trim() || busy}>
          <Send size={16} />
        </IconButton>
      </div>
    </aside>
  );
}
