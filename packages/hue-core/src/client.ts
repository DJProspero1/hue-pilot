import http from 'node:http';
import https from 'node:https';
import { HttpError, openSse, request } from './http.ts';
import type {
  BridgeConfigV1,
  BridgeConnection,
  DiscoveredBridge,
  EventStreamUpdate,
  LightState,
  LightUpdateBody,
  Resource,
  ResourceRef,
  ResourceType,
  SceneAction,
  SceneResource,
  ScheduleMapV1,
  ScheduleV1,
} from './types.ts';

export const DISCOVERY_URL = 'https://discovery.meethue.com/';
export const DEFAULT_DEVICE_TYPE = 'hue_pilot#desktop';

export class HueApiError extends Error {
  readonly errors: { description: string; type?: number }[];
  readonly status?: number;
  constructor(message: string, errors: { description: string; type?: number }[] = [], status?: number) {
    super(message);
    this.name = 'HueApiError';
    this.errors = errors;
    this.status = status;
  }
}

export class LinkButtonNotPressedError extends Error {
  constructor() {
    super('Press the link button on the Hue bridge, then try again.');
    this.name = 'LinkButtonNotPressedError';
  }
}

export interface BridgeTarget {
  host: string;
  port?: number;
  protocol?: 'https' | 'http';
}

export interface PairResult {
  appKey: string;
  clientKey?: string;
}

export type StreamStatus = 'connecting' | 'open' | 'closed';

export function bridgeBaseUrl(target: BridgeTarget): string {
  const protocol = target.protocol ?? 'https';
  const defaultPort = protocol === 'https' ? 443 : 80;
  const port = target.port ?? defaultPort;
  return `${protocol}://${target.host}${port !== defaultPort ? `:${port}` : ''}`;
}

function isSecure(target: BridgeTarget): boolean {
  return (target.protocol ?? 'https') === 'https';
}

/** Build the CLIP v2 PUT body for a friendly light state. */
export function buildLightUpdate(state: LightState, opts: { effectsV2?: boolean } = {}): LightUpdateBody {
  const body: LightUpdateBody = {};
  if (state.on !== undefined) body.on = { on: state.on };
  if (state.brightness !== undefined) {
    body.dimming = { brightness: Math.max(0, Math.min(100, Math.round(state.brightness * 100) / 100)) };
  }
  if (state.xy) body.color = { xy: { x: Number(state.xy.x.toFixed(4)), y: Number(state.xy.y.toFixed(4)) } };
  if (state.mirek !== undefined) body.color_temperature = { mirek: Math.max(153, Math.min(500, Math.round(state.mirek))) };
  if (state.effect !== undefined) {
    if (opts.effectsV2) body.effects_v2 = { action: { effect: state.effect } };
    else body.effects = { effect: state.effect };
  }
  if (state.transitionMs !== undefined) {
    body.dynamics = { duration: Math.max(0, Math.min(6_000_000, Math.round(state.transitionMs))) };
  }
  return body;
}

export class HueClient {
  private readonly agent: http.Agent | https.Agent;
  readonly conn: BridgeConnection;

  constructor(conn: BridgeConnection) {
    this.conn = conn;
    this.agent =
      (conn.protocol ?? 'https') === 'https'
        ? new https.Agent({ keepAlive: true, maxSockets: 4, rejectUnauthorized: false })
        : new http.Agent({ keepAlive: true, maxSockets: 4 });
  }

  get baseUrl(): string {
    return bridgeBaseUrl(this.conn);
  }

  // ---------------------------------------------------------------------------
  // CLIP v2
  // ---------------------------------------------------------------------------

  async v2<T = Resource>(method: 'GET' | 'PUT' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T[]> {
    const res = await request(`${this.baseUrl}/clip/v2/resource${path}`, {
      method,
      headers: { 'hue-application-key': this.conn.appKey },
      body: body === undefined ? undefined : JSON.stringify(body),
      insecureTls: isSecure(this.conn),
      agent: this.agent,
    });
    let parsed: { errors?: { description: string; type?: number }[]; data?: T[] };
    try {
      parsed = res.body ? JSON.parse(res.body) : {};
    } catch {
      throw new HueApiError(`Invalid response from bridge (HTTP ${res.status})`, [], res.status);
    }
    if (res.status === 401 || res.status === 403) {
      throw new HueApiError('The bridge rejected the app key. Pair the app again.', parsed.errors ?? [], res.status);
    }
    if (res.status >= 400 || (parsed.errors && parsed.errors.length > 0)) {
      const msg = parsed.errors?.map((e) => e.description).join('; ') || `Bridge returned HTTP ${res.status}`;
      throw new HueApiError(msg, parsed.errors ?? [], res.status);
    }
    return parsed.data ?? [];
  }

  getAll(): Promise<Resource[]> {
    return this.v2<Resource>('GET', '');
  }

  getResources<T extends Resource = Resource>(type: ResourceType): Promise<T[]> {
    return this.v2<T>('GET', `/${type}`);
  }

  async getResource<T extends Resource = Resource>(type: ResourceType, id: string): Promise<T | undefined> {
    const list = await this.v2<T>('GET', `/${type}/${id}`);
    return list[0];
  }

  updateResource(type: ResourceType, id: string, body: unknown): Promise<ResourceRef[]> {
    return this.v2<ResourceRef>('PUT', `/${type}/${id}`, body);
  }

  createResource(type: ResourceType, body: unknown): Promise<ResourceRef[]> {
    return this.v2<ResourceRef>('POST', `/${type}`, body);
  }

  deleteResource(type: ResourceType, id: string): Promise<ResourceRef[]> {
    return this.v2<ResourceRef>('DELETE', `/${type}/${id}`);
  }

  setLight(id: string, state: LightState, opts: { effectsV2?: boolean } = {}): Promise<ResourceRef[]> {
    return this.updateResource('light', id, buildLightUpdate(state, opts));
  }

  setGroupedLight(id: string, state: LightState): Promise<ResourceRef[]> {
    const body = buildLightUpdate(state);
    delete body.effects;
    delete body.effects_v2;
    return this.updateResource('grouped_light', id, body);
  }

  recallScene(id: string, action: 'active' | 'dynamic_palette' | 'static' = 'active', durationMs?: number) {
    const recall: Record<string, unknown> = { action };
    if (durationMs !== undefined) recall.duration = Math.round(durationMs);
    return this.updateResource('scene', id, { recall });
  }

  createScene(input: {
    name: string;
    group: ResourceRef;
    actions: SceneAction[];
    speed?: number;
    autoDynamic?: boolean;
    palette?: SceneResource['palette'];
  }): Promise<ResourceRef[]> {
    const body: Record<string, unknown> = {
      type: 'scene',
      metadata: { name: input.name },
      group: input.group,
      actions: input.actions,
    };
    if (input.speed !== undefined) body.speed = input.speed;
    if (input.autoDynamic !== undefined) body.auto_dynamic = input.autoDynamic;
    if (input.palette) body.palette = input.palette;
    return this.createResource('scene', body);
  }

  updateScene(id: string, patch: Record<string, unknown>): Promise<ResourceRef[]> {
    return this.updateResource('scene', id, patch);
  }

  deleteScene(id: string): Promise<ResourceRef[]> {
    return this.deleteResource('scene', id);
  }

  rename(type: ResourceType, id: string, name: string): Promise<ResourceRef[]> {
    return this.updateResource(type, id, { metadata: { name } });
  }

  identify(lightId: string): Promise<ResourceRef[]> {
    return this.updateResource('light', lightId, { alert: { action: 'breathe' } });
  }

  identifyGroup(groupedLightId: string): Promise<ResourceRef[]> {
    return this.updateResource('grouped_light', groupedLightId, { alert: { action: 'breathe' } });
  }

  /** Motion detection on/off for a Hue Secure camera (`camera_motion` service). */
  setCameraMotionDetection(cameraMotionId: string, enabled: boolean): Promise<ResourceRef[]> {
    return this.updateResource('camera_motion', cameraMotionId, { enabled });
  }

  // ---------------------------------------------------------------------------
  // API v1 (schedules, config, light search)
  // ---------------------------------------------------------------------------

  async v1<T = unknown>(method: 'GET' | 'PUT' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
    const res = await request(`${this.baseUrl}/api/${this.conn.appKey}${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      insecureTls: isSecure(this.conn),
      agent: this.agent,
    });
    let parsed: unknown;
    try {
      parsed = res.body ? JSON.parse(res.body) : null;
    } catch {
      throw new HueApiError(`Invalid v1 response from bridge (HTTP ${res.status})`, [], res.status);
    }
    if (Array.isArray(parsed)) {
      const errors = parsed.filter((e) => e && typeof e === 'object' && 'error' in e).map((e) => e.error);
      if (errors.length) {
        throw new HueApiError(
          errors.map((e: { description: string }) => e.description).join('; '),
          errors,
          res.status,
        );
      }
    }
    if (res.status >= 400) throw new HueApiError(`Bridge returned HTTP ${res.status}`, [], res.status);
    return parsed as T;
  }

  getConfig(): Promise<BridgeConfigV1 & Record<string, unknown>> {
    return this.v1('GET', '/config');
  }

  async listSchedules(): Promise<ScheduleMapV1> {
    return (await this.v1<ScheduleMapV1>('GET', '/schedules')) ?? {};
  }

  async createSchedule(schedule: ScheduleV1): Promise<string> {
    const res = await this.v1<{ success: { id: string } }[]>('POST', '/schedules', schedule);
    return res?.[0]?.success?.id ?? '';
  }

  updateSchedule(id: string, patch: Partial<ScheduleV1>): Promise<unknown> {
    return this.v1('PUT', `/schedules/${id}`, patch);
  }

  deleteSchedule(id: string): Promise<unknown> {
    return this.v1('DELETE', `/schedules/${id}`);
  }

  /** Ask the bridge to search for new Zigbee lights for ~40 seconds. */
  searchNewLights(): Promise<unknown> {
    return this.v1('POST', '/lights');
  }

  getNewLights(): Promise<Record<string, unknown> & { lastscan?: string }> {
    return this.v1('GET', '/lights/new');
  }

  // ---------------------------------------------------------------------------
  // Event stream
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to the bridge event stream with automatic reconnection.
   * Returns a function that stops the stream.
   */
  subscribe(
    handler: (events: EventStreamUpdate[]) => void,
    onStatus?: (status: StreamStatus, error?: Error) => void,
  ): () => void {
    let stopped = false;
    let handle: { close(): void } | null = null;
    let retryMs = 1000;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (stopped) return;
      onStatus?.('connecting');
      handle = openSse(`${this.baseUrl}/eventstream/clip/v2`, {
        headers: { 'hue-application-key': this.conn.appKey },
        insecureTls: isSecure(this.conn),
        onOpen: () => {
          retryMs = 1000;
          onStatus?.('open');
        },
        onData: (data) => {
          try {
            const parsed = JSON.parse(data);
            if (Array.isArray(parsed)) handler(parsed as EventStreamUpdate[]);
          } catch {
            /* ignore malformed frames */
          }
        },
        onClose: (err) => {
          if (stopped) return;
          onStatus?.('closed', err);
          timer = setTimeout(connect, retryMs);
          retryMs = Math.min(retryMs * 2, 30_000);
        },
      });
    };
    connect();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      handle?.close();
    };
  }

  // ---------------------------------------------------------------------------
  // Static helpers: discovery, config, pairing
  // ---------------------------------------------------------------------------

  static async discover(timeoutMs = 6000): Promise<DiscoveredBridge[]> {
    try {
      const res = await request(DISCOVERY_URL, { timeoutMs });
      if (res.status !== 200) return [];
      const list = JSON.parse(res.body) as { id: string; internalipaddress: string; port?: number }[];
      return list.map((b) => ({ ...b, source: 'cloud' as const }));
    } catch {
      return [];
    }
  }

  static async getBridgeConfig(target: BridgeTarget, timeoutMs = 5000): Promise<BridgeConfigV1> {
    const res = await request(`${bridgeBaseUrl(target)}/api/0/config`, {
      timeoutMs,
      insecureTls: isSecure(target),
    });
    if (res.status !== 200) throw new HttpError(`Bridge at ${target.host} answered HTTP ${res.status}`, res.status);
    return JSON.parse(res.body) as BridgeConfigV1;
  }

  /** One pairing attempt. Throws LinkButtonNotPressedError until the button has been pressed. */
  static async pair(target: BridgeTarget, deviceType = DEFAULT_DEVICE_TYPE): Promise<PairResult> {
    const res = await request(`${bridgeBaseUrl(target)}/api`, {
      method: 'POST',
      body: JSON.stringify({ devicetype: deviceType, generateclientkey: true }),
      insecureTls: isSecure(target),
      timeoutMs: 8000,
    });
    let parsed: { success?: { username: string; clientkey?: string }; error?: { type: number; description: string } }[];
    try {
      parsed = JSON.parse(res.body);
    } catch {
      throw new HueApiError(`Unexpected pairing response (HTTP ${res.status})`, [], res.status);
    }
    const first = parsed[0];
    if (first?.success?.username) return { appKey: first.success.username, clientKey: first.success.clientkey };
    if (first?.error?.type === 101) throw new LinkButtonNotPressedError();
    throw new HueApiError(first?.error?.description ?? 'Pairing failed', first?.error ? [first.error] : [], res.status);
  }
}
