import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLiveStreamCredentials, pickCameraDetails } from '../src/main/hue-cloud.ts';

// Shapes recorded from api.account.meethue.com on 2026-09-27 (ids and secrets replaced).
const floodlightConfig = {
  reported: {
    id: 'AABBCCDDEEFF',
    home_id: '1234567890123456',
    enabled: true,
    onboarding_state: 'completed',
    metadata: { archetype: 'floodlight_camera', name: 'Camera' },
    product_data: { manufacturer_name: 'Signify Netherlands B.V.', model_id: 'CMW002', product_name: 'Hue Secure floodlight camera', software_version: '1.3.1.1294191', product_archetype: 'floodlight_camera' },
    service: {
      camera: { 0: { resolution: { height: 1080, width: 1920 }, e2ee: { live_view: { enabled: false, updated: '2026-09-27T10:06:34Z' }, key: { type: 'home_signing_public_key', id: 'k' } }, video_quality: 'high' } },
      wifi_connectivity: { 0: { ssid: 'net', strength: 2, ip_address: '192.168.1.78' } },
      zigbee_connectivity: { 0: { status: 'connected', channel: 'channel_25', mac_address: 'aa:bb:cc:ff:fe:dd:ee:ff' } },
    },
  },
};

const batteryConfig = {
  reported: {
    id: 'AABBCCDDEE00',
    metadata: { archetype: 'battery_camera', name: 'Living room' },
    product_data: { model_id: 'CMB001', product_name: 'Hue Secure battery camera' },
    service: {
      camera: { 0: { e2ee: { live_view: { enabled: true } } } },
      device_power: { 0: { power_state: { charging: false, battery_level: 52, battery_state: 'normal' } } },
      wifi_connectivity: { 0: { strength: 4 } },
      zigbee_connectivity: { 0: { status: 'connection_issue' } },
    },
  },
};

const liveStream = {
  credentials: { AccessKeyId: 'ASIAEXAMPLE', Expiration: '2026-09-27T12:03:09Z', SecretAccessKey: 'secret', SessionToken: 'session' },
  signaling_channels: [
    { id: 'OTHER000000', arn: 'arn:aws:kinesisvideo:eu-west-1:111:channel/OTHER000000/1' },
    { id: 'AABBCCDDEEFF', arn: 'arn:aws:kinesisvideo:eu-west-1:111:channel/AABBCCDDEEFF/1786829290866' },
  ],
  turn_servers: [
    {
      device_id: 'AABBCCDDEEFF',
      ice_servers: [
        { urls: ['turns:1-2-3-4.t-x.kinesisvideo.eu-west-1.amazonaws.com:443?transport=udp', 'turns:1-2-3-4.t-x.kinesisvideo.eu-west-1.amazonaws.com:443?transport=tcp'], username: 'u1', password: 'p1', expires_at: '2026-09-27T11:08:09.004480119Z' },
        { urls: ['turns:5-6-7-8.t-x.kinesisvideo.eu-west-1.amazonaws.com:443?transport=udp'], username: 'u2', password: 'p2', expires_at: '2026-09-27T11:08:09.004480119Z' },
      ],
      http_signal_channel_endpoint: 'https://r-d1721414.kinesisvideo.eu-west-1.amazonaws.com',
      wss_signal_channel_endpoint: 'wss://v-45d61471.kinesisvideo.eu-west-1.amazonaws.com',
    },
  ],
  stun_servers: ['stun:stun.kinesisvideo.eu-west-1.amazonaws.com:443'],
  earliest_expiry: '2026-09-27T11:08:09.004480119Z',
};

test('pickCameraDetails reads name, product, link, battery, Wi-Fi and live-view protection from the reported document', () => {
  const flood = pickCameraDetails(floodlightConfig, { type: 'CMW002', id: 'AABBCCDDEEFF' });
  assert.equal(flood.name, 'Camera');
  assert.equal(flood.model, 'CMW002');
  assert.equal(flood.productName, 'Hue Secure floodlight camera');
  assert.equal(flood.online, true);
  assert.equal(flood.battery, null);
  assert.equal(flood.wifiStrength, 2);
  assert.equal(flood.liveViewProtected, false);
  assert.ok(flood.raw.includes('service'));

  const battery = pickCameraDetails(batteryConfig, { type: 'CMB001', id: 'AABBCCDDEE00' });
  assert.equal(battery.name, 'Living room');
  assert.equal(battery.online, false);
  assert.equal(battery.battery, 52);
  assert.equal(battery.wifiStrength, 4);
  assert.equal(battery.liveViewProtected, true);

  // Missing or odd documents fall back to a readable name and unknowns.
  const empty = pickCameraDetails({}, { type: 'CMB001', id: 'AABBCCDDEE00' });
  assert.equal(empty.name, 'Secure battery camera EE00');
  assert.equal(empty.model, 'CMB001');
  assert.equal(empty.online, null);
  assert.equal(empty.liveViewProtected, null);
  assert.equal(pickCameraDetails(null, { type: 'CMW001', id: 'X1' }).name, 'Secure wired camera X1');
  assert.equal(pickCameraDetails([1, 2], { type: 'ZZZ', id: 'X1' }).name, 'Camera X1');
});

test('parseLiveStreamCredentials understands the real Hue cloud grant', () => {
  const g = parseLiveStreamCredentials(liveStream, 'aabbccddeeff');
  assert.deepEqual(g.creds, { accessKeyId: 'ASIAEXAMPLE', secretAccessKey: 'secret', sessionToken: 'session' });
  assert.equal(g.channelArn, 'arn:aws:kinesisvideo:eu-west-1:111:channel/AABBCCDDEEFF/1786829290866');
  assert.equal(g.region, 'eu-west-1');
  assert.equal(g.iceServers.length, 3);
  assert.deepEqual(g.iceServers[0], { urls: liveStream.turn_servers[0].ice_servers[0].urls, username: 'u1', credential: 'p1' });
  assert.deepEqual(g.iceServers[2], { urls: 'stun:stun.kinesisvideo.eu-west-1.amazonaws.com:443' });
  assert.deepEqual(g.endpoints, { wss: 'wss://v-45d61471.kinesisvideo.eu-west-1.amazonaws.com', https: 'https://r-d1721414.kinesisvideo.eu-west-1.amazonaws.com' });
  assert.equal(g.expiresAt, Date.parse('2026-09-27T11:08:09.004480119Z'));
  assert.ok(g.keys.includes('signaling_channels') && g.keys.includes('credentials.SessionToken'));

  // Unknown camera id: first channel/turn entry is used rather than nothing.
  const other = parseLiveStreamCredentials(liveStream, 'NOPE');
  assert.equal(other.channelArn, liveStream.signaling_channels[0].arn);
  assert.equal(other.iceServers.length, 3);

  // Older/other shapes keep working and report no endpoints.
  const flat = parseLiveStreamCredentials({ awsCredentials: { AccessKeyId: 'A', SecretAccessKey: 'S' }, channelArn: 'arn:aws:kinesisvideo:us-east-1:1:channel/x/1', turn_servers: [{ urls: ['turn:t'], username: 'u', credential: 'c' }] }, 'CAM');
  assert.equal(flat.region, 'us-east-1');
  assert.deepEqual(flat.iceServers, [{ urls: ['turn:t'], username: 'u', credential: 'c' }]);
  assert.deepEqual(flat.endpoints, { wss: null, https: null });
  assert.equal(flat.expiresAt, null);
});
