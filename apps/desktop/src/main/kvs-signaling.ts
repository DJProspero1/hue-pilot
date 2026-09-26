import { createHash, createHmac } from 'node:crypto';

/**
 * Amazon Kinesis Video Streams (KVS) WebRTC signaling helpers: SigV4-signed API calls and the
 * pre-signed WebSocket URL a VIEWER uses to talk to a MASTER (the camera). Pure functions, no
 * Electron dependency, so they are unit-tested in Node.
 */

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

const sha256Hex = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data, 'utf8').digest();

/** RFC 3986 encoding as required by SigV4 (encodeURIComponent plus `!'()*`). */
export function sigv4Encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function amzDate(now: Date = new Date()): { date: string; dateTime: string } {
  const iso = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return { date: iso.slice(0, 8), dateTime: iso };
}

function signingKey(secret: string, date: string, region: string, service: string): Buffer {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), service), 'aws4_request');
}

/** Canonical query string: keys sorted, values encoded. */
export function canonicalQuery(params: Record<string, string>): string {
  return Object.keys(params)
    .sort()
    .map((k) => `${sigv4Encode(k)}=${sigv4Encode(params[k])}`)
    .join('&');
}

/** Signs a JSON POST to a KVS REST endpoint and returns the headers to send. */
export function signJsonPost(url: string, body: string, region: string, creds: AwsCredentials, service = 'kinesisvideo', now: Date = new Date()): Record<string, string> {
  const u = new URL(url);
  const { date, dateTime } = amzDate(now);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    host: u.host,
    'x-amz-date': dateTime,
  };
  if (creds.sessionToken) headers['x-amz-security-token'] = creds.sessionToken;
  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map((k) => `${k}:${headers[k].trim()}\n`)
    .join('');
  const canonicalRequest = ['POST', u.pathname || '/', canonicalQuery(Object.fromEntries(u.searchParams)), canonicalHeaders, signedHeaders, sha256Hex(body)].join('\n');
  const scope = `${date}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', dateTime, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = createHmac('sha256', signingKey(creds.secretAccessKey, date, region, service)).update(stringToSign).digest('hex');
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

/**
 * Pre-signed WebSocket URL for the KVS signaling channel (query-string SigV4, 5 minutes validity).
 * Mirrors what the AWS KVS WebRTC JS SDK's SigV4RequestSigner produces for a VIEWER.
 */
export function presignWebSocketUrl(endpoint: string, channelArn: string, clientId: string, region: string, creds: AwsCredentials, now: Date = new Date()): string {
  const u = new URL(endpoint);
  const { date, dateTime } = amzDate(now);
  const scope = `${date}/${region}/kinesisvideo/aws4_request`;
  const params: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-ChannelARN': channelArn,
    'X-Amz-ClientId': clientId,
    'X-Amz-Credential': `${creds.accessKeyId}/${scope}`,
    'X-Amz-Date': dateTime,
    'X-Amz-Expires': '299',
    'X-Amz-SignedHeaders': 'host',
  };
  if (creds.sessionToken) params['X-Amz-Security-Token'] = creds.sessionToken;
  const query = canonicalQuery(params);
  const canonicalRequest = ['GET', u.pathname || '/', query, `host:${u.host}\n`, 'host', sha256Hex('')].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', dateTime, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = createHmac('sha256', signingKey(creds.secretAccessKey, date, region, 'kinesisvideo')).update(stringToSign).digest('hex');
  return `${u.protocol}//${u.host}${u.pathname || '/'}?${query}&X-Amz-Signature=${signature}`;
}

export interface SignalingEndpoints {
  wss: string | null;
  https: string | null;
}

/** GetSignalingChannelEndpoint for a VIEWER (returns the WSS and HTTPS endpoints). */
export async function getSignalingChannelEndpoints(region: string, channelArn: string, creds: AwsCredentials): Promise<SignalingEndpoints> {
  const url = `https://kinesisvideo.${region}.amazonaws.com/getSignalingChannelEndpoint`;
  const body = JSON.stringify({ ChannelARN: channelArn, SingleMasterChannelEndpointConfiguration: { Protocols: ['WSS', 'HTTPS'], Role: 'VIEWER' } });
  const res = await fetch(url, { method: 'POST', headers: signJsonPost(url, body, region, creds), body });
  if (!res.ok) throw new Error(`KVS getSignalingChannelEndpoint ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { ResourceEndpointList?: { Protocol: string; ResourceEndpoint: string }[] };
  const list = data.ResourceEndpointList ?? [];
  return {
    wss: list.find((e) => e.Protocol === 'WSS')?.ResourceEndpoint ?? null,
    https: list.find((e) => e.Protocol === 'HTTPS')?.ResourceEndpoint ?? null,
  };
}

/** GetIceServerConfig (TURN servers managed by KVS) through the channel's HTTPS endpoint. */
export async function getIceServerConfig(httpsEndpoint: string, region: string, channelArn: string, clientId: string, creds: AwsCredentials): Promise<IceServer[]> {
  const url = `${httpsEndpoint.replace(/\/$/, '')}/v1/get-ice-server-config`;
  const body = JSON.stringify({ ChannelARN: channelArn, ClientId: clientId, Service: 'TURN' });
  const res = await fetch(url, { method: 'POST', headers: signJsonPost(url, body, region, creds), body });
  if (!res.ok) throw new Error(`KVS get-ice-server-config ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { IceServerList?: { Uris: string[]; Username: string; Password: string }[] };
  return (data.IceServerList ?? []).map((s) => ({ urls: s.Uris, username: s.Username, credential: s.Password }));
}

/** Normalises the many shapes an ICE-server list can take in Hue's response into RTCIceServer entries. */
export function normalizeIceServers(input: unknown): IceServer[] {
  const out: IceServer[] = [];
  const push = (v: unknown) => {
    if (!v || typeof v !== 'object') return;
    const o = v as Record<string, unknown>;
    const urls = (o.urls ?? o.url ?? o.uris ?? o.uri) as string | string[] | undefined;
    if (!urls) return;
    out.push({
      urls,
      username: (o.username as string | undefined) ?? undefined,
      credential: ((o.credential ?? o.password) as string | undefined) ?? undefined,
    });
  };
  if (Array.isArray(input)) input.forEach(push);
  else push(input);
  return out;
}
