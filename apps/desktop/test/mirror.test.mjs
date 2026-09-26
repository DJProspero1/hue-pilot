import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAdbDevices, hintFor } from '../src/main/phone-mirror.ts';

test('parseAdbDevices reads serial, state, model and transport', () => {
  const text = [
    'List of devices attached',
    'emulator-5554          device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emu64xa transport_id:3',
    '2A281FDH2004YT         unauthorized usb:1-2 transport_id:5',
    '192.168.1.50:5555      device product:panther model:Pixel_7 device:panther transport_id:7',
    'adb-XYZ123._adb-tls-connect._tcp offline transport_id:9',
    '',
  ].join('\n');
  const devices = parseAdbDevices(text);
  assert.equal(devices.length, 4);
  assert.deepEqual(devices[0], { serial: 'emulator-5554', state: 'device', model: 'sdk gphone64 x86 64', transport: 'emulator' });
  assert.deepEqual(devices[1], { serial: '2A281FDH2004YT', state: 'unauthorized', model: null, transport: 'usb' });
  assert.deepEqual(devices[2], { serial: '192.168.1.50:5555', state: 'device', model: 'Pixel 7', transport: 'wifi' });
  assert.equal(devices[3].transport, 'wifi');
  assert.equal(devices[3].state, 'offline');
});

test('parseAdbDevices ignores daemon chatter and empty output', () => {
  assert.deepEqual(parseAdbDevices('* daemon not running; starting now at tcp:5037\n* daemon started successfully\nList of devices attached\n\n'), []);
  assert.deepEqual(parseAdbDevices(''), []);
});

test('hintFor explains the most common situations', () => {
  assert.match(hintFor([]) ?? '', /USB debugging/);
  assert.match(hintFor([{ serial: 'x', state: 'unauthorized', model: null, transport: 'usb' }]) ?? '', /Allow/);
  assert.match(hintFor([{ serial: 'x', state: 'offline', model: null, transport: 'usb' }]) ?? '', /offline/);
  assert.match(hintFor([{ serial: 'x', state: 'device', model: 'Pixel 7', transport: 'usb' }], '[server] ERROR: Could not start app') ?? '', /Philips Hue app is not installed/);
  assert.equal(hintFor([{ serial: 'x', state: 'device', model: 'Pixel 7', transport: 'usb' }]), null);
  assert.match(hintFor([{ serial: 'x', state: 'device', model: 'Pixel 7', transport: 'usb' }], '', true) ?? '', /Google Play/);
});
