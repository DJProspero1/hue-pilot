import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type { AwsCredentials, IceServer } from './kvs-signaling.ts';
import { getIceServerConfig, getSignalingChannelEndpoints, normalizeIceServers, presignWebSocketUrl } from './kvs-signaling.ts';
import type { CloudCamera, CloudHome, CloudStatus, LiveViewSession } from '../shared/ipc-types.ts';

/**
 * Hue account (cloud) access for Hue Secure live view.
 *
 * The bridge exposes no camera video. The Philips Hue app gets live view from Signify's cloud:
 * it signs in with the Hue account, asks the cloud for short-lived Amazon Kinesis Video Streams
 * credentials for a camera and then opens a WebRTC session (DTLS-SRTP) with the camera through
 * KVS signaling. This module reproduces the first two steps; the WebRTC session runs in the
 * renderer (Chromium). Endpoints and the OAuth client are the ones the official app uses; they are
 * not documented by Signify and can change without notice.
 *
 * Optional "live view protection" (Hue app → camera settings) makes the camera require an ECDSA
 * signature on the SDP offer, which needs the home's E2EE passphrase-derived key. Signify's
 * whitepaper describes the key hierarchy but not the wire format, so this build cannot sign offers:
 * live view protection must be off for the camera (it is off whenever Alexa/Google integrations work).
 */

export const HUE_AUTH_DOMAIN = 'auth.meethue.com';
export const HUE_CLIENT_ID = 'xOFEN65uPEwp0aMlJ6JA1CK2slFyZtGQ';
export const HUE_REDIRECT_URI = 'https://account.meethue.com/';
export const HUE_AUDIENCE = 'https://api.meethue.com';
export const HUE_SCOPE = 'openid offline_access';
export const HUE_ACCOUNT_API = 'https://api.account.meethue.com';

export interface StoredTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  obtainedAt: number;
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

const b64url = (b: Buffer) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export function pkcePair(): PkcePair {
  const verifier = b64url(randomBytes(32));
  const challenge = b64url(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function buildAuthorizeUrl(challenge: string, state: string, audience: string | null = HUE_AUDIENCE): string {
  const params = new URLSearchParams({
    client_id: HUE_CLIENT_ID,
    redirect_uri: HUE_REDIRECT_URI,
    response_type: 'code',
    scope: HUE_SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  if (audience) params.set('audience', audience);
  return `https://${HUE_AUTH_DOMAIN}/authorize?${params.toString()}`;
}

/** Returns the authorization code when [url] is the redirect back to account.meethue.com. */
export function extractAuthCode(url: string, expectedState?: string): { code: string | null; state: string | null; error: string | null } {
  try {
    const u = new URL(url);
    if (!u.href.startsWith(HUE_REDIRECT_URI.replace(/\/$/, ''))) return { code: null, state: null, error: null };
    const code = u.searchParams.get('code');
    const state = u.searchParams.get('state');
    const error = u.searchParams.get('error_description') ?? u.searchParams.get('error');
    if (expectedState && state && state !== expectedState) return { code: null, state, error: 'state mismatch' };
    return { code, state, error };
  } catch {
    return { code: null, state: null, error: null };
  }
}

export function jwtExpiry(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { exp?: number };
    return payload.exp ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

/** Which devices in a home's device list are cameras. */
export function pickCameras(devices: unknown): CloudCamera[] {
  const list = Array.isArray(devices) ? devices : ((devices as { devices?: unknown[] })?.devices ?? []);
  const out: CloudCamera[] = [];
  for (const d of list as Record<string, unknown>[]) {
    const model = String(d.model_id ?? d.modelId ?? d.model ?? '');
    const type = String(d.type ?? d.device_type ?? '').toLowerCase();
    const product = String(d.product_name ?? d.productName ?? d.name ?? '').toLowerCase();
    const isCamera = /^CM[BW]/i.test(model) || type.includes('camera') || product.includes('camera');
    if (!isCamera) continue;
    const id = String(d.id ?? d.device_id ?? d.mac ?? d.mac_address ?? '');
    if (!id) continue;
    out.push({
      id,
      name: String(d.name ?? d.device_name ?? d.product_name ?? `Camera ${id}`),
      model: model || null,
      online: typeof d.online === 'boolean' ? d.online : typeof d.connected === 'boolean' ? d.connected : null,
      raw: Object.keys(d),
    });
  }
  return out;
}

export function pickHomes(data: unknown): CloudHome[] {
  const list = Array.isArray(data) ? data : ((data as { homes?: unknown[] })?.homes ?? []);
  return (list as Record<string, unknown>[])
    .map((h) => {
      const id = String(h.id ?? h.home_id ?? h.homeId ?? '');
      return { id, name: String(h.name ?? h.home_name ?? id) };
    })
    .filter((h) => h.id);
}

/** Pulls AWS credentials, channel ARN, region and ICE servers out of the live-stream response, whatever its exact shape. */
export function parseLiveStreamCredentials(data: unknown, cameraId: string): { creds: AwsCredentials | null; channelArn: string | null; region: string | null; iceServers: IceServer[]; keys: string[] } {
  const keys: string[] = [];
  const walk = (v: unknown, prefix: string, depth: number) => {
    if (depth > 3 || !v || typeof v !== 'object') return;
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      keys.push(prefix + k);
      if (val && typeof val === 'object' && !Array.isArray(val)) walk(val, `${prefix}${k}.`, depth + 1);
    }
  };
  walk(data, '', 0);

  // The response may be keyed per device or flat.
  let node: Record<string, unknown> = (data as Record<string, unknown>) ?? {};
  const perDevice = (node.devices ?? node.device_credentials ?? node.credentials_list) as unknown;
  if (Array.isArray(perDevice)) {
    const match = (perDevice as Record<string, unknown>[]).find((d) => String(d.device_id ?? d.id ?? d.mac ?? '').toUpperCase() === cameraId.toUpperCase()) ?? (perDevice[0] as Record<string, unknown>);
    if (match) node = { ...node, ...match };
  } else if (perDevice && typeof perDevice === 'object' && cameraId in (perDevice as Record<string, unknown>)) {
    node = { ...node, ...((perDevice as Record<string, Record<string, unknown>>)[cameraId] ?? {}) };
  }

  const find = (obj: Record<string, unknown>, names: string[]): unknown => {
    for (const n of names) if (obj[n] !== undefined) return obj[n];
    for (const val of Object.values(obj)) {
      if (val && typeof val === 'object' && !Array.isArray(val)) {
        const inner = find(val as Record<string, unknown>, names);
        if (inner !== undefined) return inner;
      }
    }
    return undefined;
  };

  const credsObj = find(node, ['awsCredentials', 'aws_credentials', 'credentials', 'kvs_credentials', 'kvsCredentials']) as Record<string, unknown> | undefined;
  const creds: AwsCredentials | null = credsObj
    ? {
        accessKeyId: String(credsObj.AccessKeyId ?? credsObj.accessKeyId ?? credsObj.access_key_id ?? ''),
        secretAccessKey: String(credsObj.SecretAccessKey ?? credsObj.secretAccessKey ?? credsObj.secret_access_key ?? ''),
        sessionToken: (credsObj.SessionToken ?? credsObj.sessionToken ?? credsObj.session_token) as string | undefined,
      }
    : null;
  const channelArn = (find(node, ['channelArn', 'channel_arn', 'ChannelARN', 'signalingChannelArn', 'signaling_channel_arn']) as string | undefined) ?? null;
  let region = (find(node, ['region', 'aws_region', 'awsRegion', 'Region']) as string | undefined) ?? null;
  if (!region && channelArn) region = channelArn.split(':')[3] ?? null;
  const iceRaw = find(node, ['iceServers', 'ice_servers', 'turnServers', 'turn_servers', 'IceServerList']);
  return { creds: creds && creds.accessKeyId && creds.secretAccessKey ? creds : null, channelArn, region, iceServers: normalizeIceServers(iceRaw), keys };
}

export interface HueCloudOptions {
  /** File where tokens are stored (encrypted by the caller if possible). */
  file: string;
  encrypt?: (plain: string) => string;
  decrypt?: (cipher: string) => string;
  log?: (line: string) => void;
}

export class HueCloud extends EventEmitter {
  private tokens: StoredTokens | null = null;
  private homes: CloudHome[] = [];
  private cameras: CloudCamera[] = [];
  private homeId: string | null = null;
  private lastError: string | null = null;
  private busy = false;
  private readonly opts: HueCloudOptions;

  /** Set when the account API answered 401/403 with a freshly obtained token (wrong audience). */
  authRejected = false;

  constructor(opts: HueCloudOptions) {
    super();
    this.opts = opts;
  }

  private log(line: string) {
    this.opts.log?.(line);
    this.emit('log', line);
  }

  /** Reads the saved session; call once the app is ready (safeStorage needs that on some platforms). */
  load() {
    try {
      if (!fs.existsSync(this.opts.file)) return;
      const raw = fs.readFileSync(this.opts.file, 'utf8');
      const json = this.opts.decrypt ? this.opts.decrypt(raw) : raw;
      const parsed = JSON.parse(json) as { tokens?: StoredTokens; homeId?: string | null; homes?: CloudHome[]; cameras?: CloudCamera[] };
      this.tokens = parsed.tokens ?? null;
      this.homeId = parsed.homeId ?? null;
      this.homes = parsed.homes ?? [];
      this.cameras = parsed.cameras ?? [];
    } catch (err) {
      this.lastError = `Could not read saved Hue account session: ${(err as Error).message}`;
    }
  }

  private save() {
    const json = JSON.stringify({ tokens: this.tokens, homeId: this.homeId, homes: this.homes, cameras: this.cameras });
    fs.mkdirSync(path.dirname(this.opts.file), { recursive: true });
    fs.writeFileSync(this.opts.file, this.opts.encrypt ? this.opts.encrypt(json) : json, 'utf8');
  }

  status(): CloudStatus {
    return {
      signedIn: !!this.tokens?.accessToken,
      busy: this.busy,
      homeId: this.homeId,
      homes: this.homes,
      cameras: this.cameras,
      tokenExpiresAt: this.tokens?.expiresAt ?? null,
      canRefresh: !!this.tokens?.refreshToken,
      error: this.lastError,
    };
  }

  private emitStatus() {
    this.emit('status', this.status());
  }

  /** Exchange an authorization code (from the login window) for tokens. */
  async completeLogin(code: string, verifier: string): Promise<CloudStatus> {
    this.busy = true;
    this.lastError = null;
    this.emitStatus();
    try {
      const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: HUE_CLIENT_ID, code, redirect_uri: HUE_REDIRECT_URI, code_verifier: verifier });
      const res = await fetch(`https://${HUE_AUTH_DOMAIN}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || !data.access_token) throw new Error(`Token exchange failed (${res.status}): ${String(data.error_description ?? data.error ?? 'no access token')}`);
      this.setTokens(data);
      this.log('Signed in to the Hue account.');
      await this.discover();
    } catch (err) {
      this.lastError = (err as Error).message;
      this.log(`Login failed: ${this.lastError}`);
      throw err;
    } finally {
      this.busy = false;
      this.emitStatus();
    }
    return this.status();
  }

  private setTokens(data: Record<string, unknown>) {
    const access = String(data.access_token);
    const expiresIn = Number(data.expires_in ?? 0);
    this.tokens = {
      accessToken: access,
      refreshToken: (data.refresh_token as string | undefined) ?? this.tokens?.refreshToken ?? null,
      expiresAt: expiresIn ? Date.now() + expiresIn * 1000 : jwtExpiry(access) || Date.now() + 3600_000,
      obtainedAt: Date.now(),
    };
    this.save();
  }

  signOut(): CloudStatus {
    this.tokens = null;
    this.homes = [];
    this.cameras = [];
    this.homeId = null;
    this.lastError = null;
    try {
      fs.rmSync(this.opts.file, { force: true });
    } catch {
      /* ignore */
    }
    this.emitStatus();
    return this.status();
  }

  private async refreshIfNeeded(): Promise<void> {
    if (!this.tokens) throw new Error('Not signed in to a Hue account.');
    if (Date.now() < this.tokens.expiresAt - 60_000) return;
    if (!this.tokens.refreshToken) throw new Error('The Hue session expired. Sign in again.');
    const attempt = async (url: string, body: URLSearchParams) => {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || !data.access_token) throw new Error(`refresh ${res.status}: ${String(data.error_description ?? data.error ?? '')}`);
      return data;
    };
    try {
      const data = await attempt(`https://${HUE_AUTH_DOMAIN}/oauth/token`, new URLSearchParams({ grant_type: 'refresh_token', client_id: HUE_CLIENT_ID, refresh_token: this.tokens.refreshToken }));
      this.setTokens(data);
      this.log('Hue session refreshed.');
    } catch (err) {
      this.log(`Session refresh failed: ${(err as Error).message}`);
      throw new Error('The Hue session could not be refreshed. Sign in again.');
    }
  }

  private async api(method: 'GET' | 'POST' | 'PUT', pathname: string, body?: unknown): Promise<{ status: number; data: unknown }> {
    await this.refreshIfNeeded();
    const res = await fetch(`${HUE_ACCOUNT_API}${pathname}`, {
      method,
      headers: { authorization: `Bearer ${this.tokens!.accessToken}`, 'content-type': 'application/json', accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      /* keep text */
    }
    this.log(`${method} ${pathname} → ${res.status}${data && typeof data === 'object' ? ` (${Object.keys(data as object).slice(0, 12).join(', ')})` : ''}`);
    return { status: res.status, data };
  }

  /** Lists homes and cameras of the signed-in account. */
  async discover(): Promise<CloudStatus> {
    this.busy = true;
    this.lastError = null;
    this.emitStatus();
    try {
      let homes: CloudHome[] = [];
      let unauthorized = 0;
      for (const p of ['/security/vss/v1/homes', '/data/v1/homes']) {
        const r = await this.api('GET', p);
        if (r.status === 200) {
          homes = pickHomes(r.data);
          if (homes.length) break;
        } else if (r.status === 401 || r.status === 403) unauthorized++;
      }
      this.authRejected = unauthorized === 2 && homes.length === 0;
      if (this.authRejected) {
        this.lastError = 'The Hue account API rejected the session token (401).';
        this.log(this.lastError);
      }
      this.homes = homes;
      if (!this.homeId || !homes.some((h) => h.id === this.homeId)) this.homeId = homes[0]?.id ?? this.homeId;
      if (this.homeId) {
        const r = await this.api('GET', `/security/device-configuration/v1/home/${encodeURIComponent(this.homeId)}/devices`);
        if (r.status === 200) this.cameras = pickCameras(r.data);
        else this.lastError = `Could not list cameras (HTTP ${r.status}).`;
      } else {
        this.lastError = 'The Hue account has no home with cameras.';
      }
      this.save();
    } catch (err) {
      this.lastError = (err as Error).message;
    } finally {
      this.busy = false;
      this.emitStatus();
    }
    return this.status();
  }

  async setHome(homeId: string): Promise<CloudStatus> {
    this.homeId = homeId;
    return this.discover();
  }

  /** Wakes a battery camera and fetches everything the renderer needs to open the WebRTC session. */
  async prepareLiveView(cameraId: string): Promise<LiveViewSession> {
    if (!this.homeId) throw new Error('No home selected.');
    const home = encodeURIComponent(this.homeId);
    const dev = encodeURIComponent(cameraId);
    const wake = await this.api('PUT', `/security/device-configuration/v1/home/${home}/device/${dev}/command`, { action_type: 'wake_up' }).catch((err) => ({ status: 0, data: String(err) }));
    if (wake.status >= 400) this.log(`wake_up returned ${wake.status}; continuing`);
    await new Promise((r) => setTimeout(r, 1200));

    const r = await this.api('POST', `/security/vss/v1/home/${home}/credentials/live-stream?turn_servers=true`, { device_id_list: [cameraId] });
    if (r.status !== 200) throw new Error(`The Hue cloud refused live-stream credentials (HTTP ${r.status}). ${typeof r.data === 'string' ? r.data.slice(0, 200) : JSON.stringify(r.data).slice(0, 200)}`);
    const parsed = parseLiveStreamCredentials(r.data, cameraId);
    this.log(`live-stream response keys: ${parsed.keys.join(', ')}`);
    if (!parsed.creds) throw new Error(`No AWS credentials in the live-stream response (keys: ${parsed.keys.join(', ')}).`);
    if (!parsed.channelArn) throw new Error(`No signaling channel in the live-stream response (keys: ${parsed.keys.join(', ')}).`);
    const region = parsed.region ?? 'eu-west-1';

    const endpoints = await getSignalingChannelEndpoints(region, parsed.channelArn, parsed.creds);
    if (!endpoints.wss) throw new Error('Kinesis returned no WebSocket endpoint for the camera channel.');
    const clientId = `HuePilot-${Math.random().toString(36).slice(2, 10)}`;
    let iceServers = parsed.iceServers;
    if (!iceServers.some((s) => String(s.urls).includes('turn')) && endpoints.https) {
      try {
        iceServers = [...iceServers, ...(await getIceServerConfig(endpoints.https, region, parsed.channelArn, clientId, parsed.creds))];
        this.log(`KVS provided ${iceServers.length} ICE server entries.`);
      } catch (err) {
        this.log(`KVS ICE config unavailable: ${(err as Error).message}`);
      }
    }
    if (!iceServers.length) iceServers = [{ urls: `stun:stun.kinesisvideo.${region}.amazonaws.com:443` }];
    const wssUrl = presignWebSocketUrl(endpoints.wss, parsed.channelArn, clientId, region, parsed.creds);
    return {
      cameraId,
      cameraName: this.cameras.find((c) => c.id === cameraId)?.name ?? cameraId,
      clientId,
      wssUrl,
      iceServers,
      region,
      channelArn: parsed.channelArn,
      responseKeys: parsed.keys,
      expiresAt: Date.now() + 290_000,
    };
  }
}
