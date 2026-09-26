import test from 'node:test';
import assert from 'node:assert/strict';
import { rgbToXy, xyToRgb, hexToRgb, rgbToHex, parseColor, parseColorTemperature, clipToGamut, GAMUT_C, isInsideGamut, kelvinToMirek, mirekToKelvin } from '../src/color.ts';
import { resolveByName, scoreMatch, normalizeName } from '../src/matching.ts';
import { buildLocalTime, parseLocalTime, describeLocalTime, buildScheduleCommand, parseScheduleCommand, normalizeDays, v1Id } from '../src/schedules.ts';
import { buildHome, applyEvents, mergeResource, lightLevelToLux } from '../src/model.ts';
import { createSeed } from '../../hue-mock-bridge/src/server.mjs';

test('colour: rgb -> xy -> rgb round trip keeps the hue', () => {
  const xy = rgbToXy({ r: 255, g: 0, b: 0 });
  assert.ok(isInsideGamut(xy, GAMUT_C));
  const back = xyToRgb(xy, 1);
  assert.ok(back.r > 200 && back.g < 60 && back.b < 60, JSON.stringify(back));
  const blue = xyToRgb(rgbToXy({ r: 0, g: 0, b: 255 }), 1);
  assert.ok(blue.b > 200 && blue.r < 80, JSON.stringify(blue));
});

test('colour: points outside the gamut are clipped onto it', () => {
  const p = clipToGamut({ x: 0.9, y: 0.9 }, GAMUT_C);
  assert.ok(isInsideGamut({ x: p.x - 0.0001, y: p.y - 0.0001 }, GAMUT_C) || isInsideGamut(p, GAMUT_C));
  assert.ok(p.x < 0.9 && p.y < 0.9);
});

test('colour: hex helpers', () => {
  assert.deepEqual(hexToRgb('#ff8800'), { r: 255, g: 136, b: 0 });
  assert.deepEqual(hexToRgb('f80'), { r: 255, g: 136, b: 0 });
  assert.equal(hexToRgb('nope'), null);
  assert.equal(rgbToHex({ r: 255, g: 136, b: 0 }), '#ff8800');
});

test('colour: parseColor understands names, hex, presets and kelvin', () => {
  assert.ok(parseColor('red')?.xy);
  assert.ok(parseColor('Sky Blue')?.xy);
  assert.ok(parseColor('#00ff00')?.xy);
  assert.equal(parseColor('warm white')?.mirek, kelvinToMirek(2700));
  assert.equal(parseColor('3000K')?.mirek, kelvinToMirek(3000));
  assert.equal(parseColor('300 mirek')?.mirek, 300);
  assert.equal(parseColor('bananas'), null);
});

test('colour: parseColorTemperature', () => {
  assert.equal(parseColorTemperature('warm'), kelvinToMirek(2700));
  assert.equal(parseColorTemperature('4000K'), 250);
  assert.equal(parseColorTemperature(4000), 250);
  assert.equal(parseColorTemperature(250), 250);
  assert.equal(parseColorTemperature('daylight'), kelvinToMirek(6500));
  assert.equal(parseColorTemperature('purple'), null);
  assert.equal(mirekToKelvin(kelvinToMirek(2700)), 2703);
});

test('matching: resolves rooms from natural language', () => {
  const rooms = [
    { id: '1', name: 'Office' },
    { id: '2', name: 'Living Room' },
    { id: '3', name: 'Bedroom' },
    { id: '4', name: 'Kids Bedroom' },
  ];
  assert.equal(resolveByName('office', rooms).match?.id, '1');
  assert.equal(resolveByName('the office lights', rooms).match?.id, '1');
  assert.equal(resolveByName('living', rooms).match?.id, '2');
  assert.equal(resolveByName('lounge', rooms).match, undefined);
  assert.equal(resolveByName('Bedroom', rooms).match?.id, '3');
  assert.equal(resolveByName('kids room', rooms).match?.id, '4');
  assert.equal(resolveByName('2', rooms).match?.id, '2');
  assert.equal(resolveByName('Ofice', rooms).match?.id, '1');
  assert.equal(normalizeName('  Sala   de Estar '), 'sala de estar');
  assert.ok(scoreMatch('office', 'Office') > scoreMatch('off', 'Office'));
});

test('matching: identical names are ambiguous', () => {
  const lights = [
    { id: 'a', name: 'Ceiling' },
    { id: 'b', name: 'Ceiling' },
  ];
  const r = resolveByName('ceiling', lights);
  assert.equal(r.match, undefined);
  assert.equal(r.candidates.length, 2);
});

test('schedules: localtime building and parsing', () => {
  assert.equal(buildLocalTime({ time: '22:00' }), 'W127/T22:00:00');
  assert.equal(buildLocalTime({ time: '7:30', days: ['mon', 'wed', 'fri'] }), 'W084/T07:30:00');
  assert.equal(buildLocalTime({ time: '07:30', days: 'weekdays' }), 'W124/T07:30:00');
  assert.equal(buildLocalTime({ time: '9pm', days: ['weekends'] }), 'W003/T21:00:00');
  assert.equal(buildLocalTime({ time: '08:00', onceDate: '2026-10-01' }), '2026-10-01T08:00:00');
  assert.deepEqual(normalizeDays(['Monday', 'segunda', 'sat']), ['mon', 'sat']);
  const p = parseLocalTime('W124/T07:30:00');
  assert.equal(p.kind, 'recurring');
  assert.equal(describeLocalTime(p), 'Weekdays at 07:30');
  assert.equal(describeLocalTime(parseLocalTime('W127/T22:00:00')), 'Every day at 22:00');
  assert.equal(describeLocalTime(parseLocalTime('W084/T07:30:00')), 'Mon, Wed, Fri at 07:30');
  assert.equal(describeLocalTime(parseLocalTime('2026-10-01T08:00:00')), 'On 2026-10-01 at 08:00');
  assert.equal(describeLocalTime(parseLocalTime('PT00:15:00')), 'After 00:15:00');
  assert.throws(() => buildLocalTime({ time: '25:00' }));
});

test('schedules: command building', () => {
  const cmd = buildScheduleCommand({ appKey: 'k', target: { kind: 'group', v1Id: '3' }, brightness: 50 });
  assert.equal(cmd.address, '/api/k/groups/3/action');
  assert.deepEqual(cmd.body, { bri: 127, on: true });
  const scene = buildScheduleCommand({ appKey: 'k', target: { kind: 'group', v1Id: '3' }, sceneV1Id: 'abc' });
  assert.deepEqual(scene.body, { scene: 'abc' });
  const light = buildScheduleCommand({ appKey: 'k', target: { kind: 'light', v1Id: '7' }, on: false });
  assert.equal(light.address, '/api/k/lights/7/state');
  const parsed = parseScheduleCommand(cmd);
  assert.equal(parsed.targetKind, 'group');
  assert.equal(parsed.v1Id, '3');
  assert.equal(parsed.brightness, 50);
  assert.equal(v1Id('/groups/3'), '3');
  assert.equal(v1Id(undefined), undefined);
});

test('model: buildHome from the mock seed', () => {
  const home = buildHome(createSeed().values());
  assert.equal(home.rooms.length, 6);
  assert.equal(home.zones.length, 1);
  assert.equal(home.lights.length, 12);
  const office = home.rooms.find((r) => r.name === 'Office');
  assert.ok(office);
  assert.equal(office.lightIds.length, 3);
  assert.ok(office.groupedLightId);
  assert.ok(office.sceneIds.length >= 6);
  const desk = home.lights.find((l) => l.name === 'Desk Lamp');
  assert.equal(desk.roomName, 'Office');
  assert.equal(desk.supportsColor, true);
  assert.equal(desk.colorMode, 'ct');
  assert.ok(desk.effects.includes('candle'));
  assert.equal(desk.effectsV2, true);
  const hallway = home.lights.find((l) => l.name === 'Hallway');
  assert.equal(hallway.supportsColor, false);
  assert.equal(hallway.supportsColorTemperature, false);
  const downstairs = home.zones[0];
  assert.equal(downstairs.lightIds.length, 6);
  assert.ok(home.home);
  assert.equal(home.home.lightIds.length, 12);
  const savanna = home.scenes.find((s) => s.name === 'Savanna sunset');
  assert.equal(savanna.groupName, 'Living Room');
  assert.equal(savanna.supportsDynamic, true);
  assert.ok(savanna.palette.length >= 4);
  const motion = home.accessories.find((a) => a.kind === 'motion');
  assert.ok(motion);
  assert.equal(motion.battery.level, 87);
  assert.ok(motion.temperature.celsius > 20);
  assert.equal(motion.lightLevel.lux, lightLevelToLux(18432));
  const dimmer = home.accessories.find((a) => a.kind === 'switch');
  assert.equal(dimmer.buttons.length, 4);
  assert.equal(home.bridge.name, 'Mock Hue Bridge');
  // Mock cameras: listed under home.cameras, never as motion accessories; floodlight stays a normal light in its room.
  assert.equal(home.cameras.length, 2);
  assert.deepEqual(home.cameras.map((c) => c.kind), ['floodlight', 'battery']);
  assert.equal(home.accessories.filter((a) => a.kind === 'motion').length, 1);
  const driveway = home.cameras.find((c) => c.name === 'Driveway camera');
  assert.equal(home.lightById[driveway.floodlightLightId].name, 'Driveway floodlight');
  assert.equal(home.lightById[driveway.floodlightLightId].roomName, 'Driveway');
});

// Copied from a real Hue Bridge Pro dump (release/bridge-dump.json): the two Hue Secure cameras with their
// services, plus the separate floodlight light device (archetype hue_floodlight_camera) and the Driveway room.
const REAL_CAMERA_FIXTURE = [
  { id: 'e474d20e-d102-46bf-ae12-88d807421c0f', type: 'device', product_data: { model_id: 'CMB001', manufacturer_name: 'Signify Netherlands B.V.', product_name: 'Secure battery camera', product_archetype: 'unknown_archetype', certified: true, software_version: '2.86.1' }, metadata: { name: 'Secure battery camera 1', archetype: 'unknown_archetype' }, identify: {}, services: [{ rid: '06b6c81f-d244-403e-9853-f14faa4281e9', rtype: 'zigbee_connectivity' }, { rid: '6cc31f73-9c61-4028-83ba-5d52779c0e15', rtype: 'camera_motion' }, { rid: 'be49a1b1-4f0f-4ba9-8a37-5d61bd8fe247', rtype: 'device_power' }, { rid: '2d740f7d-d0c9-4bff-9778-7db2b8e93998', rtype: 'light_level' }] },
  { id: '06b6c81f-d244-403e-9853-f14faa4281e9', owner: { rid: 'e474d20e-d102-46bf-ae12-88d807421c0f', rtype: 'device' }, status: 'connected', mac_address: 'c4:29:96:ff:fe:12:c0:48', type: 'zigbee_connectivity' },
  { id: '6cc31f73-9c61-4028-83ba-5d52779c0e15', owner: { rid: 'e474d20e-d102-46bf-ae12-88d807421c0f', rtype: 'device' }, enabled: true, motion: { motion: false, motion_valid: true, motion_report: { changed: '2026-09-26T10:37:55.485Z', motion: false } }, type: 'camera_motion' },
  { id: 'be49a1b1-4f0f-4ba9-8a37-5d61bd8fe247', owner: { rid: 'e474d20e-d102-46bf-ae12-88d807421c0f', rtype: 'device' }, power_state: { battery_state: 'normal', battery_level: 55 }, type: 'device_power' },
  { id: '2d740f7d-d0c9-4bff-9778-7db2b8e93998', owner: { rid: 'e474d20e-d102-46bf-ae12-88d807421c0f', rtype: 'device' }, enabled: true, light: { light_level: 8613, light_level_valid: true, light_level_report: { changed: '2026-09-26T10:34:54.682Z', light_level: 8613 } }, type: 'light_level' },
  { id: '6535afde-aeb6-4924-9f08-c339ed57fbf0', type: 'device', product_data: { model_id: 'CMW002', manufacturer_name: 'Signify Netherlands B.V.', product_name: 'Secure floodlight camera', product_archetype: 'unknown_archetype', certified: true, software_version: '2.86.1' }, metadata: { name: 'Secure floodlight camera 1', archetype: 'unknown_archetype' }, identify: {}, services: [{ rid: '988eeb79-f44a-4d8c-8744-ae117a0c9891', rtype: 'zigbee_connectivity' }, { rid: 'afd5fa4e-656d-47b0-ba42-5ffd8b826258', rtype: 'camera_motion' }, { rid: 'cbe50209-bd36-4c13-a578-d1da48a7e344', rtype: 'light_level' }] },
  { id: '988eeb79-f44a-4d8c-8744-ae117a0c9891', owner: { rid: '6535afde-aeb6-4924-9f08-c339ed57fbf0', rtype: 'device' }, status: 'connected', mac_address: 'c4:29:96:ff:fe:1b:1f:e2', type: 'zigbee_connectivity' },
  { id: 'afd5fa4e-656d-47b0-ba42-5ffd8b826258', owner: { rid: '6535afde-aeb6-4924-9f08-c339ed57fbf0', rtype: 'device' }, enabled: true, motion: { motion: true, motion_valid: true, motion_report: { changed: '2026-09-26T10:18:42.586Z', motion: true } }, type: 'camera_motion' },
  { id: 'cbe50209-bd36-4c13-a578-d1da48a7e344', owner: { rid: '6535afde-aeb6-4924-9f08-c339ed57fbf0', rtype: 'device' }, enabled: true, light: { light_level: 34243, light_level_valid: true, light_level_report: { changed: '2026-09-26T10:35:05.264Z', light_level: 34243 } }, type: 'light_level' },
  { id: 'b3094697-fcb6-48f0-96fe-fbf80c2ed278', id_v1: '/lights/9', type: 'device', product_data: { model_id: '442296118491', manufacturer_name: 'Signify Netherlands B.V.', product_name: 'Secure floodlight camera', product_archetype: 'hue_floodlight_camera', certified: true, software_version: '1.163.1', hardware_platform_type: '100b-11f' }, metadata: { name: 'Secure floodlight camera', archetype: 'hue_floodlight_camera' }, identify: {}, services: [{ rid: '61d11b87-5e3e-499a-b568-b640ea93da07', rtype: 'zigbee_connectivity' }, { rid: 'ad32400f-f02a-4cd8-af7a-b6fbde0fcd97', rtype: 'light' }, { rid: 'b0ab858d-b8c2-4dde-b0a0-0b4ef9adc24f', rtype: 'entertainment' }, { rid: 'a7c29c7a-37f8-4807-a5ab-90c8af696fc4', rtype: 'motion_area_candidate' }, { rid: '9a421415-00ee-42f6-8bba-741a6d857049', rtype: 'device_software_update' }] },
  { id: '61d11b87-5e3e-499a-b568-b640ea93da07', id_v1: '/lights/9', owner: { rid: 'b3094697-fcb6-48f0-96fe-fbf80c2ed278', rtype: 'device' }, status: 'connected', mac_address: '00:17:88:01:0f:4d:6e:d2', type: 'zigbee_connectivity' },
  { id: 'ad32400f-f02a-4cd8-af7a-b6fbde0fcd97', id_v1: '/lights/9', owner: { rid: 'b3094697-fcb6-48f0-96fe-fbf80c2ed278', rtype: 'device' }, metadata: { name: 'Secure floodlight camera', archetype: 'hue_floodlight_camera', function: 'mixed' }, on: { on: false }, dimming: { brightness: 50.2, min_dim_level: 0.1 }, color_temperature: { mirek: null, mirek_valid: false, mirek_schema: { mirek_minimum: 153, mirek_maximum: 500 } }, color: { xy: { x: 0.4416, y: 0.2843 }, gamut: { red: { x: 0.6915, y: 0.3083 }, green: { x: 0.17, y: 0.7 }, blue: { x: 0.1532, y: 0.0475 } }, gamut_type: 'C' }, dynamics: { status: 'dynamic_palette', status_values: ['none', 'dynamic_palette'], speed: 0.6032, speed_valid: true }, mode: 'normal', effects_v2: { action: { effect_values: ['no_effect', 'candle', 'fire'] }, status: { effect: 'no_effect', effect_values: ['no_effect', 'candle', 'fire'] } }, type: 'light' },
  { id: 'b0ab858d-b8c2-4dde-b0a0-0b4ef9adc24f', id_v1: '/lights/9', owner: { rid: 'b3094697-fcb6-48f0-96fe-fbf80c2ed278', rtype: 'device' }, renderer: true, proxy: true, type: 'entertainment' },
  { id: 'a7c29c7a-37f8-4807-a5ab-90c8af696fc4', owner: { rid: 'b3094697-fcb6-48f0-96fe-fbf80c2ed278', rtype: 'device' }, capabilities: ['sensor', 'collector', 'sync'], type: 'motion_area_candidate' },
  { id: '5e2d3c20-4b80-4149-a8c9-6cf95fb1fa1f', id_v1: '/groups/86', type: 'room', metadata: { name: 'Driveway', archetype: 'driveway' }, children: [{ rid: '6535afde-aeb6-4924-9f08-c339ed57fbf0', rtype: 'device' }, { rid: 'b3094697-fcb6-48f0-96fe-fbf80c2ed278', rtype: 'device' }], services: [] },
];

test('model: Hue Secure cameras from a real Bridge Pro dump', () => {
  const home = buildHome(REAL_CAMERA_FIXTURE);
  assert.equal(home.cameras.length, 2);
  const battery = home.cameras.find((c) => c.modelId === 'CMB001');
  const flood = home.cameras.find((c) => c.modelId === 'CMW002');
  assert.ok(battery && flood);
  assert.equal(battery.kind, 'battery');
  assert.equal(flood.kind, 'floodlight');
  assert.equal(battery.name, 'Secure battery camera 1');
  assert.equal(battery.productName, 'Secure battery camera');
  assert.equal(battery.softwareVersion, '2.86.1');
  assert.equal(battery.batteryLevel, 55);
  assert.equal(battery.batteryState, 'normal');
  assert.equal(flood.batteryLevel, null);
  assert.equal(battery.motion, false);
  assert.equal(battery.motionEnabled, true);
  assert.equal(battery.motionChanged, '2026-09-26T10:37:55.485Z');
  assert.equal(flood.motion, true);
  assert.equal(battery.lux, lightLevelToLux(8613));
  assert.equal(battery.lux, 7);
  assert.equal(flood.lux, lightLevelToLux(34243));
  assert.equal(flood.lux, 2656);
  assert.equal(battery.connectivity, 'connected');
  assert.equal(battery.cameraMotionId, '6cc31f73-9c61-4028-83ba-5d52779c0e15');
  assert.equal(battery.lightLevelId, '2d740f7d-d0c9-4bff-9778-7db2b8e93998');
  // Floodlight pairing: the light device is separate (archetype hue_floodlight_camera) and stays a normal light in its room.
  assert.equal(battery.floodlightLightId, null);
  assert.equal(flood.floodlightLightId, 'ad32400f-f02a-4cd8-af7a-b6fbde0fcd97');
  assert.equal(flood.roomName, 'Driveway');
  assert.equal(home.lights.length, 1);
  assert.equal(home.lights[0].id, 'ad32400f-f02a-4cd8-af7a-b6fbde0fcd97');
  assert.equal(home.lights[0].roomName, 'Driveway');
  assert.equal(home.lights[0].supportsColor, true);
  // No camera appears in the accessory list.
  assert.equal(home.accessories.length, 0);
  assert.ok(!home.accessories.some((a) => a.kind === 'motion'));
  // Malformed data is tolerated.
  const sparse = buildHome([{ id: 'x', type: 'device', product_data: { product_name: 'Secure camera' }, metadata: {}, services: null }, { id: 'y', type: 'camera_motion', owner: { rid: 'x', rtype: 'device' } }]);
  assert.equal(sparse.cameras.length, 1);
  assert.equal(sparse.cameras[0].motion, null);
  assert.equal(sparse.cameras[0].kind, 'camera');
});

test('model: floodlight pairing falls back to name similarity with several cameras', () => {
  const dev = (id, name, model) => ({ id, type: 'device', product_data: { model_id: model, product_name: 'Secure floodlight camera', product_archetype: 'unknown_archetype', software_version: '1' }, metadata: { name, archetype: 'unknown_archetype' }, services: [{ rid: `${id}-m`, rtype: 'camera_motion' }] });
  const motion = (id) => ({ id: `${id}-m`, type: 'camera_motion', owner: { rid: id, rtype: 'device' }, enabled: true, motion: { motion: false, motion_valid: true } });
  const floodDev = (id, name) => ({ id, type: 'device', product_data: { model_id: '442296118491', product_name: 'Secure floodlight camera', product_archetype: 'hue_floodlight_camera' }, metadata: { name, archetype: 'hue_floodlight_camera' }, services: [{ rid: `${id}-l`, rtype: 'light' }] });
  const light = (id, name) => ({ id: `${id}-l`, type: 'light', owner: { rid: id, rtype: 'device' }, metadata: { name, archetype: 'hue_floodlight_camera' }, on: { on: false } });
  const home = buildHome([
    dev('cam-front', 'Front yard camera 1', 'CMW002'), motion('cam-front'),
    dev('cam-back', 'Back yard camera 1', 'CMW002'), motion('cam-back'),
    floodDev('fl-back', 'Back yard camera'), light('fl-back', 'Back yard camera'),
    floodDev('fl-front', 'Front yard camera'), light('fl-front', 'Front yard camera'),
  ]);
  assert.equal(home.cameras.find((c) => c.id === 'cam-front').floodlightLightId, 'fl-front-l');
  assert.equal(home.cameras.find((c) => c.id === 'cam-back').floodlightLightId, 'fl-back-l');
});

test('model: event merging', () => {
  const seed = createSeed();
  const light = [...seed.values()].find((r) => r.type === 'light' && r.metadata.name === 'Desk Lamp');
  const map = new Map(seed);
  const changed = applyEvents(map, [
    { type: 'update', id: 'e1', creationtime: '', data: [{ id: light.id, type: 'light', on: { on: false }, dimming: { brightness: 12 } }] },
  ]);
  assert.equal(changed, true);
  const updated = map.get(light.id);
  assert.equal(updated.on.on, false);
  assert.equal(updated.dimming.brightness, 12);
  assert.equal(updated.dimming.min_dim_level, 0.2, 'untouched nested fields survive the merge');
  assert.equal(updated.metadata.name, 'Desk Lamp');
  applyEvents(map, [{ type: 'delete', id: 'e2', creationtime: '', data: [{ id: light.id, type: 'light' }] }]);
  assert.equal(map.has(light.id), false);
  assert.deepEqual(mergeResource({ a: { b: 1, c: 2 }, arr: [1] }, { a: { b: 5 }, arr: [2, 3] }), { a: { b: 5, c: 2 }, arr: [2, 3] });
});
