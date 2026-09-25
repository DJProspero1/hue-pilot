import { AlertTriangle, Bot, Check, KeyRound, Mic, RotateCcw, Send, Sparkles, Volume2, VolumeX, Wrench, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, cx, IconButton, Spinner } from '../components/ui';
import { useApp } from '../store';
import type { ChatMessage } from '../../../shared/ipc-types.ts';

const SUGGESTIONS = [
  'Turn on the office lights',
  'Set the living room to warm white at 40%',
  'Activate the Relax scene in the bedroom',
  'Make the desk lamp blue',
  'Start the candle effect in the living room',
  'Turn everything off at 23:00 on weekdays',
  'What is the temperature in the office?',
  'Turn all lights off',
];

function ToolCard({ m }: { m: ChatMessage }) {
  const ok = m.tool?.result.ok;
  return (
    <div className={cx('flex items-center gap-2 rounded-xl border px-3 py-2 text-xs max-w-[80%]', ok ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-amber-500/30 bg-amber-500/10')}>
      {ok ? <Check size={14} className="text-emerald-400 shrink-0" /> : <AlertTriangle size={14} className="text-amber-400 shrink-0" />}
      <Wrench size={12} className="text-muted shrink-0" />
      <span className="font-mono text-[11px] text-muted">{m.tool?.name}</span>
      <span className="truncate">{m.text}</span>
    </div>
  );
}

export default function AssistantView() {
  const chat = useApp((s) => s.chat);
  const busy = useApp((s) => s.chatBusy);
  const send = useApp((s) => s.sendChat);
  const reset = useApp((s) => s.resetChat);
  const settings = useApp((s) => s.settings);
  const updateSettings = useApp((s) => s.updateSettings);
  const navigate = useApp((s) => s.navigate);
  const status = useApp((s) => s.status);
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const hasKey = !!settings.geminiApiKey;
  const speechSupported = typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat.length, busy]);

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
    <div className="flex h-full flex-col fade-in" style={{ minHeight: 'calc(100vh - 92px)' }}>
      <div className="flex items-end justify-between mb-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Assistant</h1>
          <p className="text-sm text-muted mt-0.5">Powered by Gemini{settings.geminiModel ? ` · ${settings.geminiModel}` : ''} · controls your lights through tools</p>
        </div>
        <div className="flex items-center gap-1">
          <IconButton title={settings.speakReplies ? 'Stop speaking replies' : 'Speak replies aloud'} onClick={() => updateSettings({ speakReplies: !settings.speakReplies })} className={settings.speakReplies ? 'text-accent' : ''}>
            {settings.speakReplies ? <Volume2 size={17} /> : <VolumeX size={17} />}
          </IconButton>
          <IconButton title="New conversation" onClick={reset} disabled={!chat.length || busy}>
            <RotateCcw size={17} />
          </IconButton>
        </div>
      </div>

      {!hasKey && (
        <div className="surface rounded-2xl p-4 mb-3 flex items-start gap-3 border-accent/40">
          <KeyRound size={18} className="text-accent mt-0.5" />
          <div className="text-sm flex-1">
            <div className="font-medium">Add a Gemini API key to start talking to your lights</div>
            <div className="text-muted mt-0.5">Get a free key at aistudio.google.com/apikey, then paste it in Settings. The key only leaves this computer to talk to Google's API.</div>
          </div>
          <Button size="sm" variant="primary" onClick={() => navigate({ view: 'settings' })}>Open Settings</Button>
        </div>
      )}
      {status.state !== 'connected' && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-sm mb-3">The bridge is not connected; the assistant cannot control lights right now.</div>
      )}

      <div className="scroll flex-1 surface rounded-2xl p-4 space-y-3">
        {!chat.length && (
          <div className="flex flex-col items-center justify-center h-full text-center py-10">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-accent via-accent-2 to-accent-3 flex items-center justify-center shadow-md mb-3"><Bot size={26} className="text-white" /></div>
            <div className="font-medium">Tell me what to do with your lights</div>
            <div className="text-sm text-muted mt-1 max-w-md">I know every room, light and scene on your bridge. I can also create schedules and read your sensors.</div>
            <div className="flex flex-wrap justify-center gap-1.5 mt-5 max-w-2xl">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => submit(s)} disabled={!hasKey} className="rounded-full border border-[var(--border)] surface-2 px-3 h-8 text-xs hover:border-accent/60 disabled:opacity-50 transition-colors">
                  <Sparkles size={11} className="inline mr-1 text-accent" />{s}
                </button>
              ))}
            </div>
          </div>
        )}
        {chat.map((m) => {
          if (m.role === 'tool') return <div key={m.id} className="flex justify-start pl-10"><ToolCard m={m} /></div>;
          if (m.role === 'error')
            return (
              <div key={m.id} className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm max-w-[80%]">
                <X size={14} className="text-rose-400 mt-0.5 shrink-0" /> {m.text}
              </div>
            );
          const user = m.role === 'user';
          return (
            <div key={m.id} className={cx('flex gap-2', user ? 'justify-end' : 'justify-start')}>
              {!user && <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-accent to-accent-3 flex items-center justify-center shrink-0"><Bot size={15} className="text-white" /></div>}
              <div className={cx('rounded-2xl px-4 py-2.5 text-sm max-w-[75%] whitespace-pre-wrap leading-relaxed', user ? 'bg-gradient-to-r from-accent to-accent-2 text-white rounded-br-md' : 'surface-2 rounded-bl-md')}>{m.text}</div>
            </div>
          );
        })}
        {busy && (
          <div className="flex gap-2 items-center pl-10 text-xs text-muted"><Spinner size={14} /> Thinking…</div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="mt-3 surface rounded-2xl p-2 flex items-end gap-2">
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
          placeholder={hasKey ? 'e.g. "Please turn the lights in my office on"' : 'Add a Gemini API key in Settings first'}
          disabled={!hasKey}
          className="flex-1 resize-none bg-transparent px-3 py-2.5 text-sm outline-none placeholder:text-muted max-h-32"
          style={{ minHeight: 42 }}
        />
        {speechSupported && (
          <IconButton title="Speak" onClick={startListening} disabled={!hasKey || busy} className={listening ? 'text-rose-400 animate-pulse' : ''}>
            <Mic size={18} />
          </IconButton>
        )}
        <Button variant="primary" onClick={() => submit()} disabled={!hasKey || !text.trim()} loading={busy} icon={<Send size={15} />}>
          Send
        </Button>
      </div>
    </div>
  );
}
