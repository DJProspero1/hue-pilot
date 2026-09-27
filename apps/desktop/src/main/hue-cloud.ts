import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type { AwsCredentials, IceServer } from './kvs-signaling.ts';
import { getIceServerConfig, getSignalingChannelEndpoints, normalizeIceServers, presignWebSocketUrl } from './kvs-signaling.ts';
import { offerSignatureVariants, type OfferSignatureVariant } from './hue-e2ee.ts';
import { decodeMessage, getBool, getMessages, getString, grpcStatusName, grpcWebUnary, type ProtoMessage } from './grpc-web.ts';
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
 * Homes and their devices come from the same gRPC-Web service the Hue account portal uses
 * (`hue.accounts.v1.HomeService/ListHomes` on api.account.meethue.com); each home lists its devices
 * as `{type, id}` where camera types are the Hue Secure model ids (CMB001 battery, CMW00x wired /
 * floodlight). Camera names come from the portal's REST endpoint
 * `security/device-configuration/v1/home/{home}/device/{camera}`.
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

/**
 * @param responseMode `fragment` puts the code in the URL hash. The Hue account site only consumes
 *   codes found in the query string, so with `fragment` the address bar keeps
 *   `https://account.meethue.com/#code=…&state=…` and the user can copy it (system-browser sign-in).
 */
export function buildAuthorizeUrl(challenge: string, state: string, audience: string | null = HUE_AUDIENCE, responseMode: 'query' | 'fragment' = 'query'): string {
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
  if (responseMode === 'fragment') params.set('response_mode', 'fragment');
  return `https://${HUE_AUTH_DOMAIN}/authorize?${params.toString()}`;
}

/**
 * Returns the authorization code when [text] is the redirect back to account.meethue.com
 * (query or fragment form, possibly pasted with surrounding whitespace) or a bare pasted code.
 */
export function extractAuthCode(text: string, expectedState?: string): { code: string | null; state: string | null; error: string | null } {
  const raw = text.trim();
  if (!raw) return { code: null, state: null, error: null };
  const base = HUE_REDIRECT_URI.replace(/\/$/, '');
  const fromUrl = raw.match(/https?:\/\/\S+/)?.[0] ?? null;
  if (fromUrl) {
    try {
      const u = new URL(fromUrl);
      if (!u.href.startsWith(base)) return { code: null, state: null, error: null };
      const params = new URLSearchParams(u.search);
      const hash = new URLSearchParams(u.hash.replace(/^#/, ''));
      const get = (k: string) => params.get(k) ?? hash.get(k);
      const code = get('code');
      const state = get('state');
      const error = get('error_description') ?? get('error');
      if (expectedState && state && state !== expectedState) return { code: null, state, error: 'state mismatch' };
      return { code, state, error };
    } catch {
      return { code: null, state: null, error: null };
    }
  }
  // Bare parameters ("code=…&state=…") or a bare code.
  if (/^[A-Za-z0-9_-]{8,}$/.test(raw)) return { code: raw, state: null, error: null };
  if (/(^|[?#&])code=/.test(raw)) {
    const p = new URLSearchParams(raw.replace(/^[?#]/, ''));
    const state = p.get('state');
    if (expectedState && state && state !== expectedState) return { code: null, state, error: 'state mismatch' };
    return { code: p.get('code'), state, error: p.get('error_description') ?? p.get('error') };
  }
  return { code: null, state: null, error: null };
}

/** A sign-in started in the system browser, waiting for the code to come back. */
export interface PendingLogin {
  verifier: string;
  state: string;
  audience: string | null;
  startedAt: number;
  /** `browser`: observed through DevTools; `clipboard`: the user copies the address. */
  method: 'browser' | 'clipboard';
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

/** Hue Secure camera model ids as the account portal knows them (CMW001–CMW005, CMB001–CMB002). */
export const HUE_CAMERA_MODELS = /^CM[BW]\d{3}$/i;

export function cameraModelLabel(type: string): string {
  const t = type.toUpperCase();
  if (t.startsWith('CMB')) return 'Secure battery camera';
  if (t === 'CMW002') return 'Secure floodlight camera';
  if (t.startsWith('CMW')) return 'Secure wired camera';
  return 'Camera';
}

/** Cameras among a home's devices (from ListHomes). */
export function homeCameras(home: CloudHome): { type: string; id: string }[] {
  return (home.devices ?? []).filter((d) => HUE_CAMERA_MODELS.test(d.type));
}

/**
 * Builds a CloudCamera from the device-configuration document. The cloud answers
 * `{ reported: { id, metadata: { name, archetype }, product_data: { model_id, product_name }, service: { camera: { "0": { e2ee: { live_view: { enabled } } } },
 * device_power: { "0": { power_state: { battery_level } } }, wifi_connectivity: { "0": { strength } }, zigbee_connectivity: { "0": { status } } } } }`.
 */
export function pickCameraDetails(config: unknown, device: { type: string; id: string }): CloudCamera {
  const root = (config && typeof config === 'object' && !Array.isArray(config) ? config : {}) as Record<string, unknown>;
  const rep = (root.reported && typeof root.reported === 'object' ? root.reported : root) as Record<string, unknown>;
  const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const meta = obj(rep.metadata);
  const product = obj(rep.product_data);
  const service = obj(rep.service);
  const svc = (name: string) => obj(obj(service[name])['0']);
  const power = obj(svc('device_power').power_state);
  const liveView = obj(obj(svc('camera').e2ee).live_view);
  const zigbee = svc('zigbee_connectivity');
  const wifi = svc('wifi_connectivity');
  const model = String(product.model_id ?? device.type ?? '') || null;
  const productName = typeof product.product_name === 'string' ? product.product_name : null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    id: device.id,
    name: String(meta.name ?? rep.name ?? '') || `${cameraModelLabel(device.type)} ${device.id.slice(-4)}`,
    model,
    online: typeof zigbee.status === 'string' ? zigbee.status === 'connected' : typeof rep.enabled === 'boolean' ? rep.enabled : null,
    raw: Object.keys(rep),
    productName,
    battery: num(power.battery_level),
    wifiStrength: num(wifi.strength),
    liveViewProtected: typeof liveView.enabled === 'boolean' ? liveView.enabled : null,
  };
}

/**
 * Decodes `hue.accounts.v1.ListHomesResponse` (field 1: repeated BasicHome). BasicHome fields, from
 * the portal's generated code: 1 id, 2 name, 3 user_count, 4 bridges (HomeBridgeRef: 1 id),
 * 5 max_users, 6 devices (Device: 1 type, 2 id), 7 admin_count, 8 revision, 9 permissions,
 * 10 country_code, 11 time_zone, 12 device_update_preference, 13 security_activated.
 */
export function parseListHomes(payload: Buffer): CloudHome[] {
  return getMessages(decodeMessage(payload), 1)
    .map((h: ProtoMessage): CloudHome => {
      const id = getString(h, 1);
      return {
        id,
        name: getString(h, 2) || (id ? `Home ${id}` : ''),
        bridges: getMessages(h, 4)
          .map((b) => getString(b, 1))
          .filter(Boolean),
        devices: getMessages(h, 6)
          .map((d) => ({ type: getString(d, 1), id: getString(d, 2) }))
          .filter((d) => d.id),
        securityActivated: getBool(h, 13),
      };
    })
    .filter((h) => h.id);
}

/** Prefer the home that actually has cameras, then the first one. */
export function pickDefaultHome(homes: CloudHome[]): CloudHome | undefined {
  return homes.find((h) => homeCameras(h).length) ?? homes[0];
}

export interface LiveStreamGrant {
  creds: AwsCredentials | null;
  channelArn: string | null;
  region: string | null;
  iceServers: IceServer[];
  /** KVS signaling endpoints when the cloud hands them out (saves a GetSignalingChannelEndpoint call). */
  endpoints: { wss: string | null; https: string | null };
  /** Earliest expiry of the credentials/TURN grants, epoch ms. */
  expiresAt: number | null;
  keys: string[];
}

/**
 * Pulls AWS credentials, channel ARN, region and ICE servers out of the live-stream response.
 * The cloud answers (2026): `{ credentials: { AccessKeyId, SecretAccessKey, SessionToken, Expiration },
 * signaling_channels: [{ id, arn }], turn_servers: [{ device_id, ice_servers: [{ urls, username, password, expires_at }],
 * http_signal_channel_endpoint, wss_signal_channel_endpoint }], stun_servers: ["stun:…"], earliest_expiry }`.
 * Other shapes (per-device objects, camelCase names) are still tolerated.
 */
export function parseLiveStreamCredentials(data: unknown, cameraId: string): LiveStreamGrant {
  const keys: string[] = [];
  const wanted = cameraId.toUpperCase();
  const asList = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]) : []);
  const forDevice = (list: Record<string, unknown>[]) => list.find((e) => String(e.id ?? e.device_id ?? e.deviceId ?? '').toUpperCase() === wanted) ?? list[0];
  const root = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;

  const channel = forDevice(asList(root.signaling_channels ?? root.signalingChannels));
  const turn = forDevice(asList(root.turn_servers ?? root.turnServers));
  const iceServers: IceServer[] = [];
  if (turn) {
    if (Array.isArray(turn.ice_servers ?? turn.iceServers)) iceServers.push(...normalizeIceServers(turn.ice_servers ?? turn.iceServers));
    else if (turn.urls || turn.url) iceServers.push(...normalizeIceServers([turn]));
  }
  for (const s of Array.isArray(root.stun_servers ?? root.stunServers) ? (root.stun_servers ?? root.stunServers) as unknown[] : []) {
    if (typeof s === 'string') iceServers.push({ urls: s });
  }
  const endpoints = {
    wss: (typeof turn?.wss_signal_channel_endpoint === 'string' ? turn.wss_signal_channel_endpoint : null) as string | null,
    https: (typeof turn?.http_signal_channel_endpoint === 'string' ? turn.http_signal_channel_endpoint : null) as string | null,
  };
  const expiry = typeof root.earliest_expiry === 'string' ? Date.parse(root.earliest_expiry) : NaN;
  const expiresAt = Number.isFinite(expiry) ? expiry : null;
  const channelArnDirect = channel && typeof channel.arn === 'string' ? channel.arn : null;

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
  const channelArn = channelArnDirect ?? (find(node, ['channelArn', 'channel_arn', 'ChannelARN', 'signalingChannelArn', 'signaling_channel_arn']) as string | undefined) ?? null;
  let region = (find(node, ['region', 'aws_region', 'awsRegion', 'Region']) as string | undefined) ?? null;
  if (!region && channelArn) region = channelArn.split(':')[3] ?? null;
  if (!iceServers.length) iceServers.push(...normalizeIceServers(find(node, ['iceServers', 'ice_servers', 'turnServers', 'turn_servers', 'IceServerList'])));
  return { creds: creds && creds.accessKeyId && creds.secretAccessKey ? creds : null, channelArn, region, iceServers, endpoints, expiresAt, keys };
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
  /** True when the user typed the home id by hand (kept even if ListHomes does not return it). */
  private homeManual = false;
  private lastError: string | null = null;
  private busy = false;
  private readonly opts: HueCloudOptions;

  /** Set when the account API answered 401/403 with a freshly obtained token (wrong audience). */
  authRejected = false;
  /** Sign-in started in the system browser and not finished yet. */
  pending: PendingLogin | null = null;
  /** Index into the audience candidates for the next sign-in (advanced after a rejected token). */
  audienceAttempt = 0;

  /** Starts a system-browser sign-in: remembers the PKCE verifier and returns the URL to open. */
  beginBrowserLogin(audience: string | null, responseMode: 'query' | 'fragment' = 'query', method: PendingLogin['method'] = 'browser'): string {
    const { verifier, challenge } = pkcePair();
    const state = randomBytes(12).toString('base64url');
    this.pending = { verifier, state, audience, startedAt: Date.now(), method };
    this.lastError = null;
    this.emitStatus();
    return buildAuthorizeUrl(challenge, state, audience, responseMode);
  }

  /** The home's E2EE passphrase (10 words from the Hue app), kept encrypted with the session. */
  private passphrase: string | null = null;

  setPassphrase(p: string | null): CloudStatus {
    this.passphrase = p && p.trim() ? p : null;
    this.save();
    this.emitStatus();
    return this.status();
  }

  /** Candidate signed-offer payload fields for [sdp]; empty without a passphrase. */
  signOffer(sdp: string): OfferSignatureVariant[] {
    if (!this.passphrase) return [];
    return offerSignatureVariants(sdp, this.passphrase, this.homeId);
  }

  cancelBrowserLogin(): CloudStatus {
    this.pending = null;
    this.emitStatus();
    return this.status();
  }

  /**
   * Finishes a system-browser sign-in from the pasted (or clipboard-detected) redirect address.
   * Returns null when [text] is not a usable redirect for the pending login.
   */
  async finishBrowserLogin(text: string): Promise<CloudStatus | null> {
    const p = this.pending;
    if (!p) throw new Error('No sign-in is waiting. Click "Sign in with your browser" first.');
    const { code, error, state } = extractAuthCode(text, p.state);
    if (error === 'state mismatch') throw new Error('That address comes from the Hue account site\'s own sign-in (it starts one by itself), not from Hue Pilot\'s. Use "Sign in with your browser", which captures the result automatically.');
    if (error) throw new Error(`Sign-in failed: ${error}`);
    if (!code) return null;
    if (state && state !== p.state) return null;
    this.pending = null;
    return this.completeLogin(code, p.verifier);
  }

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
      const parsed = JSON.parse(json) as { tokens?: StoredTokens; homeId?: string | null; homes?: CloudHome[]; cameras?: CloudCamera[]; passphrase?: string | null };
      this.tokens = parsed.tokens ?? null;
      this.homeId = parsed.homeId ?? null;
      this.homes = parsed.homes ?? [];
      this.cameras = parsed.cameras ?? [];
      this.passphrase = parsed.passphrase ?? null;
    } catch (err) {
      this.lastError = `Could not read saved Hue account session: ${(err as Error).message}`;
    }
  }

  private save() {
    const json = JSON.stringify({ tokens: this.tokens, homeId: this.homeId, homes: this.homes, cameras: this.cameras, passphrase: this.passphrase });
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
      pendingLogin: this.pending ? { startedAt: this.pending.startedAt, method: this.pending.method } : null,
      hasPassphrase: !!this.passphrase,
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
      if (this.authRejected) {
        this.audienceAttempt += 1;
        this.log('The account API rejected this token; the next sign-in will request a different audience.');
      }
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
    this.passphrase = null;
    this.pending = null;
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

  /**
   * `hue.accounts.v1.HomeService/ListHomes` over gRPC-Web, exactly as the Hue account portal does.
   * Sets [authRejected] and throws when the token is not accepted.
   */
  private async listHomes(): Promise<CloudHome[]> {
    await this.refreshIfNeeded();
    const call = { base: HUE_ACCOUNT_API, method: '/hue.accounts.v1.HomeService/ListHomes', request: Buffer.alloc(0), headers: { authorization: `Bearer ${this.tokens!.accessToken}` } };
    let r = await grpcWebUnary({ ...call, format: 'binary' });
    // Some proxies only speak the base64 flavour; retry with it when binary was refused outright.
    if (r.grpcStatus === null && ![401, 403].includes(r.httpStatus) && r.httpStatus >= 400) r = await grpcWebUnary({ ...call, format: 'text' });
    this.log(`gRPC HomeService/ListHomes → HTTP ${r.httpStatus}, ${grpcStatusName(r.grpcStatus)}${r.grpcMessage ? ` (${r.grpcMessage})` : ''}${r.bodyText ? ` ${r.bodyText.slice(0, 120)}` : ''}`);
    if (r.httpStatus === 401 || r.httpStatus === 403 || r.grpcStatus === 16 || r.grpcStatus === 7) {
      this.authRejected = true;
      throw new Error(`The Hue account API rejected the session token (HTTP ${r.httpStatus}, ${grpcStatusName(r.grpcStatus)}).`);
    }
    if (r.httpStatus >= 400 || (r.grpcStatus !== null && r.grpcStatus !== 0)) throw new Error(`Listing homes failed (HTTP ${r.httpStatus}, ${grpcStatusName(r.grpcStatus)}${r.grpcMessage ? `: ${r.grpcMessage}` : ''}).`);
    const homes = r.messages.length ? parseListHomes(r.messages[0]) : [];
    this.log(
      homes.length
        ? `Homes: ${homes.map((h) => `${h.name} [${h.id}] — ${homeCameras(h).length} camera(s), ${h.bridges?.length ?? 0} bridge(s), ${(h.devices ?? []).length} device(s)${h.securityActivated ? ', Secure active' : ''}`).join('; ')}`
        : 'ListHomes returned no homes for this account.',
    );
    return homes;
  }

  /** Camera details from the portal's REST endpoint; returns whatever fields the cloud has (name, strength, …). */
  private async cameraConfig(homeId: string, deviceId: string): Promise<Record<string, unknown>> {
    const r = await this.api('GET', `/security/device-configuration/v1/home/${encodeURIComponent(homeId)}/device/${encodeURIComponent(deviceId)}`);
    return r.status === 200 && r.data && typeof r.data === 'object' && !Array.isArray(r.data) ? (r.data as Record<string, unknown>) : {};
  }

  /** Lists homes and cameras of the signed-in account. */
  async discover(): Promise<CloudStatus> {
    this.busy = true;
    this.lastError = null;
    this.emitStatus();
    try {
      this.authRejected = false;
      const homes = await this.listHomes();
      this.homes = homes;
      const known = homes.some((h) => h.id === this.homeId);
      if (!known && !(this.homeManual && this.homeId)) this.homeId = pickDefaultHome(homes)?.id ?? null;

      const cameras: CloudCamera[] = [];
      if (this.homeId) {
        const home = homes.find((h) => h.id === this.homeId);
        for (const d of home ? homeCameras(home) : []) {
          const cam = pickCameraDetails(await this.cameraConfig(this.homeId, d.id), d);
          this.log(`Camera ${cam.name} (${cam.productName ?? cam.model ?? d.type}, ${d.id}): ${cam.online === null ? 'link unknown' : cam.online ? 'connected' : 'not connected'}${cam.battery !== null && cam.battery !== undefined ? `, battery ${cam.battery}%` : ''}, live view protection ${cam.liveViewProtected === null ? 'unknown' : cam.liveViewProtected ? 'ON (needs the passphrase)' : 'off'}`);
          cameras.push(cam);
        }
        if (!cameras.length) {
          // Home typed by hand, or a home whose device list did not carry the cameras: try the flat device listing.
          const r = await this.api('GET', `/security/device-configuration/v1/home/${encodeURIComponent(this.homeId)}/devices`);
          if (r.status === 200) cameras.push(...pickCameras(r.data));
        }
        this.cameras = cameras;
        if (!cameras.length) {
          this.lastError = home
            ? `Home "${home.name}" has ${(home.devices ?? []).length} device(s) linked to the account but no Hue Secure camera. Cameras are added to the account by the Hue app when they are set up.`
            : `No cameras were found for home ${this.homeId}.`;
        }
      } else {
        this.cameras = [];
        this.lastError = homes.length ? 'No home selected.' : 'ListHomes returned no homes for this Hue account. Check that the app is signed in with the same account as the Hue app (Hue app → Settings → Hue account), or enter the home id by hand below.';
      }
      this.save();
    } catch (err) {
      this.lastError = (err as Error).message;
      this.log(`Discovery failed: ${this.lastError}`);
    } finally {
      this.busy = false;
      this.emitStatus();
    }
    return this.status();
  }

  async setHome(homeId: string): Promise<CloudStatus> {
    const id = homeId.trim();
    if (!id) return this.status();
    this.homeId = id;
    this.homeManual = !this.homes.some((h) => h.id === id);
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

    // The cloud usually hands out the signaling endpoints with the grant; ask KVS only when it did not.
    const endpoints = parsed.endpoints.wss ? parsed.endpoints : await getSignalingChannelEndpoints(region, parsed.channelArn, parsed.creds);
    this.log(`Signaling endpoints ${parsed.endpoints.wss ? 'from the Hue cloud' : 'from KVS'}: ${endpoints.wss ?? '-'}${parsed.expiresAt ? `; grant valid until ${new Date(parsed.expiresAt).toLocaleTimeString()}` : ''}`);
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
      expiresAt: parsed.expiresAt ?? Date.now() + 290_000,
    };
  }
}
