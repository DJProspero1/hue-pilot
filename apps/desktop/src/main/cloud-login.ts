import { randomBytes } from 'node:crypto';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { BrowserWindow, clipboard, shell } from 'electron';
import { buildAuthorizeUrl, extractAuthCode, HUE_REDIRECT_URI, pkcePair, type HueCloud } from './hue-cloud.ts';
import type { CloudStatus } from '../shared/ipc-types.ts';

const execFileAsync = promisify(execFile);

// -----------------------------------------------------------------------------
// System-browser sign-in through DevTools remote debugging
//
// Google (and Apple) refuse to sign in inside embedded windows, and Signify only allows
// account.meethue.com as the OAuth redirect — a page that immediately starts its own login and
// replaces the address, so users cannot copy the code either. Launching the user's real browser
// (Edge/Chrome, in a dedicated profile) with remote debugging lets Hue Pilot observe the navigation
// to account.meethue.com the instant it happens, read the code, and close the window.
// -----------------------------------------------------------------------------

export interface ChromiumBrowser {
  name: string;
  path: string;
}

const BROWSERS: { name: string; progId: string; paths: string[] }[] = [
  { name: 'Microsoft Edge', progId: 'MSEdgeHTM', paths: ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'] },
  { name: 'Google Chrome', progId: 'ChromeHTML', paths: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', path.join(process.env.LOCALAPPDATA ?? '', 'Google\\Chrome\\Application\\chrome.exe')] },
  { name: 'Brave', progId: 'BraveHTML', paths: ['C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe', path.join(process.env.LOCALAPPDATA ?? '', 'BraveSoftware\\Brave-Browser\\Application\\brave.exe')] },
];

async function defaultBrowserProgId(): Promise<string | null> {
  if (process.platform !== 'win32') return null;
  try {
    const { stdout } = await execFileAsync('reg', ['query', 'HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice', '/v', 'ProgId'], { windowsHide: true });
    return stdout.match(/ProgId\s+REG_SZ\s+(\S+)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** The user's default Chromium browser if it is one, otherwise the first installed one. */
export async function findChromiumBrowser(): Promise<ChromiumBrowser | null> {
  const def = await defaultBrowserProgId();
  const ordered = [...BROWSERS].sort((a, b) => Number(def?.startsWith(b.progId) ?? false) - Number(def?.startsWith(a.progId) ?? false));
  for (const b of ordered) for (const p of b.paths) if (p && fs.existsSync(p)) return { name: b.name, path: p };
  return null;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

interface CdpTarget {
  id: string;
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

let activeBrowserLogin: { cancel: () => void } | null = null;

export function cancelActiveBrowserLogin() {
  activeBrowserLogin?.cancel();
  activeBrowserLogin = null;
}

/**
 * Runs the sign-in in the user's real browser and resolves when the redirect to account.meethue.com
 * carrying our authorization code was observed. Rejects when the browser is closed, on timeout or on
 * an OAuth error.
 */
export async function signInWithSystemBrowser(cloud: HueCloud, browser: ChromiumBrowser, audience: string | null, profileDir: string, log: (line: string) => void): Promise<CloudStatus> {
  cancelActiveBrowserLogin();
  const url = cloud.beginBrowserLogin(audience, 'query', 'browser');
  const state = cloud.pending!.state;
  const port = await freePort();
  fs.mkdirSync(profileDir, { recursive: true });
  log(`Opening ${browser.name} for the Hue sign-in (audience: ${audience ?? 'default'}).`);
  const child: ChildProcess = spawn(
    browser.path,
    [`--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-features=Translate', '--window-size=560,860', '--new-window', url],
    { windowsHide: false, stdio: 'ignore' },
  );

  const sockets = new Set<WebSocket>();
  const attached = new Set<string>();
  let finished = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const closeBrowser = async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      const info = (await res.json()) as { webSocketDebuggerUrl?: string };
      if (info.webSocketDebuggerUrl) {
        await new Promise<void>((resolve) => {
          const ws = new WebSocket(info.webSocketDebuggerUrl!);
          const done = () => resolve();
          ws.onopen = () => {
            ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
            setTimeout(done, 300);
          };
          ws.onerror = done;
          setTimeout(done, 1500);
        });
      }
    } catch {
      /* ignore */
    }
    if (child.exitCode === null) child.kill();
  };

  const result = await new Promise<string>((resolve, reject) => {
    const finish = (fn: () => void) => {
      if (finished) return;
      finished = true;
      if (timer) clearInterval(timer);
      for (const s of sockets) {
        try {
          s.close();
        } catch {
          /* ignore */
        }
      }
      fn();
    };
    const consider = (candidate: string) => {
      if (!candidate.startsWith(HUE_REDIRECT_URI.replace(/\/$/, ''))) return;
      const { code, error, state: seenState } = extractAuthCode(candidate, state);
      if (seenState !== state) return; // the account site's own login, not ours
      if (code) finish(() => resolve(candidate));
      else if (error) finish(() => reject(new Error(`Sign-in failed: ${error}`)));
    };
    const attach = (target: CdpTarget) => {
      if (!target.webSocketDebuggerUrl || attached.has(target.id)) return;
      attached.add(target.id);
      const ws = new WebSocket(target.webSocketDebuggerUrl);
      sockets.add(ws);
      ws.onopen = () => {
        ws.send(JSON.stringify({ id: 1, method: 'Network.enable' }));
        ws.send(JSON.stringify({ id: 2, method: 'Page.enable' }));
      };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as { method?: string; params?: Record<string, unknown> };
          const p = msg.params ?? {};
          if (msg.method === 'Network.requestWillBeSent' && (p.type === 'Document' || !p.type)) consider(String((p.request as { url?: string })?.url ?? ''));
          else if (msg.method === 'Page.frameNavigated' && !(p.frame as { parentId?: string })?.parentId) consider(String((p.frame as { url?: string })?.url ?? ''));
          else if (msg.method === 'Page.navigatedWithinDocument') consider(String(p.url ?? ''));
        } catch {
          /* ignore */
        }
      };
      ws.onclose = () => sockets.delete(ws);
    };
    const poll = async () => {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/list`);
        const targets = (await res.json()) as CdpTarget[];
        for (const t of targets) if (t.type === 'page') attach(t);
        for (const t of targets) if (t.type === 'page') consider(t.url);
      } catch {
        /* browser not ready yet */
      }
    };
    timer = setInterval(poll, 700);
    void poll();
    child.on('exit', () => finish(() => reject(new Error('The browser window was closed before the sign-in finished.'))));
    child.on('error', (err) => finish(() => reject(new Error(`Could not start ${browser.name}: ${err.message}`))));
    setTimeout(() => finish(() => reject(new Error('Sign-in timed out after 10 minutes.'))), 10 * 60_000);
    activeBrowserLogin = { cancel: () => finish(() => reject(new Error('Sign-in cancelled.'))) };
  }).finally(() => {
    activeBrowserLogin = null;
  });

  log('Sign-in redirect captured from the browser; closing it.');
  await closeBrowser();
  const status = await cloud.finishBrowserLogin(result);
  if (!status) throw new Error('The browser returned no usable authorization code.');
  return status;
}

// -----------------------------------------------------------------------------
// Fallback without a Chromium browser: open the default browser and watch the clipboard.
// -----------------------------------------------------------------------------

let clipboardWatcher: ReturnType<typeof setInterval> | null = null;

export function startClipboardSignIn(cloud: HueCloud, audience: string | null, log: (line: string) => void): CloudStatus {
  stopClipboardWatcher();
  const url = cloud.beginBrowserLogin(audience, 'query', 'clipboard');
  log(`Opening the Hue sign-in page in your default browser (audience: ${audience ?? 'default'}).`);
  void shell.openExternal(url);
  const startedAt = Date.now();
  let lastSeen = '';
  let checking = false;
  clipboardWatcher = setInterval(() => {
    if (!cloud.pending || Date.now() - startedAt > 15 * 60_000) return stopClipboardWatcher();
    if (checking) return;
    checking = true;
    void (async () => {
      try {
        const text = String(await clipboard.readText());
        if (!text || text === lastSeen || !/code=/.test(text) || !text.includes('account.meethue.com')) return;
        lastSeen = text;
        log('Sign-in address found on the clipboard; finishing sign-in.');
        const s = await cloud.finishBrowserLogin(text);
        if (s) stopClipboardWatcher();
      } catch (err) {
        log(`Clipboard sign-in failed: ${(err as Error).message}`);
      } finally {
        checking = false;
      }
    })();
  }, 600);
  return cloud.status();
}

export function stopClipboardWatcher() {
  if (clipboardWatcher) clearInterval(clipboardWatcher);
  clipboardWatcher = null;
}

// -----------------------------------------------------------------------------
// Embedded window (email/password accounts only)
// -----------------------------------------------------------------------------

/**
 * Interactive Hue account sign-in in an Electron window (OAuth 2 authorization code + PKCE).
 * The redirect back to account.meethue.com is intercepted before it loads. Auth0 rejects unknown
 * API audiences with an immediate error redirect, so a list of candidate audiences is tried in order.
 */
export async function signInWithHueAccount(cloud: HueCloud, parent: BrowserWindow | null, audiences: (string | null)[], log: (line: string) => void): Promise<CloudStatus> {
  let lastError = 'Sign-in cancelled.';
  for (const audience of audiences) {
    const { verifier, challenge } = pkcePair();
    const state = randomBytes(12).toString('base64url');
    const url = buildAuthorizeUrl(challenge, state, audience);
    log(`Opening Hue sign-in window (audience: ${audience ?? 'default'})`);
    const result = await runLoginWindow(url, state, parent);
    if (result.kind === 'code') {
      const status = await cloud.completeLogin(result.code, verifier);
      if (!cloud.authRejected) return status;
      lastError = status.error ?? 'The Hue account API rejected the token.';
      log('Token not accepted by the account API; trying the next audience.');
      continue;
    }
    if (result.kind === 'cancelled') {
      lastError = 'Sign-in cancelled.';
      break;
    }
    lastError = result.message;
    log(`Sign-in attempt failed: ${result.message}`);
    if (!/service not found|invalid audience|audience/i.test(result.message)) break;
  }
  throw new Error(lastError);
}

type LoginResult = { kind: 'code'; code: string } | { kind: 'cancelled' } | { kind: 'error'; message: string };

function runLoginWindow(url: string, state: string, parent: BrowserWindow | null): Promise<LoginResult> {
  return new Promise((resolve) => {
    const win = new BrowserWindow({
      width: 480,
      height: 760,
      parent: parent ?? undefined,
      autoHideMenuBar: true,
      title: 'Sign in to your Hue account',
      // In-memory partition: with a persistent one the login page skipped straight to Google sign-in
      // in testing; a fresh session shows the normal email/password form every time.
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, partition: `hue-account-login-${Date.now()}` },
    });
    // Present a plain browser user agent: the login page (and Google/Apple behind it) treat an Electron UA differently.
    win.webContents.setUserAgent(win.webContents.getUserAgent().replace(/\s?[\w.-]+\/[\d.]+\s?(?=Chrome\/)/, ' ').replace(/\sElectron\/[\d.]+/, '').replace(/\s{2,}/g, ' '));
    let settled = false;
    const finish = (r: LoginResult) => {
      if (settled) return;
      settled = true;
      resolve(r);
      if (!win.isDestroyed()) win.close();
    };
    const check = (target: string, event?: Electron.Event) => {
      if (!target.startsWith(HUE_REDIRECT_URI.replace(/\/$/, ''))) return;
      event?.preventDefault();
      const { code, error } = extractAuthCode(target, state);
      if (code) finish({ kind: 'code', code });
      else finish({ kind: 'error', message: error ?? 'No authorization code in the redirect.' });
    };
    win.webContents.on('will-redirect', (event, target) => check(target, event));
    win.webContents.on('will-navigate', (event, target) => check(target, event));
    win.webContents.on('did-navigate', (_event, target) => check(target));
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.on('closed', () => finish({ kind: 'cancelled' }));
    win.loadURL(url).catch((err) => finish({ kind: 'error', message: `Could not open the sign-in page: ${(err as Error).message}` }));
  });
}
