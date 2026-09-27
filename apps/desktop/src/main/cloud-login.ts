import { randomBytes } from 'node:crypto';
import { BrowserWindow, clipboard, shell } from 'electron';
import { buildAuthorizeUrl, extractAuthCode, HUE_REDIRECT_URI, pkcePair, type HueCloud } from './hue-cloud.ts';
import type { CloudStatus } from '../shared/ipc-types.ts';

let clipboardWatcher: ReturnType<typeof setInterval> | null = null;

/**
 * Sign-in in the user's default browser. Google (and Apple) refuse to sign in inside embedded
 * windows, so the authorize URL opens externally; Signify only allows account.meethue.com as the
 * redirect, which a browser cannot hand back to a desktop app. The code is therefore requested in
 * the URL fragment (the account site ignores it, so it stays in the address bar) and the user copies
 * the address: a clipboard watcher completes the sign-in the moment it sees it, and the renderer
 * also offers a paste box. The next audience in [audiences] is used after a rejected token.
 */
export function startBrowserSignIn(cloud: HueCloud, audiences: (string | null)[], attempt: number, log: (line: string) => void): CloudStatus {
  stopClipboardWatcher();
  const audience = audiences[Math.min(attempt, audiences.length - 1)] ?? null;
  const url = cloud.beginBrowserLogin(audience);
  log(`Opening the Hue sign-in page in your browser (audience: ${audience ?? 'default'}).`);
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

/**
 * Interactive Hue account sign-in in an Electron window (OAuth 2 authorization code + PKCE, the
 * same flow the Philips Hue app uses). The redirect back to account.meethue.com is intercepted
 * before it loads, so only the authorization code leaves the window.
 *
 * Auth0 rejects unknown API audiences with an immediate error redirect, so a list of candidate
 * audiences is tried in order until the login page actually appears.
 */
export async function signInWithHueAccount(cloud: HueCloud, parent: BrowserWindow | null, audiences: (string | null)[], log: (line: string) => void): Promise<CloudStatus> {
  let lastError = 'Sign-in cancelled.';
  for (const audience of audiences) {
    const { verifier, challenge } = pkcePair();
    const state = randomBytes(12).toString('base64url');
    const url = buildAuthorizeUrl(challenge, state, audience);
    log(`Opening Hue sign-in (audience: ${audience ?? 'default'})`);
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
    // An immediate "Service not found" means the audience is wrong; try the next one silently.
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
    // Signify's login page (and Google/Apple sign-in behind it) behave differently for an Electron
    // user agent: present the plain Chromium one so the normal username/password form is shown.
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
