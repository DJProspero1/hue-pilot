import { Cloud, Copy, Loader2, LogOut, RefreshCw, Video, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button, Card, cx, Input, Select } from '../components/ui';
import type { CloudCamera, CloudStatus, LiveViewSession } from '../../../shared/ipc-types.ts';

const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));
const unb64 = (s: string) => decodeURIComponent(escape(atob(s)));

interface PlayerStats {
  state: string;
  ice: string;
  width: number;
  height: number;
  fps: number;
  kbps: number;
  framesDecoded: number;
}

/** WebRTC viewer: Kinesis signaling over the pre-signed WebSocket, then DTLS-SRTP from the camera. */
function LiveViewPlayer({ session, onLog, onClose }: { session: LiveViewSession; onLog: (line: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stats, setStats] = useState<PlayerStats>({ state: 'new', ice: 'new', width: 0, height: 0, fps: 0, kbps: 0, framesDecoded: 0 });
  const [muted, setMuted] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let closed = false;
    const pc = new RTCPeerConnection({ iceServers: session.iceServers, bundlePolicy: 'max-bundle' });
    const ws = new WebSocket(session.wssUrl);
    let answerTimer: ReturnType<typeof setTimeout> | null = null;
    let lastBytes = 0;
    let lastFrames = 0;
    let lastAt = Date.now();
    const log = (l: string) => !closed && onLog(l);

    const send = (obj: Record<string, unknown>) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
    };

    pc.addTransceiver('video', { direction: 'recvonly' });
    pc.addTransceiver('audio', { direction: 'recvonly' });
    pc.ontrack = (e) => {
      log(`Media track received: ${e.track.kind}`);
      const v = videoRef.current;
      if (!v) return;
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      if (v.srcObject !== stream) {
        v.srcObject = stream;
        v.play().catch(() => undefined);
      }
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) send({ action: 'ICE_CANDIDATE', messagePayload: b64(JSON.stringify(e.candidate.toJSON())) });
    };
    pc.onconnectionstatechange = () => {
      log(`Peer connection: ${pc.connectionState}`);
      setStats((s) => ({ ...s, state: pc.connectionState }));
      if (pc.connectionState === 'failed') setError('The WebRTC connection failed (ICE). The camera may be offline or a firewall blocks UDP.');
    };
    pc.oniceconnectionstatechange = () => setStats((s) => ({ ...s, ice: pc.iceConnectionState }));

    ws.onopen = async () => {
      log('Signaling channel open; sending SDP offer to the camera.');
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        send({ action: 'SDP_OFFER', messagePayload: b64(JSON.stringify({ type: 'offer', sdp: offer.sdp })) });
        answerTimer = setTimeout(() => {
          if (pc.remoteDescription) return;
          const msg = 'The camera did not answer within 20 s. If "Live view protection" is on for this camera in the Hue app, turn it off (Hue app → Settings → Security → the camera); it is the same setting Alexa/Google need. Also make sure nobody is watching it in the Hue app right now.';
          log(msg);
          setError(msg);
        }, 20_000);
      } catch (err) {
        setError(`Could not create the WebRTC offer: ${(err as Error).message}`);
      }
    };
    ws.onmessage = async (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as { messageType?: string; messagePayload?: string; senderClientId?: string; statusResponse?: unknown };
        if (msg.statusResponse) {
          log(`Signaling status: ${JSON.stringify(msg.statusResponse).slice(0, 200)}`);
          return;
        }
        const payload = msg.messagePayload ? (JSON.parse(unb64(msg.messagePayload)) as Record<string, unknown>) : null;
        if (!payload) return;
        if (msg.messageType === 'SDP_ANSWER') {
          log('SDP answer received from the camera.');
          await pc.setRemoteDescription({ type: 'answer', sdp: String(payload.sdp) });
        } else if (msg.messageType === 'SDP_OFFER') {
          log('The camera sent an offer instead; answering it.');
          await pc.setRemoteDescription({ type: 'offer', sdp: String(payload.sdp) });
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          send({ action: 'SDP_ANSWER', messagePayload: b64(JSON.stringify({ type: 'answer', sdp: answer.sdp })), recipientClientId: msg.senderClientId ?? '' });
        } else if (msg.messageType === 'ICE_CANDIDATE') {
          await pc.addIceCandidate(payload as RTCIceCandidateInit).catch((err) => log(`ICE candidate rejected: ${(err as Error).message}`));
        } else {
          log(`Signaling message: ${msg.messageType ?? 'unknown'}`);
        }
      } catch (err) {
        log(`Signaling parse error: ${(err as Error).message}`);
      }
    };
    ws.onerror = () => log('Signaling WebSocket error.');
    ws.onclose = (e) => log(`Signaling WebSocket closed (${e.code}${e.reason ? ` ${e.reason}` : ''}).`);

    const statsTimer = setInterval(async () => {
      if (pc.connectionState === 'closed') return;
      const report = await pc.getStats().catch(() => null);
      if (!report) return;
      report.forEach((r) => {
        if (r.type === 'inbound-rtp' && (r as { kind?: string }).kind === 'video') {
          const rr = r as { bytesReceived?: number; framesDecoded?: number; frameWidth?: number; frameHeight?: number };
          const now = Date.now();
          const dt = Math.max(0.001, (now - lastAt) / 1000);
          const kbps = ((rr.bytesReceived ?? 0) - lastBytes) * 8 / 1000 / dt;
          const fps = ((rr.framesDecoded ?? 0) - lastFrames) / dt;
          lastBytes = rr.bytesReceived ?? 0;
          lastFrames = rr.framesDecoded ?? 0;
          lastAt = now;
          setStats((s) => ({ ...s, width: rr.frameWidth ?? s.width, height: rr.frameHeight ?? s.height, fps: Math.round(fps), kbps: Math.round(kbps), framesDecoded: rr.framesDecoded ?? 0 }));
        }
      });
    }, 1000);

    return () => {
      closed = true;
      clearInterval(statsTimer);
      if (answerTimer) clearTimeout(answerTimer);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      pc.close();
    };
  }, [session, onLog]);

  const live = stats.framesDecoded > 0;
  return (
    <div className="mt-3 rounded-xl overflow-hidden border border-base bg-black">
      <div className="relative aspect-video">
        <video ref={videoRef} autoPlay playsInline muted={muted} className="h-full w-full object-contain" />
        {!live && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80 p-6 text-center">
            {error ?? (stats.state === 'connected' ? 'Connected, waiting for the first frame…' : 'Connecting to the camera…')}
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 px-3 py-2 text-xs text-muted surface-2">
        <span className={cx('inline-block h-2 w-2 rounded-full', live ? 'bg-emerald-400' : stats.state === 'failed' ? 'bg-rose-400' : 'bg-amber-400')} />
        <span>{session.cameraName}</span>
        <span>· {stats.state} / ICE {stats.ice}</span>
        {live && <span>· {stats.width}×{stats.height} · {stats.fps} fps · {stats.kbps} kbit/s</span>}
        <span className="ml-auto" />
        <Button size="sm" variant="ghost" onClick={() => setMuted((m) => !m)}>{muted ? 'Unmute' : 'Mute'}</Button>
        <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}

/** Card on the Cameras page: Hue account sign-in, camera list and the live-view player. */
export function CloudLiveViewCard({ cameras }: { cameras: { id: string; name: string }[] }) {
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [session, setSession] = useState<LiveViewSession | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [pasted, setPasted] = useState('');

  const addLog = (line: string) => setLog((l) => [...l.slice(-199), `${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}  ${line}`]);

  useEffect(() => {
    let alive = true;
    window.hue.getCloudStatus().then((s) => alive && setStatus(s));
    window.hue.cloudLog().then((lines) => alive && setLog(lines));
    const offStatus = window.hue.onCloudStatus((s) => alive && setStatus(s));
    const offLog = window.hue.onCloudLog((line) => alive && setLog((l) => [...l.slice(-199), line]));
    return () => {
      alive = false;
      offStatus();
      offLog();
    };
  }, []);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const watch = (cam: CloudCamera) =>
    run(cam.id, async () => {
      setSession(null);
      addLog(`Preparing live view for ${cam.name}…`);
      const s = await window.hue.cloudPrepareLiveView(cam.id);
      addLog(`Session ready (region ${s.region}, ${s.iceServers.length} ICE servers).`);
      setSession(s);
    });

  const cloudCams = status?.cameras ?? [];
  // Match cloud cameras to bridge cameras by name for a friendlier label.
  const label = (c: CloudCamera) => cameras.find((b) => b.name.toLowerCase() === c.name.toLowerCase())?.name ?? c.name;

  return (
    <Card className="mt-4">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 shrink-0 rounded-xl surface-2 flex items-center justify-center">
          <Cloud size={20} className="text-accent" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium flex items-center gap-2">
            Live view from the Hue cloud <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-500">experimental</span>
          </div>
          <div className="text-sm text-muted mt-0.5">
            Does what the Philips Hue app does: signs in to your Hue account, asks Signify's cloud for a short-lived Kinesis session for the camera and opens the WebRTC stream here. Unofficial: it uses the app's own endpoints, which Signify can change at any time.
          </div>
        </div>
      </div>

      {!status?.signedIn ? (
        status?.pendingLogin ? (
          <div className="mt-3 rounded-xl surface-2 p-3 text-sm">
            <div className="flex items-center gap-2 font-medium">
              <Loader2 size={14} className="spin" /> Finish signing in in your browser
            </div>
            <ol className="mt-2 list-decimal pl-5 space-y-1 text-muted">
              <li>Complete the sign-in in the browser window that just opened (Google, Apple or email).</li>
              <li>It ends on the Hue account page. Copy the address from the address bar: click it, press <span className="font-medium text-[var(--fg)]">Ctrl+L</span> then <span className="font-medium text-[var(--fg)]">Ctrl+C</span>. Hue Pilot notices the copied address and finishes automatically.</li>
              <li>If nothing happens, paste the address here:</li>
            </ol>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Input value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="https://account.meethue.com/#code=…" className="flex-1 min-w-[280px]" />
              <Button variant="primary" size="sm" loading={busy === 'finish' || status.busy} disabled={!pasted.trim()} onClick={() => run('finish', async () => { await window.hue.cloudFinishSignIn(pasted); setPasted(''); })}>
                Finish sign-in
              </Button>
              <Button variant="ghost" size="sm" onClick={() => run('cancel', () => window.hue.cloudCancelSignIn())}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="primary" icon={<Cloud size={14} />} loading={busy === 'signin' || status?.busy} onClick={() => run('signin', () => window.hue.cloudSignIn('browser'))}>
              Sign in with your browser
            </Button>
            <Button variant="outline" loading={busy === 'signin-window'} onClick={() => run('signin-window', () => window.hue.cloudSignIn('window'))}>
              Sign in in a window
            </Button>
            <span className="text-xs text-muted basis-full">Use your browser for Google or Apple accounts (they refuse embedded windows). Signify's own sign-in page is used; Hue Pilot only receives a session token, never your password.</span>
          </div>
        )
      ) : (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {status.homes.length > 1 && (
              <Select value={status.homeId ?? ''} onChange={(e) => run('home', () => window.hue.cloudSetHome(e.target.value))} className="w-56">
                {status.homes.map((h) => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </Select>
            )}
            <Button variant="subtle" size="sm" icon={<RefreshCw size={14} />} loading={busy === 'refresh' || status.busy} onClick={() => run('refresh', () => window.hue.cloudRefresh())}>
              Refresh cameras
            </Button>
            <Button variant="ghost" size="sm" icon={<LogOut size={14} />} onClick={() => run('signout', () => window.hue.cloudSignOut())}>
              Sign out
            </Button>
            <span className="text-xs text-muted ml-auto">{status.homeId ? `Home ${status.homes.find((h) => h.id === status.homeId)?.name ?? status.homeId}` : 'No home found'}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {cloudCams.length ? (
              cloudCams.map((c) => (
                <Button key={c.id} variant={session?.cameraId === c.id ? 'primary' : 'outline'} icon={<Video size={14} />} loading={busy === c.id} onClick={() => watch(c)}>
                  {label(c)}
                  {c.online === false ? ' (offline)' : ''}
                </Button>
              ))
            ) : (
              <span className="text-xs text-muted">{status.busy ? 'Looking for cameras…' : 'No cameras were returned for this home. Use Refresh, or check the log below.'}</span>
            )}
          </div>
        </>
      )}

      {(error || status?.error) && <div className="mt-3 text-sm rounded-xl px-3 py-2 bg-rose-500/10 text-rose-400">{error ?? status?.error}</div>}

      {session && <LiveViewPlayer session={session} onLog={addLog} onClose={() => setSession(null)} />}

      <div className="mt-3 text-xs text-muted">
        Needs: a camera with <span className="font-medium">Live view protection turned off</span> in the Hue app (Settings → Security → camera) — that is what Alexa and Google Home integrations require as well. Battery cameras wake up first, so the picture can take a few seconds.
      </div>

      <div className="mt-2">
        <button className="text-xs text-muted hover:text-[var(--fg)]" onClick={() => setShowLog((v) => !v)}>{showLog ? 'Hide diagnostics' : 'Show diagnostics'} ({log.length})</button>
        {showLog && (
          <div className="mt-2 rounded-xl surface-2 p-2 text-[11px] font-mono max-h-56 overflow-auto whitespace-pre-wrap">
            {log.length ? log.join('\n') : 'Nothing logged yet.'}
            <div className="mt-2">
              <Button size="sm" variant="ghost" icon={<Copy size={12} />} onClick={() => window.hue.copyText(log.join('\n'))}>Copy</Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
