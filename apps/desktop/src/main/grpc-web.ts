/**
 * Minimal protobuf wire-format codec and gRPC-Web framing.
 *
 * The Hue account portal (account.meethue.com) talks to api.account.meethue.com with gRPC-Web
 * (protobuf messages over HTTP/1.1, see github.com/grpc/grpc-web). Hue Pilot only needs a few
 * read-only calls whose message layouts are known, so a generic tag/wire-type decoder is enough:
 * no generated code and no protobuf runtime.
 */

export type ProtoValue =
  | { wire: 0; value: bigint } // varint
  | { wire: 1; value: Buffer } // 64-bit
  | { wire: 2; value: Buffer } // length-delimited (string, bytes, embedded message, packed)
  | { wire: 5; value: Buffer }; // 32-bit

/** Field number → values in wire order. */
export type ProtoMessage = Map<number, ProtoValue[]>;

export function readVarint(buf: Buffer, pos: number): { value: bigint; pos: number } {
  let result = 0n;
  let shift = 0n;
  for (;;) {
    if (pos >= buf.length) throw new Error('protobuf: truncated varint');
    const b = buf[pos++];
    result |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) return { value: result, pos };
    shift += 7n;
    if (shift > 70n) throw new Error('protobuf: varint too long');
  }
}

export function encodeVarint(n: number | bigint): Buffer {
  let v = BigInt(n);
  if (v < 0n) v &= (1n << 64n) - 1n;
  const bytes: number[] = [];
  do {
    let b = Number(v & 0x7fn);
    v >>= 7n;
    if (v > 0n) b |= 0x80;
    bytes.push(b);
  } while (v > 0n);
  return Buffer.from(bytes);
}

/** Length-delimited field (string, bytes or embedded message). */
export function encodeBytesField(field: number, value: Buffer | string): Buffer {
  const payload = typeof value === 'string' ? Buffer.from(value, 'utf8') : value;
  return Buffer.concat([encodeVarint((field << 3) | 2), encodeVarint(payload.length), payload]);
}

export function encodeVarintField(field: number, value: number | bigint | boolean): Buffer {
  return Buffer.concat([encodeVarint(field << 3), encodeVarint(typeof value === 'boolean' ? (value ? 1 : 0) : value)]);
}

export function decodeMessage(buf: Buffer): ProtoMessage {
  const out: ProtoMessage = new Map();
  let pos = 0;
  while (pos < buf.length) {
    const tag = readVarint(buf, pos);
    pos = tag.pos;
    const field = Number(tag.value >> 3n);
    const wire = Number(tag.value & 7n);
    let v: ProtoValue;
    switch (wire) {
      case 0: {
        const r = readVarint(buf, pos);
        pos = r.pos;
        v = { wire: 0, value: r.value };
        break;
      }
      case 1: {
        if (pos + 8 > buf.length) throw new Error('protobuf: truncated 64-bit field');
        v = { wire: 1, value: buf.subarray(pos, pos + 8) };
        pos += 8;
        break;
      }
      case 2: {
        const len = readVarint(buf, pos);
        pos = len.pos;
        const n = Number(len.value);
        if (pos + n > buf.length) throw new Error('protobuf: truncated length-delimited field');
        v = { wire: 2, value: buf.subarray(pos, pos + n) };
        pos += n;
        break;
      }
      case 5: {
        if (pos + 4 > buf.length) throw new Error('protobuf: truncated 32-bit field');
        v = { wire: 5, value: buf.subarray(pos, pos + 4) };
        pos += 4;
        break;
      }
      default:
        throw new Error(`protobuf: unsupported wire type ${wire} (field ${field})`);
    }
    const list = out.get(field);
    if (list) list.push(v);
    else out.set(field, [v]);
  }
  return out;
}

export function getBytes(m: ProtoMessage, field: number): Buffer[] {
  return (m.get(field) ?? []).filter((v): v is { wire: 2; value: Buffer } => v.wire === 2).map((v) => v.value);
}

/** Last value wins, as protobuf specifies for non-repeated fields. */
export function getString(m: ProtoMessage, field: number): string {
  const list = getBytes(m, field);
  return list.length ? list[list.length - 1].toString('utf8') : '';
}

export function getStrings(m: ProtoMessage, field: number): string[] {
  return getBytes(m, field).map((b) => b.toString('utf8'));
}

export function getMessages(m: ProtoMessage, field: number): ProtoMessage[] {
  return getBytes(m, field).map(decodeMessage);
}

export function getVarint(m: ProtoMessage, field: number): bigint | null {
  const list = (m.get(field) ?? []).filter((v): v is { wire: 0; value: bigint } => v.wire === 0);
  return list.length ? list[list.length - 1].value : null;
}

export function getBool(m: ProtoMessage, field: number): boolean {
  const v = getVarint(m, field);
  return v !== null && v !== 0n;
}

/* ---------------------------------------------------------------- gRPC-Web framing */

/** One gRPC-Web frame: 1 flag byte (0x80 = trailers), 4-byte big-endian length, payload. */
export function frameMessage(payload: Buffer, trailer = false): Buffer {
  const header = Buffer.alloc(5);
  header[0] = trailer ? 0x80 : 0x00;
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
}

export function parseFrames(body: Buffer): { messages: Buffer[]; trailers: Record<string, string> } {
  const messages: Buffer[] = [];
  const trailers: Record<string, string> = {};
  let pos = 0;
  while (pos + 5 <= body.length) {
    const flag = body[pos];
    const n = body.readUInt32BE(pos + 1);
    if (pos + 5 + n > body.length) throw new Error('grpc-web: truncated frame');
    const chunk = body.subarray(pos + 5, pos + 5 + n);
    pos += 5 + n;
    if (flag & 0x80) {
      for (const line of chunk.toString('utf8').split(/\r?\n/)) {
        const i = line.indexOf(':');
        if (i > 0) trailers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
      }
    } else messages.push(chunk);
  }
  if (pos !== body.length) throw new Error('grpc-web: trailing bytes after the last frame');
  return { messages, trailers };
}

/**
 * grpc-web-text bodies are a sequence of independently base64-encoded chunks; padding may occur
 * mid-stream, which a single base64 decode would stop at. Decode chunk by chunk.
 */
export function decodeBase64Stream(text: string): Buffer {
  const parts: Buffer[] = [];
  let current = '';
  const clean = text.replace(/\s+/g, '');
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    current += ch;
    if (ch === '=' && (i + 1 === clean.length || clean[i + 1] !== '=')) {
      parts.push(Buffer.from(current, 'base64'));
      current = '';
    }
  }
  if (current) parts.push(Buffer.from(current, 'base64'));
  return Buffer.concat(parts);
}

const GRPC_STATUS_NAMES: Record<number, string> = {
  0: 'OK',
  1: 'CANCELLED',
  2: 'UNKNOWN',
  3: 'INVALID_ARGUMENT',
  4: 'DEADLINE_EXCEEDED',
  5: 'NOT_FOUND',
  6: 'ALREADY_EXISTS',
  7: 'PERMISSION_DENIED',
  8: 'RESOURCE_EXHAUSTED',
  9: 'FAILED_PRECONDITION',
  10: 'ABORTED',
  11: 'OUT_OF_RANGE',
  12: 'UNIMPLEMENTED',
  13: 'INTERNAL',
  14: 'UNAVAILABLE',
  15: 'DATA_LOSS',
  16: 'UNAUTHENTICATED',
};

export function grpcStatusName(code: number | null): string {
  if (code === null) return 'no gRPC status';
  return GRPC_STATUS_NAMES[code] ?? `status ${code}`;
}

export interface GrpcWebCall {
  /** e.g. `https://api.account.meethue.com` */
  base: string;
  /** e.g. `/hue.accounts.v1.HomeService/ListHomes` */
  method: string;
  /** Serialized request message (empty buffer for google.protobuf.Empty). */
  request: Buffer;
  headers?: Record<string, string>;
  /** `binary` = application/grpc-web+proto, `text` = application/grpc-web-text (base64). */
  format?: 'binary' | 'text';
  timeoutMs?: number;
}

export interface GrpcWebResult {
  httpStatus: number;
  /** Null when the response carried no gRPC status at all (proxy/HTTP-level failure). */
  grpcStatus: number | null;
  grpcMessage: string | null;
  /** Response messages (unary calls have at most one). */
  messages: Buffer[];
  /** Start of a non-gRPC body, for diagnostics. */
  bodyText: string;
}

export async function grpcWebUnary(call: GrpcWebCall): Promise<GrpcWebResult> {
  const text = call.format === 'text';
  const contentType = text ? 'application/grpc-web-text' : 'application/grpc-web+proto';
  const frame = frameMessage(call.request);
  const res = await fetch(`${call.base}${call.method}`, {
    method: 'POST',
    headers: {
      'content-type': contentType,
      accept: contentType,
      'x-grpc-web': '1',
      'x-user-agent': 'grpc-web-javascript/0.1',
      ...(call.headers ?? {}),
    },
    body: text ? frame.toString('base64') : new Uint8Array(frame),
    signal: AbortSignal.timeout(call.timeoutMs ?? 15_000),
  });
  const raw = Buffer.from(await res.arrayBuffer());
  const resType = res.headers.get('content-type') ?? '';
  let messages: Buffer[] = [];
  let trailers: Record<string, string> = {};
  let bodyText = '';
  if (resType.includes('grpc')) {
    try {
      const body = resType.includes('grpc-web-text') ? decodeBase64Stream(raw.toString('latin1')) : raw;
      ({ messages, trailers } = parseFrames(body));
    } catch (err) {
      bodyText = `unparseable gRPC body: ${(err as Error).message}`;
    }
  } else if (raw.length) {
    bodyText = raw.toString('utf8').slice(0, 300);
  }
  const statusHeader = trailers['grpc-status'] ?? res.headers.get('grpc-status');
  const grpcStatus = statusHeader !== null && statusHeader !== undefined && statusHeader !== '' ? Number(statusHeader) : res.ok && resType.includes('grpc') ? 0 : null;
  let grpcMessage = trailers['grpc-message'] ?? res.headers.get('grpc-message') ?? '';
  try {
    grpcMessage = decodeURIComponent(grpcMessage);
  } catch {
    /* keep raw */
  }
  return { httpStatus: res.status, grpcStatus, grpcMessage: grpcMessage || null, messages, bodyText };
}
