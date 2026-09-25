import { EventEmitter } from 'node:events';
import { applyEvents, buildHome, EMPTY_HOME, HueClient, type BridgeConnection, type HomeModel, type Resource } from '@hue/core/node';
import type { ConnectionStatus } from '../shared/ipc-types.ts';

/**
 * Owns the bridge connection: full resource cache, event stream, and the derived HomeModel.
 * Emits 'home' (HomeModel) and 'status' (ConnectionStatus).
 */
export class HueService extends EventEmitter {
  client: HueClient | null = null;
  resources = new Map<string, Resource>();
  home: HomeModel = EMPTY_HOME;
  status: ConnectionStatus = { state: 'disconnected', stream: 'closed' };

  private stopStream: (() => void) | null = null;
  private rebuildTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private conn: BridgeConnection | null = null;

  async connect(conn: BridgeConnection): Promise<void> {
    this.disconnect();
    this.conn = conn;
    this.client = new HueClient(conn);
    this.setStatus({ state: 'connecting', stream: 'closed', host: conn.host, bridgeName: conn.name });
    try {
      await this.refresh();
      this.setStatus({ state: 'connected', stream: 'connecting', host: conn.host, bridgeName: this.home.bridge?.name ?? conn.name, lastUpdate: Date.now() });
      this.startStream();
      this.pollTimer = setInterval(() => this.refresh().catch(() => undefined), 120_000);
    } catch (err) {
      this.setStatus({ state: 'error', stream: 'closed', host: conn.host, bridgeName: conn.name, error: (err as Error).message });
      this.retryTimer = setTimeout(() => {
        if (this.conn === conn && this.status.state === 'error') this.connect(conn).catch(() => undefined);
      }, 15_000);
    }
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
        if (applyEvents(this.resources, events)) this.scheduleRebuild();
      },
      (stream, err) => {
        this.setStatus({ ...this.status, stream, error: stream === 'closed' && err ? err.message : undefined });
      },
    );
  }

  private setStatus(status: ConnectionStatus) {
    this.status = status;
    this.emit('status', status);
  }
}
