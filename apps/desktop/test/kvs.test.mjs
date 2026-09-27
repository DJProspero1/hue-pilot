import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, createHash } from 'node:crypto';
import { amzDate, canonicalQuery, normalizeIceServers, presignWebSocketUrl, signJsonPost, sigv4Encode } from '../src/main/kvs-signaling.ts';
import { buildAuthorizeUrl, extractAuthCode, parseLiveStreamCredentials, pickCameras, pickHomes, pkcePair } from '../src/main/hue-cloud.ts';

const creds = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', sessionToken: 'tok/en+123' };
const when = new Date('2026-09-26T12:00:00Z');

test('sigv4Encode follows RFC 3986 (spaces, slashes, reserved characters)', () => {
  assert.equal(sigv4Encode('a b/c:d'), 'a%20b%2Fc%3Ad');
  assert.equal(sigv4Encode("!'()*"), '%21%27%28%29%2A');
  assert.equal(sigv4Encode('arn:aws:kinesisvideo:eu-west-1:123:channel/x/1'), 'arn%3Aaws%3Akinesisvideo%3Aeu-west-1%3A123%3Achannel%2Fx%2F1');
});

test('canonical query sorts keys and encodes values', () => {
  assert.equal(canonicalQuery({ 'X-Amz-Date': '20260926T120000Z', 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-ChannelARN': 'a:b/c' }), 'X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-ChannelARN=a%3Ab%2Fc&X-Amz-Date=20260926T120000Z');
});

test('amzDate formats basic ISO 8601', () => {
  assert.deepEqual(amzDate(when), { date: '20260926', dateTime: '20260926T120000Z' });
});

test('presigned WebSocket URL has the KVS viewer parameters and a correct signature', () => {
  const arn = 'arn:aws:kinesisvideo:eu-west-1:123456789012:channel/hue-cam/1700000000000';
  const url = presignWebSocketUrl('wss://v-abc.kinesisvideo.eu-west-1.amazonaws.com', arn, 'HuePilot-1', 'eu-west-1', creds, when);
  const u = new URL(url);
  assert.equal(u.host, 'v-abc.kinesisvideo.eu-west-1.amazonaws.com');
  assert.equal(u.searchParams.get('X-Amz-Algorithm'), 'AWS4-HMAC-SHA256');
  assert.equal(u.searchParams.get('X-Amz-ChannelARN'), arn);
  assert.equal(u.searchParams.get('X-Amz-ClientId'), 'HuePilot-1');
  assert.equal(u.searchParams.get('X-Amz-Credential'), 'AKIDEXAMPLE/20260926/eu-west-1/kinesisvideo/aws4_request');
  assert.equal(u.searchParams.get('X-Amz-Expires'), '299');
  assert.equal(u.searchParams.get('X-Amz-Security-Token'), creds.sessionToken);
  assert.equal(u.searchParams.get('X-Amz-SignedHeaders'), 'host');
  // Recompute the signature independently (AWS SigV4 query signing).
  const query = url.split('?')[1].replace(/&X-Amz-Signature=.*$/, '');
  const canonicalRequest = ['GET', '/', query, 'host:v-abc.kinesisvideo.eu-west-1.amazonaws.com\n', 'host', createHash('sha256').update('').digest('hex')].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', '20260926T120000Z', '20260926/eu-west-1/kinesisvideo/aws4_request', createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
  const h = (k, d) => createHmac('sha256', k).update(d).digest();
  const key = h(h(h(h(`AWS4${creds.secretAccessKey}`, '20260926'), 'eu-west-1'), 'kinesisvideo'), 'aws4_request');
  const expected = createHmac('sha256', key).update(stringToSign).digest('hex');
  assert.equal(u.searchParams.get('X-Amz-Signature'), expected);
  // Query parameters must be in canonical (sorted) order in the URL itself.
  const keys = query.split('&').map((p) => p.split('=')[0]);
  assert.deepEqual(keys, [...keys].sort());
});

test('signed JSON POST carries the SigV4 authorization header with sorted signed headers', () => {
  const headers = signJsonPost('https://kinesisvideo.eu-west-1.amazonaws.com/getSignalingChannelEndpoint', '{"a":1}', 'eu-west-1', creds, 'kinesisvideo', when);
  assert.equal(headers['x-amz-date'], '20260926T120000Z');
  assert.equal(headers['x-amz-security-token'], creds.sessionToken);
  assert.match(headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20260926\/eu-west-1\/kinesisvideo\/aws4_request, SignedHeaders=content-type;host;x-amz-date;x-amz-security-token, Signature=[0-9a-f]{64}$/);
  // Deterministic for the same inputs.
  assert.equal(signJsonPost('https://kinesisvideo.eu-west-1.amazonaws.com/getSignalingChannelEndpoint', '{"a":1}', 'eu-west-1', creds, 'kinesisvideo', when).authorization, headers.authorization);
});

test('normalizeIceServers accepts the common shapes', () => {
  assert.deepEqual(normalizeIceServers([{ urls: 'stun:a' }, { url: 'turn:b', username: 'u', credential: 'c' }, { uris: ['turn:c'], username: 'u2', password: 'p2' }]), [
    { urls: 'stun:a', username: undefined, credential: undefined },
    { urls: 'turn:b', username: 'u', credential: 'c' },
    { urls: ['turn:c'], username: 'u2', credential: 'p2' },
  ]);
  assert.deepEqual(normalizeIceServers(undefined), []);
});

test('PKCE pair and authorize URL', () => {
  const { verifier, challenge } = pkcePair();
  assert.match(verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(challenge, createHash('sha256').update(verifier).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''));
  const url = new URL(buildAuthorizeUrl(challenge, 'st'));
  assert.equal(url.host, 'auth.meethue.com');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://account.meethue.com/');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('scope'), 'openid offline_access');
});

test('extractAuthCode only accepts the account.meethue.com redirect and checks state', () => {
  assert.deepEqual(extractAuthCode('https://account.meethue.com/?code=abc&state=st', 'st'), { code: 'abc', state: 'st', error: null });
  assert.equal(extractAuthCode('https://account.meethue.com/?code=abc&state=other', 'st').error, 'state mismatch');
  assert.equal(extractAuthCode('https://auth.meethue.com/u/login?state=x').code, null);
  assert.equal(extractAuthCode('https://account.meethue.com/?error=access_denied&error_description=Denied').error, 'Denied');
  // System-browser flow: code in the fragment, pasted with whitespace, or bare.
  assert.deepEqual(extractAuthCode('  https://account.meethue.com/#code=xyz_123&state=st \n', 'st'), { code: 'xyz_123', state: 'st', error: null });
  assert.deepEqual(extractAuthCode('code=q1&state=st', 'st'), { code: 'q1', state: 'st', error: null });
  assert.equal(extractAuthCode('Ab12CD34ef56').code, 'Ab12CD34ef56');
  assert.equal(extractAuthCode('hello world').code, null);
  const url = new URL(buildAuthorizeUrl('ch', 'st', 'https://account.meethue.com', 'fragment'));
  assert.equal(url.searchParams.get('response_mode'), 'fragment');
  assert.equal(url.searchParams.get('audience'), 'https://account.meethue.com');
});

test('pickHomes and pickCameras tolerate several response shapes', () => {
  assert.deepEqual(pickHomes({ homes: [{ id: 4618484926709760, name: 'Casa' }] }), [{ id: '4618484926709760', name: 'Casa' }]);
  assert.deepEqual(pickHomes([{ home_id: '1' }]), [{ id: '1', name: '1' }]);
  const cams = pickCameras({ devices: [
    { id: 'C4299615410E', model_id: 'CMW002', name: 'Driveway', online: true },
    { id: 'C42996154111', model_id: 'CMB001', product_name: 'Secure battery camera' },
    { id: 'BULB', model_id: 'LCA001', name: 'Lamp' },
  ] });
  assert.deepEqual(cams.map((c) => [c.id, c.name, c.model, c.online]), [['C4299615410E', 'Driveway', 'CMW002', true], ['C42996154111', 'Secure battery camera', 'CMB001', null]]);
});

test('parseLiveStreamCredentials finds credentials, channel and ICE servers in flat and nested shapes', () => {
  const flat = parseLiveStreamCredentials({ awsCredentials: { AccessKeyId: 'A', SecretAccessKey: 'S', SessionToken: 'T' }, channelArn: 'arn:aws:kinesisvideo:eu-west-1:1:channel/x/1', turn_servers: [{ urls: ['turn:t'], username: 'u', credential: 'c' }] }, 'CAM');
  assert.deepEqual(flat.creds, { accessKeyId: 'A', secretAccessKey: 'S', sessionToken: 'T' });
  assert.equal(flat.region, 'eu-west-1');
  assert.equal(flat.iceServers.length, 1);
  const nested = parseLiveStreamCredentials({ devices: [{ device_id: 'cam', credentials: { access_key_id: 'A', secret_access_key: 'S', session_token: 'T' }, signaling_channel_arn: 'arn:aws:kinesisvideo:us-east-1:1:channel/y/2', region: 'us-east-1' }] }, 'CAM');
  assert.equal(nested.creds?.accessKeyId, 'A');
  assert.equal(nested.channelArn, 'arn:aws:kinesisvideo:us-east-1:1:channel/y/2');
  assert.equal(nested.region, 'us-east-1');
  assert.ok(nested.keys.includes('devices'));
  const none = parseLiveStreamCredentials({ message: 'nope' }, 'CAM');
  assert.equal(none.creds, null);
});
