import { randomBytes } from 'node:crypto';
import { BrowserWindow } from 'electron';
import { buildAuthorizeUrl, extractAuthCode, HUE_REDIRECT_URI, pkcePair, type HueCloud } from './hue-cloud.ts';
import type { CloudStatus } from '../shared/ipc-types.ts';

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
