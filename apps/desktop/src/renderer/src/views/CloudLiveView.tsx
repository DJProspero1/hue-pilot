import { Cloud, Copy, KeyRound, Loader2, LogOut, RefreshCw, Video, X } from 'lucide-react';
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
  attempt: string;
}

const ANSWER_TIMEOUT_MS = 15_000;

/**
 * WebRTC viewer: Kinesis signaling over the pre-signed WebSocket, then DTLS-SRTP from the camera.
 * Attempt 0 sends a plain offer. If the camera never answers (live view protection on) and a
 * passphrase is stored, the signed-offer variants from the main process are tried one by one.
 */
function LiveViewPlayer({ session, onLog, onClose }: { session: LiveViewSession; onLog: (line: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stats, setStats] = useState<PlayerStats>({ state: 'new', ice: 'new', width: 0, height: 0, fps: 0, kbps: 0, framesDecoded: 0, attempt: 'plain offer' });
  const [muted, setMuted] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let closed = false;
    let current: { pc: RTCPeerConnection; ws: WebSocket } | null = null;
    let statsTimer: ReturnType<typeof setInterval> | null = null;
    let lastBytes = 0;
    let lastFrames = 0;
    let lastAt = Date.now();
    const log = (l: string) => !closed && onLog(l);

    const teardown = () => {
      if (!current) return;
      try {
        current.ws.close();
      } catch {
        /* ignore */
      }
      current.pc.close();
      current = null;
    };

    /** One signaling/WebRTC attempt. Resolves 'answered' | 'timeout' | 'failed'. */
    const attempt = (index: number, variantName: string) =>
      new Promise<'answered' | 'timeout' | 'failed'>((resolve) => {
        let settled = false;
        const done = (r: 'answered' | 'timeout' | 'failed') => {
          if (settled) return;
          settled = true;
          resolve(r);
        };
        const pc = new RTCPeerConnection({ iceServers: session.iceServers, bundlePolicy: 'max-bundle' });
        const ws = new WebSocket(session.wssUrl);
        current = { pc, ws };
        setStats((s) => ({ ...s, state: 'new', ice: 'new', attempt: variantName }));
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
          if (pc.connectionState === 'failed') {
            setError('The WebRTC connection failed (ICE). The camera may be offline or a firewall blocks UDP.');
            done('failed');
          }
        };
        pc.oniceconnectionstatechange = () => setStats((s) => ({ ...s, ice: pc.iceConnectionState }));
        const answerTimer = setTimeout(() => {
          if (!pc.remoteDescription) done('timeout');
        }, ANSWER_TIMEOUT_MS);
        ws.onopen = async () => {
          log(index === 0 ? 'Signaling channel open; sending a plain SDP offer to the camera.' : `Signaling channel open; sending a signed SDP offer (${variantName}).`);
          try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            // Signed variants must sign the exact SDP text of this offer.
            let extraFields: Record<string, string> = {};
            if (index > 0) {
              const variants = await window.hue.cloudSignOffer(offer.sdp ?? '').catch(() => []);
              extraFields = variants[index - 1]?.fields ?? {};
            }
            send({ action: 'SDP_OFFER', messagePayload: b64(JSON.stringify({ type: 'offer', sdp: offer.sdp, ...extraFields })) });
          } catch (err) {
            setError(`Could not create the WebRTC offer: ${(err as Error).message}`);
            done('failed');
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
              clearTimeout(answerTimer);
              await pc.setRemoteDescription({ type: 'answer', sdp: String(payload.sdp) });
              done('answered');
            } else if (msg.messageType === 'SDP_OFFER') {
              log('The camera sent an offer instead; answering it.');
              clearTimeout(answerTimer);
              await pc.setRemoteDescription({ type: 'offer', sdp: String(payload.sdp) });
              const answer = await pc.createAnswer();
              await pc.setLocalDescription(answer);
              send({ action: 'SDP_ANSWER', messagePayload: b64(JSON.stringify({ type: 'answer', sdp: answer.sdp })), recipientClientId: msg.senderClientId ?? '' });
              done('answered');
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
      });

    const run = async () => {
      // Attempt 0: plain offer. Then signed variants, if a passphrase is stored.
      let variants: { name: string; fields: Record<string, string> }[] | null = null;
      for (let i = 0; !closed; i++) {
        let name = 'plain offer';
        if (i > 0) {
          if (variants === null) variants = await window.hue.cloudSignOffer('probe').catch(() => []);
          if (i - 1 >= variants.length) {
            const msg = variants.length
              ? 'The camera did not answer any offer, plain or signed. Turn off "Live view protection" for this camera in the Hue app (Settings → Security → the camera) — the same setting Alexa/Google need — and try again.'
              : 'The camera did not answer within 15 s. If "Live view protection" is on for this camera in the Hue app, either turn it off (Settings → Security → the camera; Alexa/Google need that too) or enter the home\'s E2EE passphrase below so Hue Pilot can try signed offers. Also make sure nobody is watching it in the Hue app right now.';
            log(msg);
            setError(msg);
            return;
          }
          name = variants[i - 1].name;
        }
        const result = await attempt(i, name);
        if (result === 'answered' || result === 'failed' || closed) return;
        log(`No answer for the ${name} within ${ANSWER_TIMEOUT_MS / 1000} s.`);
        teardown();
        if (i === 0) variants = await window.hue.cloudSignOffer('probe').catch(() => []);
      }
    };
    void run();

    statsTimer = setInterval(async () => {
      const pc = current?.pc;
      if (!pc || pc.connectionState === 'closed') return;
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
      if (statsTimer) clearInterval(statsTimer);
      teardown();
    };
  }, [session, onLog]);

  const live = stats.framesDecoded > 0;
  return (
    <div className="mt-3 rounded-xl overflow-hidden border border-base bg-black">
      <div className="relative aspect-video">
        <video ref={videoRef} autoPlay playsInline muted={muted} className="h-full w-full object-contain" />
        {!live && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80 p-6 text-center">
            {error ?? (stats.state === 'connected' ? 'Connected, waiting for the first frame…' : `Connecting to the camera… (${stats.attempt})`)}
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

/** Card on the Cameras page: Hue account sign-in, camera list, passphrase and the live-view player. */
export function CloudLiveViewCard({ cameras }: { cameras: { id: string; name: string }[] }) {
  const [status, setStatus] = useState<CloudStatus | null>(null);
  const [session, setSession] = useState<LiveViewSession | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [showLog, setShowLog] = useState(false);
  const [pasted, setPasted] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [manualHome, setManualHome] = useState('');

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
            {status.pendingLogin.method === 'browser' ? (
              <div className="mt-2 text-muted">
                A browser window with the Hue sign-in just opened (your own browser, in a separate profile, so sign in with Google there as usual). When the sign-in completes, Hue Pilot picks up the result, closes that window and continues by itself.
              </div>
            ) : (
              <ol className="mt-2 list-decimal pl-5 space-y-1 text-muted">
                <li>Complete the sign-in in the browser window that just opened.</li>
                <li>Copy the address it ends on (Ctrl+L, Ctrl+C); Hue Pilot watches the clipboard and finishes automatically, or paste it here:</li>
              </ol>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {status.pendingLogin.method === 'clipboard' && (
                <>
                  <Input value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="https://account.meethue.com/?code=…" className="flex-1 min-w-[280px]" />
                  <Button variant="primary" size="sm" loading={busy === 'finish' || status.busy} disabled={!pasted.trim()} onClick={() => run('finish', async () => { await window.hue.cloudFinishSignIn(pasted); setPasted(''); })}>
                    Finish sign-in
                  </Button>
                </>
              )}
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
            <span className="text-xs text-muted basis-full">Your browser (Edge or Chrome) opens Signify's sign-in page; Google and Apple accounts work there. Hue Pilot only receives a session token, never your password.</span>
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
                {status.homeId && !status.homes.some((h) => h.id === status.homeId) && <option value={status.homeId}>Home {status.homeId}</option>}
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
                  {c.battery !== null && c.battery !== undefined ? ` ${c.battery}%` : ''}
                  {c.online === false ? ' (offline)' : ''}
                  {c.liveViewProtected ? ' (protected)' : ''}
                </Button>
              ))
            ) : (
              <span className="text-xs text-muted">{status.busy ? 'Looking for cameras…' : 'No cameras were returned for this home. Use Refresh, or check the log below.'}</span>
            )}
          </div>
          {!cloudCams.length && !status.busy && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Input value={manualHome} onChange={(e) => setManualHome(e.target.value)} placeholder="Home id by hand (account.meethue.com → Homes → the number in the address bar)" className="flex-1 min-w-[280px]" />
              <Button variant="subtle" size="sm" disabled={!manualHome.trim()} loading={busy === 'home'} onClick={() => run('home', async () => { await window.hue.cloudSetHome(manualHome.trim()); setManualHome(''); })}>
                Use this home
              </Button>
            </div>
          )}
          <div className="mt-3 rounded-xl surface-2 p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <KeyRound size={14} className="text-accent" /> E2EE passphrase {status.hasPassphrase && <span className="text-xs font-normal text-emerald-400">stored</span>}
            </div>
            <div className="text-xs text-muted mt-1">
              The 10-word passphrase the Hue app shows for viewing live feeds and history on another device. Optional: only used to sign the live-view offer when a camera keeps "Live view protection" on. Stored encrypted on this PC and never sent anywhere.
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Input type={showPassphrase ? 'text' : 'password'} value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder={status.hasPassphrase ? '•••••• (stored — enter a new one to replace)' : 'word word word … (10 words)'} className="flex-1 min-w-[280px]" />
              <Button variant="ghost" size="sm" onClick={() => setShowPassphrase((v) => !v)}>{showPassphrase ? 'Hide' : 'Show'}</Button>
              <Button variant="subtle" size="sm" disabled={!passphrase.trim()} loading={busy === 'passphrase'} onClick={() => run('passphrase', async () => { await window.hue.cloudSetPassphrase(passphrase); setPassphrase(''); })}>
                Save
              </Button>
              {status.hasPassphrase && (
                <Button variant="ghost" size="sm" onClick={() => run('passphrase-clear', () => window.hue.cloudSetPassphrase(''))}>Forget</Button>
              )}
            </div>
          </div>
        </>
      )}

      {(error || status?.error) && <div className="mt-3 text-sm rounded-xl px-3 py-2 bg-rose-500/10 text-rose-400">{error ?? status?.error}</div>}

      {session && <LiveViewPlayer session={session} onLog={addLog} onClose={() => setSession(null)} />}

      <div className="mt-3 text-xs text-muted">
        Works when the camera's <span className="font-medium">Live view protection</span> is off in the Hue app (Settings → Security → camera), the same requirement Alexa and Google Home have. With it on, Hue Pilot tries signed offers using the passphrase (best effort). Battery cameras wake up first, so the picture can take a few seconds.
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
