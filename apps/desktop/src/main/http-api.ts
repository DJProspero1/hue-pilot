import http from 'node:http';
import type { ToolDefinition, ToolResult } from '@hue/core';
import type { ChatMessage } from '../shared/ipc-types.ts';

export interface LocalApiOptions {
  getToken(): string;
  listTools(): ToolDefinition[];
  execute(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  chat(text: string): Promise<ChatMessage[]>;
  overview(): Promise<unknown>;
}

/**
 * Tiny local HTTP API (127.0.0.1 only) so scripts, shortcuts and other agents can drive the lights:
 *   GET  /api/health
 *   GET  /api/tools                      -> tool definitions
 *   GET  /api/home                       -> rooms/lights/scenes overview
 *   POST /api/tools/<name>  {args}       -> run a tool
 *   POST /api/chat          {"message"}  -> ask the Gemini assistant
 * Auth: Authorization: Bearer <token> (token shown in the app's Assistant page).
 */
export class LocalApi {
  private server: http.Server | null = null;
  port = 0;

  constructor(private readonly opts: LocalApiOptions) {}

  async start(port: number): Promise<number> {
    await this.stop();
    this.server = http.createServer((req, res) => this.handle(req, res).catch((err) => this.json(res, 500, { ok: false, error: String(err?.message ?? err) })));
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(port, '127.0.0.1', () => resolve());
    });
    this.port = (this.server.address() as { port: number }).port;
    return this.port;
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const s = this.server;
    this.server = null;
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }

  private json(res: http.ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  private readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          resolve(raw ? JSON.parse(raw) : {});
        } catch {
          resolve({});
        }
      });
    });
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname.replace(/\/+$/, '');
    if (path === '/api/health') return this.json(res, 200, { ok: true, app: 'hue-pilot' });

    const auth = req.headers.authorization ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : (url.searchParams.get('token') ?? '');
    if (!token || token !== this.opts.getToken()) return this.json(res, 401, { ok: false, error: 'unauthorized' });

    if (req.method === 'GET' && path === '/api/tools') return this.json(res, 200, { ok: true, tools: this.opts.listTools() });
    if (req.method === 'GET' && path === '/api/home') return this.json(res, 200, await this.opts.overview());
    const tool = path.match(/^\/api\/tools\/([a-z_]+)$/);
    if (req.method === 'POST' && tool) {
      const args = await this.readBody(req);
      return this.json(res, 200, await this.opts.execute(tool[1], args));
    }
    if (req.method === 'POST' && path === '/api/chat') {
      const body = await this.readBody(req);
      const text = String(body.message ?? body.text ?? '');
      if (!text) return this.json(res, 400, { ok: false, error: 'message is required' });
      const messages = await this.opts.chat(text);
      const reply = [...messages].reverse().find((m) => m.role === 'assistant' || m.role === 'error');
      return this.json(res, 200, { ok: reply?.role !== 'error', reply: reply?.text ?? '', messages });
    }
    this.json(res, 404, { ok: false, error: 'not found' });
  }
}
