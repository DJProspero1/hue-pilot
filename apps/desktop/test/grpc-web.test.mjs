import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeBase64Stream, decodeMessage, encodeBytesField, encodeVarint, encodeVarintField, frameMessage, getBool, getMessages, getString, getVarint, grpcStatusName, parseFrames, readVarint } from '../src/main/grpc-web.ts';
import { cameraModelLabel, homeCameras, parseListHomes, pickDefaultHome } from '../src/main/hue-cloud.ts';

const basicHome = (id, name, devices, bridges, secure) =>
  Buffer.concat([
    encodeBytesField(1, id),
    encodeBytesField(2, name),
    encodeVarintField(3, 2),
    ...bridges.map((b) => encodeBytesField(4, encodeBytesField(1, b))),
    encodeVarintField(5, 10),
    ...devices.map(([type, devId]) => encodeBytesField(6, Buffer.concat([encodeBytesField(1, type), encodeBytesField(2, devId)]))),
    encodeVarintField(7, 1),
    encodeVarintField(8, 123456789012n),
    encodeBytesField(9, 'home:read'),
    encodeBytesField(10, 'PT'),
    encodeBytesField(11, 'Europe/Lisbon'),
    encodeVarintField(12, 1),
    encodeVarintField(13, secure),
  ]);

test('varints round-trip, including multi-byte and 64-bit values', () => {
  for (const n of [0n, 1n, 127n, 128n, 300n, 2n ** 32n, 123456789012n, 2n ** 63n]) {
    const buf = encodeVarint(n);
    const r = readVarint(buf, 0);
    assert.equal(r.value, n);
    assert.equal(r.pos, buf.length);
  }
  assert.deepEqual([...encodeVarint(300)], [0xac, 0x02]);
  assert.throws(() => readVarint(Buffer.from([0x80]), 0), /truncated/);
});

test('generic message decoding keeps repeated fields in order and skips fixed-width fields', () => {
  const buf = Buffer.concat([
    encodeBytesField(1, 'a'),
    encodeBytesField(1, 'b'),
    Buffer.concat([encodeVarint((3 << 3) | 1), Buffer.alloc(8, 0xff)]),
    Buffer.concat([encodeVarint((4 << 3) | 5), Buffer.alloc(4, 0x01)]),
    encodeVarintField(2, true),
  ]);
  const m = decodeMessage(buf);
  assert.deepEqual([...m.keys()], [1, 3, 4, 2]);
  assert.equal(getString(m, 1), 'b');
  assert.equal(getBool(m, 2), true);
  assert.equal(getVarint(m, 9), null);
  assert.equal(getString(m, 9), '');
  assert.throws(() => decodeMessage(Buffer.from([0x0a, 0x05, 0x01])), /truncated/);
});

test('ListHomesResponse decodes into homes with devices, bridges and camera detection', () => {
  const response = Buffer.concat([
    encodeBytesField(1, basicHome('4618484926709760', 'Casa', [['BSB003', '001788FFFE123456'], ['CMB001', 'A0B1C2D3E4F5'], ['CMW002', 'A0B1C2D3E4F6'], ['HSB001', 'sync1']], ['001788FFFE123456'], true)),
    encodeBytesField(1, basicHome('99', 'Cabana', [], [], false)),
  ]);
  const homes = parseListHomes(response);
  assert.equal(homes.length, 2);
  assert.equal(homes[0].id, '4618484926709760');
  assert.equal(homes[0].name, 'Casa');
  assert.deepEqual(homes[0].bridges, ['001788FFFE123456']);
  assert.equal(homes[0].devices.length, 4);
  assert.equal(homes[0].securityActivated, true);
  assert.deepEqual(homeCameras(homes[0]), [
    { type: 'CMB001', id: 'A0B1C2D3E4F5' },
    { type: 'CMW002', id: 'A0B1C2D3E4F6' },
  ]);
  assert.deepEqual(homeCameras(homes[1]), []);
  assert.equal(homes[1].securityActivated, false);
  assert.equal(pickDefaultHome(homes).id, '4618484926709760');
  assert.equal(pickDefaultHome([homes[1]]).id, '99');
  assert.equal(pickDefaultHome([]), undefined);
  assert.equal(cameraModelLabel('CMB001'), 'Secure battery camera');
  assert.equal(cameraModelLabel('CMW002'), 'Secure floodlight camera');
  assert.equal(cameraModelLabel('CMW001'), 'Secure wired camera');
  // A home with no name gets a readable placeholder; homes without an id are dropped.
  assert.equal(parseListHomes(encodeBytesField(1, encodeBytesField(1, 'x')))[0].name, 'Home x');
  assert.deepEqual(parseListHomes(encodeBytesField(1, encodeBytesField(2, 'nameless'))), []);
  assert.deepEqual(parseListHomes(Buffer.alloc(0)), []);
});

test('gRPC-Web frames: data and trailer frames, binary and base64-text bodies', () => {
  // 'hey' makes the framed message 10 bytes long, so its base64 form ends with padding.
  const payload = encodeBytesField(1, 'hey');
  const trailers = Buffer.from('grpc-status: 0\r\ngrpc-message: \r\nx-extra: yes\r\n');
  const body = Buffer.concat([frameMessage(payload), frameMessage(trailers, true)]);
  assert.equal(body[0], 0x00);
  assert.equal(body.readUInt32BE(1), payload.length);
  assert.equal(body[5 + payload.length], 0x80);
  const parsed = parseFrames(body);
  assert.equal(parsed.messages.length, 1);
  assert.equal(getString(decodeMessage(parsed.messages[0]), 1), 'hey');
  assert.deepEqual(parsed.trailers, { 'grpc-status': '0', 'grpc-message': '', 'x-extra': 'yes' });
  assert.throws(() => parseFrames(body.subarray(0, body.length - 1)), /truncated/);
  assert.throws(() => parseFrames(Buffer.concat([body, Buffer.from([1, 2])])), /trailing/);

  // grpc-web-text: each frame base64-encoded separately, concatenated with padding in the middle.
  const text = frameMessage(payload).toString('base64') + frameMessage(trailers, true).toString('base64');
  assert.ok(text.includes('=') && text.indexOf('=') < text.length - 2);
  assert.deepEqual(decodeBase64Stream(text), body);
  assert.deepEqual(decodeBase64Stream(Buffer.from('abc').toString('base64') + '\n' + Buffer.from('de').toString('base64')), Buffer.from('abcde'));
  assert.deepEqual(decodeBase64Stream(''), Buffer.alloc(0));

  const empty = frameMessage(Buffer.alloc(0));
  assert.deepEqual([...empty], [0, 0, 0, 0, 0]);
  assert.deepEqual(getMessages(decodeMessage(encodeBytesField(3, payload)), 3).map((m) => getString(m, 1)), ['hey']);
  assert.equal(grpcStatusName(16), 'UNAUTHENTICATED');
  assert.equal(grpcStatusName(null), 'no gRPC status');
  assert.equal(grpcStatusName(99), 'status 99');
});
