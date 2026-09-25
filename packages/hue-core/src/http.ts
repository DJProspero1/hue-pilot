import http from 'node:http';
import https from 'node:https';

export interface HttpResponse {
  status: number;
  body: string;
  headers: http.IncomingHttpHeaders;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  /** Disable TLS verification (only for the local bridge, which uses a private CA). */
  insecureTls?: boolean;
  agent?: http.Agent | https.Agent;
}

export class HttpError extends Error {
  readonly status?: number;
  readonly body?: string;
  constructor(message: string, status?: number, body?: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
  }
}

export function request(url: string, opts: RequestOptions = {}): Promise<HttpResponse> {
  const u = new URL(url);
  const isHttps = u.protocol === 'https:';
  const lib = isHttps ? https : http;
  const body = opts.body;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: u.pathname + u.search,
        method: opts.method ?? 'GET',
        headers: {
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
          ...(opts.headers ?? {}),
        },
        rejectUnauthorized: !opts.insecureTls,
        timeout: opts.timeoutMs ?? 10_000,
        agent: opts.agent,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }),
        );
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new HttpError(`Request to ${u.host} timed out`)));
    req.on('error', (err) => reject(err instanceof HttpError ? err : new HttpError(`${err.message} (${u.host})`)));
    if (body) req.write(body);
    req.end();
  });
}

export interface SseHandle {
  close(): void;
}

export interface SseOptions {
  headers?: Record<string, string>;
  insecureTls?: boolean;
  onData: (data: string) => void;
  onOpen?: () => void;
  onClose?: (err?: Error) => void;
}

/** Minimal Server-Sent-Events reader on top of node http/https. */
export function openSse(url: string, opts: SseOptions): SseHandle {
  const u = new URL(url);
  const isHttps = u.protocol === 'https:';
  const lib = isHttps ? https : http;
  let closed = false;
  const req = lib.request(
    {
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + u.search,
      method: 'GET',
      headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache', ...(opts.headers ?? {}) },
      rejectUnauthorized: !opts.insecureTls,
    },
    (res) => {
      if ((res.statusCode ?? 0) >= 400) {
        opts.onClose?.(new HttpError(`Event stream rejected with status ${res.statusCode}`, res.statusCode));
        res.resume();
        return;
      }
      opts.onOpen?.();
      let buffer = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        buffer += chunk;
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLines = block
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trimStart());
          if (dataLines.length) opts.onData(dataLines.join('\n'));
        }
      });
      res.on('end', () => {
        if (!closed) opts.onClose?.();
      });
      res.on('error', (err) => {
        if (!closed) opts.onClose?.(err);
      });
    },
  );
  req.on('error', (err) => {
    if (!closed) opts.onClose?.(err);
  });
  req.end();
  return {
    close() {
      closed = true;
      req.destroy();
    },
  };
}
