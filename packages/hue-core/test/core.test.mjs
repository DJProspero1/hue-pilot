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
  assert.equal(home.rooms.length, 5);
  assert.equal(home.zones.length, 1);
  assert.equal(home.lights.length, 11);
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
  assert.equal(home.home.lightIds.length, 11);
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
