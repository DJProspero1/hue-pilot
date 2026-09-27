import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import {
  applyEvents,
  buildHome,
  EMPTY_HOME,
  HueClient,
  type BridgeConnection,
  type EventStreamUpdate,
  type HomeModel,
  type MotionResource,
  type Resource,
} from '@hue/core/node';
import type { ConnectionStatus, MotionEvent } from '../shared/ipc-types.ts';

const MOTION_EVENT_LIMIT = 200;

/**
 * Owns the bridge connection: full resource cache, event stream, and the derived HomeModel.
 * Emits 'home' (HomeModel), 'status' (ConnectionStatus) and 'motion-event' (MotionEvent).
 */
export class HueService extends EventEmitter {
  client: HueClient | null = null;
  resources = new Map<string, Resource>();
  home: HomeModel = EMPTY_HOME;
  status: ConnectionStatus = { state: 'disconnected', stream: 'closed' };

  /** Ring buffer (oldest first) of motion events from cameras and motion sensors. */
  private motionEvents: MotionEvent[] = [];
  /** Last motion report we recorded per motion/camera_motion service id, to de-duplicate. */
  private lastMotion = new Map<string, { motion: boolean; changed: string | null }>();

  private stopStream: (() => void) | null = null;
  private rebuildTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private conn: BridgeConnection | null = null;

  private attempt = 0;

  /**
   * Connects and keeps connecting: any failure schedules a retry with backoff (3 s → 30 s), and
   * a session whose event stream is not open polls the bridge every 20 s instead of every 2 min,
   * so the app keeps working even when the bridge refuses another stream client.
   */
  async connect(conn: BridgeConnection): Promise<void> {
    this.disconnect();
    this.conn = conn;
    this.client = new HueClient(conn);
    this.setStatus({ state: 'connecting', stream: 'closed', host: conn.host, bridgeName: conn.name });
    try {
      await this.refresh();
      this.attempt = 0;
      this.setStatus({ state: 'connected', stream: 'connecting', host: conn.host, bridgeName: this.home.bridge?.name ?? conn.name, lastUpdate: Date.now() });
      this.startStream();
      this.schedulePoll();
    } catch (err) {
      this.attempt += 1;
      const delay = Math.min(30_000, 3_000 * 2 ** Math.min(this.attempt - 1, 4));
      this.setStatus({ state: 'error', stream: 'closed', host: conn.host, bridgeName: conn.name, error: `${(err as Error).message} — retrying in ${Math.round(delay / 1000)} s` });
      this.retryTimer = setTimeout(() => {
        if (this.conn === conn) this.connect(conn).catch(() => undefined);
      }, delay);
    }
  }

  /** Re-run the connection from scratch (fresh client and event stream). Safe to call any time. */
  async reconnect(conn: BridgeConnection | null = this.conn): Promise<void> {
    if (!conn) return;
    this.attempt = 0;
    await this.connect(conn);
  }

  private schedulePoll() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    const ms = this.status.stream === 'open' ? 120_000 : 20_000;
    this.pollTimer = setInterval(() => {
      this.refresh().catch((err) => {
        // The bridge went away: fall back to the connect/retry loop.
        if (this.conn) {
          this.setStatus({ ...this.status, state: 'error', error: (err as Error).message });
          this.connect(this.conn).catch(() => undefined);
        }
      });
    }, ms);
  }

  disconnect() {
    this.stopStream?.();
    this.stopStream = null;
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.pollTimer = this.retryTimer = this.rebuildTimer = null;
    this.client = null;
    this.conn = null;
    this.resources.clear();
    this.home = EMPTY_HOME;
    this.motionEvents = [];
    this.lastMotion.clear();
    this.setStatus({ state: 'disconnected', stream: 'closed' });
    this.emit('home', this.home);
  }

  get connected(): boolean {
    return !!this.client && this.status.state === 'connected';
  }

  requireClient(): HueClient {
    if (!this.client) throw new Error('No Hue bridge is connected. Pair a bridge first.');
    return this.client;
  }

  async refresh(): Promise<HomeModel> {
    const client = this.requireClient();
    const all = await client.getAll();
    this.resources = new Map(all.map((r) => [r.id, r]));
    this.rebuild();
    this.seedMotionTimeline();
    if (this.status.state === 'error') {
      this.setStatus({ ...this.status, state: 'connected', error: undefined });
      this.startStream();
    }
    return this.home;
  }

  async getHome(): Promise<HomeModel> {
    if (!this.client) throw new Error('No Hue bridge is connected. Pair a bridge first.');
    if (!this.resources.size) await this.refresh();
    return this.home;
  }

  /** Motion detection on/off for a Hue Secure camera (camera_motion service id). */
  async setCameraMotionDetection(cameraMotionId: string, enabled: boolean): Promise<void> {
    await this.requireClient().setCameraMotionDetection(cameraMotionId, enabled);
  }

  /** Motion timeline, newest first. */
  getMotionEvents(): MotionEvent[] {
    return [...this.motionEvents].reverse();
  }

  /** Wait for the next home rebuild (event stream) or the timeout, so reads after writes see fresh state. */
  settle(timeoutMs = 400): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(done, timeoutMs);
      const self = this;
      function done() {
        clearTimeout(timer);
        self.off('home', done);
        resolve();
      }
      this.once('home', done);
    });
  }

  private rebuild() {
    this.home = buildHome(this.resources.values());
    this.status.lastUpdate = Date.now();
    this.emit('home', this.home);
  }

  private scheduleRebuild() {
    if (this.rebuildTimer) return;
    this.rebuildTimer = setTimeout(() => {
      this.rebuildTimer = null;
      this.rebuild();
    }, 40);
  }

  private startStream() {
    if (!this.client || this.stopStream) return;
    this.stopStream = this.client.subscribe(
      (events) => {
        this.collectMotionEvents(events);
        if (applyEvents(this.resources, events)) this.scheduleRebuild();
      },
      (stream, err) => {
        const was = this.status.stream;
        this.setStatus({ ...this.status, stream, error: stream === 'closed' && err ? err.message : undefined });
        if ((was === 'open') !== (stream === 'open')) this.schedulePoll();
      },
    );
  }

  // ---------------------------------------------------------------------------
  // Motion timeline
  // ---------------------------------------------------------------------------

  private sourceOf(service: Pick<MotionResource, 'type' | 'owner'>): { sourceId: string; sourceName: string; kind: MotionEvent['kind'] } | null {
    const ownerId = service.owner?.rid;
    if (!ownerId) return null;
    const camera = this.home.cameras.find((c) => c.id === ownerId);
    if (camera) return { sourceId: camera.id, sourceName: camera.name, kind: 'camera' };
    const accessory = this.home.accessories.find((a) => a.deviceId === ownerId);
    const device = this.resources.get(ownerId) as { metadata?: { name?: string }; product_data?: { product_name?: string } } | undefined;
    const name = accessory?.name ?? device?.metadata?.name ?? device?.product_data?.product_name ?? (service.type === 'camera_motion' ? 'Camera' : 'Motion sensor');
    return { sourceId: ownerId, sourceName: name, kind: service.type === 'camera_motion' ? 'camera' : 'sensor' };
  }

  private pushMotionEvent(service: Pick<MotionResource, 'type' | 'owner'>, motion: boolean, at: string | undefined) {
    const source = this.sourceOf(service);
    if (!source) return;
    const when = at && Number.isFinite(Date.parse(at)) ? new Date(at).toISOString() : new Date().toISOString();
    const event: MotionEvent = { id: randomUUID(), ...source, motion, at: when };
    this.motionEvents.push(event);
    if (this.motionEvents.length > MOTION_EVENT_LIMIT) this.motionEvents.splice(0, this.motionEvents.length - MOTION_EVENT_LIMIT);
    this.emit('motion-event', event);
  }

  /**
   * Record the current state of every camera / motion sensor the first time we see it (initial state),
   * and any motion that happened while the stream was down (poll refresh).
   */
  private seedMotionTimeline() {
    for (const r of this.resources.values()) {
      if (r.type !== 'motion' && r.type !== 'camera_motion') continue;
      const m = r as MotionResource;
      const report = m.motion?.motion_report;
      const motion = typeof m.motion?.motion === 'boolean' ? m.motion.motion : report?.motion;
      if (typeof motion !== 'boolean') continue;
      const changed = report?.changed ?? null;
      const prev = this.lastMotion.get(m.id);
      this.lastMotion.set(m.id, { motion, changed });
      if (!prev) this.pushMotionEvent(m, motion, changed ?? undefined);
      else if (motion && (prev.motion !== true || prev.changed !== changed)) this.pushMotionEvent(m, true, changed ?? undefined);
    }
  }

  /** From the event stream: a motion event whenever motion flips to true. */
  private collectMotionEvents(events: EventStreamUpdate[]) {
    for (const ev of events) {
      if (ev.type !== 'update' || !Array.isArray(ev.data)) continue;
      for (const item of ev.data) {
        if (!item || (item.type !== 'motion' && item.type !== 'camera_motion')) continue;
        const patch = item as Partial<MotionResource> & { id: string; type: 'motion' | 'camera_motion' };
        const report = patch.motion?.motion_report;
        const motion = typeof patch.motion?.motion === 'boolean' ? patch.motion.motion : report?.motion;
        if (typeof motion !== 'boolean') continue;
        const existing = this.resources.get(patch.id) as MotionResource | undefined;
        const prev = this.lastMotion.get(patch.id)?.motion ?? existing?.motion?.motion ?? existing?.motion?.motion_report?.motion;
        const changed = report?.changed ?? ev.creationtime ?? null;
        this.lastMotion.set(patch.id, { motion, changed });
        if (motion && prev !== true) {
          this.pushMotionEvent({ type: patch.type, owner: patch.owner ?? existing?.owner ?? { rid: '', rtype: 'device' } }, true, changed ?? undefined);
        }
      }
    }
  }

  private setStatus(status: ConnectionStatus) {
    this.status = status;
    this.emit('status', status);
  }
}
