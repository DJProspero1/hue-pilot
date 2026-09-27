import test from 'node:test';
import assert from 'node:assert/strict';
import { createMockBridge } from '../../hue-mock-bridge/src/server.mjs';
import { HueClient, LinkButtonNotPressedError } from '../src/client.ts';
import { buildHome, applyEvents } from '../src/model.ts';
import { executeTool, TOOL_DEFINITIONS, buildSystemPrompt } from '../src/tools.ts';

let bridge;
let port;
let client;
let resources;

const ctx = () => ({
  client,
  appKey: client.conn.appKey,
  defaultTransitionMs: 0,
  getHome: async () => buildHome(await client.getAll()),
});

test.before(async () => {
  bridge = createMockBridge({ port: 0, host: '127.0.0.1', log: false, simulate: false });
  ({ port } = await bridge.start());
  const target = { host: '127.0.0.1', port, protocol: 'http' };
  const config = await HueClient.getBridgeConfig(target);
  assert.equal(config.bridgeid, 'MOCK0000000001');
  const pair = await HueClient.pair(target, 'hue_pilot#test');
  assert.ok(pair.appKey.startsWith('mock-'));
  client = new HueClient({ ...target, appKey: pair.appKey });
  resources = new Map((await client.getAll()).map((r) => [r.id, r]));
});

test.after(async () => {
  await bridge.stop();
});

test('e2e: real bridge refuses pairing until the button is pressed (error shape)', async () => {
  assert.ok(new LinkButtonNotPressedError().message.includes('link button'));
});

test('e2e: set a light and see the change through the event stream', async () => {
  const home = buildHome(resources.values());
  const desk = home.lights.find((l) => l.name === 'Desk Lamp');
  const received = [];
  let opened;
  const openedP = new Promise((r) => (opened = r));
  const stop = client.subscribe(
    (events) => received.push(...events),
    (status) => status === 'open' && opened(),
  );
  await openedP;
  await client.setLight(desk.id, { on: true, brightness: 33, xy: { x: 0.6, y: 0.3 } });
  await new Promise((r) => setTimeout(r, 300));
  stop();
  assert.ok(received.some((e) => e.type === 'update' && e.data.some((d) => d.id === desk.id)), 'light update event received');
  applyEvents(resources, received);
  const after = buildHome(resources.values());
  const deskAfter = after.lightById[desk.id];
  assert.equal(deskAfter.on, true);
  assert.equal(deskAfter.brightness, 33);
  assert.equal(deskAfter.colorMode, 'xy');
  assert.ok(after.groupById[desk.roomId].on);
});

test('e2e: tool definitions are Gemini/MCP compatible', () => {
  for (const t of TOOL_DEFINITIONS) {
    assert.match(t.name, /^[a-z_]+$/);
    assert.equal(t.parameters.type, 'object');
    for (const [k, p] of Object.entries(t.parameters.properties ?? {})) {
      assert.ok(['string', 'number', 'boolean', 'array', 'integer'].includes(p.type), `${t.name}.${k}`);
      if (p.type === 'array') assert.ok(p.items);
    }
  }
  const prompt = buildSystemPrompt(buildHome(resources.values()));
  assert.ok(prompt.includes('Office'));
  assert.ok(prompt.includes('Desk Lamp'));
});

test('e2e: set_room tool controls the grouped light', async () => {
  const r = await executeTool('set_room', { room: 'the office', on: false }, ctx());
  assert.equal(r.ok, true, r.message);
  let home = await ctx().getHome();
  assert.equal(home.groupById[r.target.id].anyOn, false);
  const r2 = await executeTool('set_room', { room: 'office', brightness: 60, color_temperature: 'warm' }, ctx());
  assert.equal(r2.ok, true, r2.message);
  home = await ctx().getHome();
  const office = home.rooms.find((g) => g.name === 'Office');
  assert.equal(office.anyOn, true);
  assert.equal(office.brightness, 60);
  const desk = home.lights.find((l) => l.name === 'Desk Lamp');
  assert.equal(desk.colorMode, 'ct');
  assert.equal(desk.kelvin, 2703);
});

test('e2e: set_room with colour name, ambiguity and not found', async () => {
  const r = await executeTool('set_room', { room: 'living room', color: 'blue', brightness: 100 }, ctx());
  assert.equal(r.ok, true, r.message);
  const home = await ctx().getHome();
  const floor = home.lights.find((l) => l.name === 'Floor Lamp');
  assert.equal(floor.colorMode, 'xy');
  const sofa = home.lights.find((l) => l.name === 'Sofa Lamp');
  assert.equal(sofa.on, true, 'white-only lamp still turned on');
  const nf = await executeTool('set_room', { room: 'garage', on: true }, ctx());
  assert.equal(nf.ok, false);
  assert.equal(nf.error, 'not_found');
  const amb = await executeTool('set_light', { light: 'bedside', on: true }, ctx());
  assert.equal(amb.ok, false);
  assert.equal(amb.error, 'ambiguous');
  assert.equal(amb.candidates.length, 2);
  const left = await executeTool('set_light', { light: 'bedside left', on: true, color: 'pink' }, ctx());
  assert.equal(left.ok, true, left.message);
});

test('e2e: scenes, effects, identify, all lights', async () => {
  const s = await executeTool('activate_scene', { scene: 'relax', room: 'bedroom' }, ctx());
  assert.equal(s.ok, true, s.message);
  let home = await ctx().getHome();
  const bedroom = home.rooms.find((g) => g.name === 'Bedroom');
  assert.equal(home.sceneById[bedroom.activeSceneId].name, 'Relax');
  const ambiguousScene = await executeTool('activate_scene', { scene: 'relax' }, ctx());
  assert.equal(ambiguousScene.error, 'ambiguous');
  const dyn = await executeTool('activate_scene', { scene: 'savanna', dynamic: true }, ctx());
  assert.equal(dyn.ok, true, dyn.message);
  home = await ctx().getHome();
  assert.equal(home.scenes.find((x) => x.name === 'Savanna sunset').active, 'dynamic_palette');
  const fx = await executeTool('set_effect', { target: 'office', effect: 'candle' }, ctx());
  assert.equal(fx.ok, true, fx.message);
  home = await ctx().getHome();
  assert.equal(home.lights.find((l) => l.name === 'Desk Lamp').effect, 'candle');
  const noFx = await executeTool('set_effect', { target: 'hallway', effect: 'fire' }, ctx());
  assert.equal(noFx.ok, false);
  assert.equal(noFx.error, 'unsupported');
  const id = await executeTool('identify_light', { light: 'kitchen spots' }, ctx());
  assert.equal(id.ok, true);
  const off = await executeTool('set_all_lights', { on: false }, ctx());
  assert.equal(off.ok, true, off.message);
  home = await ctx().getHome();
  assert.equal(home.totalLightsOn, 0);
  const overview = await executeTool('get_home_overview', {}, ctx());
  assert.equal(overview.rooms.length, 6);
  assert.equal(overview.zones.length, 1);
  const sensors = await executeTool('get_sensor_readings', {}, ctx());
  assert.ok(sensors.sensors.some((x) => x.type === 'temperature'));
  assert.ok(sensors.sensors.some((x) => x.type === 'battery'));
});

test('e2e: cameras in sensor readings, prompt and motion detection tool', async () => {
  const readings = await executeTool('get_sensor_readings', {}, ctx());
  const cams = readings.sensors.filter((x) => x.kind === 'camera');
  assert.equal(cams.length, 2);
  const front = cams.find((c) => c.name === 'Front door camera');
  const driveway = cams.find((c) => c.name === 'Driveway camera');
  assert.ok(front && driveway, 'both mock cameras listed');
  assert.equal(front.battery, 72);
  assert.equal(front.motion, false);
  assert.equal(front.motion_detection_enabled, true);
  assert.equal(typeof front.lux, 'number');
  assert.equal(front.connectivity, 'connected');
  assert.equal(driveway.battery, null);
  assert.equal(driveway.motion, true);
  assert.equal(driveway.floodlight.name, 'Driveway floodlight');
  assert.ok(typeof driveway.last_motion === 'string');
  assert.ok(!readings.sensors.some((x) => x.type === 'motion' && /camera/i.test(x.device)), 'cameras are not duplicated as motion sensors');
  const prompt = buildSystemPrompt(await ctx().getHome());
  assert.ok(prompt.includes('Cameras: Driveway camera (floodlight, motion detected), Front door camera (battery 72%, no motion)'), prompt);
  assert.ok(TOOL_DEFINITIONS.some((t) => t.name === 'set_camera_motion_detection'));

  const off = await executeTool('set_camera_motion_detection', { camera: 'driveway camera', enabled: false }, ctx());
  assert.equal(off.ok, true, off.message);
  assert.equal(off.applied.enabled, false);
  const home = await ctx().getHome();
  const drivewayCam = home.cameras.find((c) => c.name === 'Driveway camera');
  const raw = await client.getResources('camera_motion');
  const drivewayMotion = raw.find((r) => r.id === drivewayCam.cameraMotionId);
  assert.equal(drivewayMotion.enabled, false, 'mock reflects enabled:false');
  assert.equal(drivewayCam.motionEnabled, false);
  const after = await executeTool('get_sensor_readings', {}, ctx());
  assert.equal(after.sensors.find((x) => x.kind === 'camera' && x.name === 'Driveway camera').motion_detection_enabled, false);

  const on = await executeTool('set_camera_motion_detection', { camera: 'the driveway', enabled: 'true' }, ctx());
  assert.equal(on.ok, true, on.message);
  assert.equal((await ctx().getHome()).cameras.find((c) => c.name === 'Driveway camera').motionEnabled, true);
  const nf = await executeTool('set_camera_motion_detection', { camera: 'garage cam', enabled: true }, ctx());
  assert.equal(nf.ok, false);
  assert.equal(nf.error, 'not_found');
  const amb = await executeTool('set_camera_motion_detection', { camera: 'camera', enabled: true }, ctx());
  assert.equal(amb.ok, false);
  assert.equal(amb.error, 'ambiguous');
  assert.equal(amb.candidates.length, 2);
  const bad = await executeTool('set_camera_motion_detection', { camera: 'front door camera' }, ctx());
  assert.equal(bad.error, 'invalid_argument');
});

test('e2e: schedules round trip', async () => {
  const c = await executeTool('create_schedule', { name: 'Office off', time: '23:00', target: 'office', on: false, days: ['weekdays'] }, ctx());
  assert.equal(c.ok, true, c.message);
  assert.equal(c.when, 'Weekdays at 23:00');
  const sc = await executeTool('create_schedule', { time: '07:00', target: 'bedroom', scene: 'energize' }, ctx());
  assert.equal(sc.ok, true, sc.message);
  const list = await executeTool('list_schedules', {}, ctx());
  assert.equal(list.schedules.length, 2);
  assert.equal(list.schedules[0].target, 'Office');
  assert.equal(list.schedules[0].action, 'off');
  assert.equal(list.schedules[1].action, 'scene "Energize"');
  const bad = await executeTool('create_schedule', { time: '99:00', target: 'office', on: true }, ctx());
  assert.equal(bad.ok, false);
  const del = await executeTool('delete_schedule', { id: list.schedules[0].id }, ctx());
  assert.equal(del.ok, true);
  const list2 = await executeTool('list_schedules', {}, ctx());
  assert.equal(list2.schedules.length, 1);
});

test('e2e: scene create and delete through the client', async () => {
  const home = await ctx().getHome();
  const office = home.rooms.find((g) => g.name === 'Office');
  const refs = await client.createScene({
    name: 'Test scene',
    group: { rid: office.id, rtype: 'room' },
    actions: office.lightIds.map((id) => ({ target: { rid: id, rtype: 'light' }, action: { on: { on: true }, dimming: { brightness: 42 } } })),
  });
  assert.equal(refs[0].rtype, 'scene');
  const after = await ctx().getHome();
  assert.ok(after.sceneById[refs[0].rid]);
  await client.recallScene(refs[0].rid);
  const recalled = await ctx().getHome();
  assert.equal(recalled.lightById[office.lightIds[0]].brightness, 42);
  await client.deleteScene(refs[0].rid);
  const gone = await ctx().getHome();
  assert.equal(gone.sceneById[refs[0].rid], undefined);
});

test('e2e: motion automations — list, create, update, pause, delete, sensing', async () => {
  const home0 = buildHome(await client.getAll());
  assert.equal(home0.motionAutomations.length, 1);
  const seeded = home0.motionAutomations[0];
  assert.equal(seeded.sourceName, 'Office motion sensor');
  assert.equal(seeded.sourceKind, 'sensor');
  assert.equal(seeded.where[0].name, 'Office');
  assert.match(seeded.summary, /"Focus"/);
  assert.equal(seeded.onlyWhenDark, true);

  let r = await executeTool('list_motion_automations', {}, ctx());
  assert.ok(r.ok);
  assert.equal(r.automations.length, 1);
  assert.equal(r.automations[0].slots.length, 2);
  assert.ok(r.sensors_without_automation.includes('Front door camera'));

  // A camera gets a night-time rule: "when the driveway camera sees someone, Focus in the office, off after 3 min".
  r = await executeTool('set_motion_automation', { sensor: 'Driveway camera', room: 'Office', on_motion: 'Focus', off_after_minutes: 3, from: '21:00', until: '06:30', only_when_dark: true }, ctx());
  assert.ok(r.ok, r.message);
  assert.match(r.message, /Driveway camera → Office/);
  const home1 = buildHome(await client.getAll());
  const cam = home1.motionAutomations.find((a) => a.sourceKind === 'camera');
  assert.ok(cam);
  assert.equal(cam.motionType, 'camera_motion');
  assert.equal(cam.where[0].name, 'Office');
  assert.equal(cam.slots.length, 2);
  assert.equal(cam.slots[0].start, '06:30');
  assert.equal(cam.slots[0].onMotion.kind, 'nothing');
  assert.equal(cam.slots[1].start, '21:00');
  assert.equal(cam.slots[1].onMotion.sceneName, 'Focus');
  assert.equal(cam.slots[1].noMotionAfterMinutes, 3);
  assert.equal(cam.onlyWhenDark, true);

  // Replace the office rule (same instance id): Focus all day, off after 2 minutes, any light level.
  r = await executeTool('set_motion_automation', { sensor: 'office motion', on_motion: 'Focus', off_after_minutes: 2, only_when_dark: false }, ctx());
  assert.ok(r.ok, r.message);
  const office = buildHome(await client.getAll()).motionAutomations.find((a) => a.id === seeded.id);
  assert.ok(office);
  assert.equal(office.slots.length, 2); // slots are kept; only what was said changes
  assert.equal(office.onlyWhenDark, false);
  assert.equal(office.slots[0].noMotionAfterMinutes, 2);
  assert.equal(office.slots[1].noMotionAfterMinutes, 2);
  assert.equal(office.slots[1].onMotion.sceneName, 'Focus');
  assert.equal(office.slots[0].onNoMotion.kind, 'off');

  // "on" picks a scene of the room; a scene of another room is refused with the room's scenes listed.
  r = await executeTool('set_motion_automation', { sensor: 'Office motion sensor', on_motion: 'on' }, ctx());
  assert.ok(r.ok, r.message);
  r = await executeTool('set_motion_automation', { sensor: 'Office motion sensor', on_motion: 'Savanna sunset' }, ctx());
  assert.equal(r.ok, false);
  assert.match(r.message, /Office/);

  // Pause and resume touch only the flag.
  r = await executeTool('set_motion_automation', { sensor: 'Office motion sensor', enabled: false }, ctx());
  assert.ok(r.ok, r.message);
  assert.equal(buildHome(await client.getAll()).motionAutomations.find((a) => a.id === seeded.id).enabled, false);
  r = await executeTool('set_motion_automation', { sensor: 'Office motion sensor', enabled: true }, ctx());
  assert.equal(buildHome(await client.getAll()).motionAutomations.find((a) => a.id === seeded.id).enabled, true);

  // Motion sensing itself.
  r = await executeTool('set_motion_sensing', { sensor: 'Office motion sensor', enabled: false }, ctx());
  assert.ok(r.ok, r.message);
  assert.equal(buildHome(await client.getAll()).accessories.find((a) => a.name === 'Office motion sensor').motion.enabled, false);
  await executeTool('set_motion_sensing', { sensor: 'Office motion sensor', enabled: true }, ctx());
  r = await executeTool('set_motion_sensing', { sensor: 'Front door camera', enabled: false }, ctx());
  assert.ok(r.ok, r.message);
  assert.equal(buildHome(await client.getAll()).cameras.find((c) => c.name === 'Front door camera').motionEnabled, false);

  // Delete by sensor name; unknown sensors are reported with the available ones.
  r = await executeTool('delete_motion_automation', { sensor: 'driveway camera' }, ctx());
  assert.ok(r.ok, r.message);
  assert.equal(buildHome(await client.getAll()).motionAutomations.length, 1);
  r = await executeTool('delete_motion_automation', { sensor: 'garage sensor' }, ctx());
  assert.equal(r.ok, false);
  assert.equal(r.error, 'not_found');

  assert.ok(buildSystemPrompt(home1).includes('Motion automations:'));
  assert.ok(buildSystemPrompt(home1).includes('set_motion_automation'));
});

test('e2e: darkness modes on a motion rule (sensor threshold, sun offsets, any)', async () => {
  // The seeded office rule has two slots (07:00 nothing, 22:00 Focus). Changing only the darkness keeps both.
  let r = await executeTool('set_motion_automation', { sensor: 'Office motion sensor', slots: [{ from: '07:00', on_motion: 'nothing', off_after_minutes: 10 }, { from: '22:00', on_motion: 'Focus', off_after_minutes: 5 }], darkness: 'sunset_to_sunrise' }, ctx());
  assert.ok(r.ok, r.message);
  r = await executeTool('set_motion_automation', { sensor: 'Office motion sensor', darkness: 'sensor', dark_threshold_lux: 10 }, ctx());
  assert.ok(r.ok, r.message);
  let a = buildHome(await client.getAll()).motionAutomations.find((x) => x.sourceName === 'Office motion sensor');
  assert.equal(a.slots.length, 2, 'slots kept when only darkness changes');
  assert.equal(a.slots[1].onMotion.sceneName, 'Focus');
  // A new scene goes to the slot that already recalls one; the "nothing" day slot stays.
  r = await executeTool('set_motion_automation', { sensor: 'Office motion sensor', on_motion: 'Focus', off_after_minutes: 7 }, ctx());
  assert.ok(r.ok, r.message);
  a = buildHome(await client.getAll()).motionAutomations.find((x) => x.sourceName === 'Office motion sensor');
  assert.equal(a.slots.length, 2);
  assert.equal(a.slots[0].onMotion.kind, 'nothing');
  assert.equal(a.slots[0].noMotionAfterMinutes, 7);
  assert.equal(a.slots[1].noMotionAfterMinutes, 7);
  r = await executeTool('set_motion_automation', { sensor: 'Office motion sensor', on_motion: 'Focus', darkness: 'sensor', dark_threshold_lux: 10 }, ctx());
  assert.ok(r.ok, r.message);
  a = buildHome(await client.getAll()).motionAutomations.find((x) => x.sourceName === 'Office motion sensor');
  assert.equal(a.darkness.mode, 'sensor');
  assert.equal(a.darkness.darkThreshold, 10001);
  assert.ok(a.darkness.lightLevelServiceId);
  assert.match(a.summary, /sensor below ~10 lx/);
  r = await executeTool('list_motion_automations', {}, ctx());
  const j = r.automations.find((x) => x.sensor === 'Office motion sensor');
  assert.equal(j.darkness, 'sensor');
  assert.equal(j.dark_threshold_lux, 10);
  // Only the threshold changes; the mode is kept.
  r = await executeTool('set_motion_automation', { sensor: 'Office motion sensor', dark_threshold_lux: 3 }, ctx());
  assert.ok(r.ok, r.message);
  a = buildHome(await client.getAll()).motionAutomations.find((x) => x.sourceName === 'Office motion sensor');
  assert.equal(a.darkness.mode, 'sensor');
  assert.equal(Math.round(Math.pow(10, (a.darkness.darkThreshold - 1) / 10000)), 3);
  r = await executeTool('set_motion_automation', { sensor: 'Office motion sensor', darkness: 'sunset_to_sunrise', sunset_offset_minutes: -60 }, ctx());
  assert.ok(r.ok, r.message);
  a = buildHome(await client.getAll()).motionAutomations.find((x) => x.sourceName === 'Office motion sensor');
  assert.deepEqual(a.darkness, { mode: 'sunset_to_sunrise', sunsetOffsetMinutes: -60, sunriseOffsetMinutes: 30 });
  r = await executeTool('set_motion_automation', { sensor: 'Office motion sensor', only_when_dark: false }, ctx());
  assert.equal(buildHome(await client.getAll()).motionAutomations.find((x) => x.sourceName === 'Office motion sensor').darkness.mode, 'any');
  // Several rooms at once.
  r = await executeTool('set_motion_automation', { sensor: 'Office motion sensor', rooms: ['Office', 'Living room'], on_motion: 'Focus' }, ctx());
  assert.ok(r.ok, r.message);
  a = buildHome(await client.getAll()).motionAutomations.find((x) => x.sourceName === 'Office motion sensor');
  assert.deepEqual(a.where.map((w) => w.name.toLowerCase()), ['office', 'living room']);
  r = await executeTool('set_motion_automation', { sensor: 'Front door camera', room: 'Office', on_motion: 'Focus', darkness: 'sensor' }, ctx());
  assert.ok(r.ok, r.message); // cameras have a light-level service too
  await executeTool('delete_motion_automation', { sensor: 'Front door camera' }, ctx());
});

test('e2e: sensor settings, rename, power-on behaviour', async () => {
  let r = await executeTool('set_sensor_settings', { sensor: 'Office motion sensor', sensitivity: 'high' }, ctx());
  assert.ok(r.ok, r.message);
  let acc = buildHome(await client.getAll()).accessories.find((a) => a.name === 'Office motion sensor');
  assert.equal(acc.motion.sensitivity, 4);
  r = await executeTool('set_sensor_settings', { sensor: 'Office motion sensor', sensitivity: '1', name: 'Office sensor', room: 'Office' }, ctx());
  assert.ok(r.ok, r.message);
  acc = buildHome(await client.getAll()).accessories.find((a) => a.name === 'Office sensor');
  assert.ok(acc, 'renamed sensor');
  assert.equal(acc.motion.sensitivity, 1);
  assert.equal(acc.roomName, 'Office');
  r = await executeTool('get_sensor_readings', {}, ctx());
  const reading = r.sensors.find((x) => x.device === 'Office sensor' && x.type === 'motion');
  assert.equal(reading.sensitivity, 1);
  assert.equal(reading.room, 'Office');
  r = await executeTool('set_sensor_settings', { sensor: 'Office sensor', name: 'Office motion sensor' }, ctx());
  assert.ok(r.ok, r.message);
  r = await executeTool('set_sensor_settings', { sensor: 'Front door camera', sensitivity: 'high' }, ctx());
  assert.equal(r.ok, false);
  assert.equal(r.error, 'unsupported');

  r = await executeTool('rename', { what: 'room', name: 'Office', new_name: 'Study' }, ctx());
  assert.ok(r.ok, r.message);
  assert.ok(buildHome(await client.getAll()).rooms.some((g) => g.name === 'Study'));
  r = await executeTool('rename', { what: 'room', name: 'Study', new_name: 'Office' }, ctx());
  assert.ok(r.ok, r.message);
  const home = buildHome(await client.getAll());
  const light = home.lights.find((l) => l.roomName === 'Office');
  r = await executeTool('rename', { what: 'light', name: light.name, new_name: 'Reading lamp' }, ctx());
  assert.ok(r.ok, r.message);
  assert.ok(buildHome(await client.getAll()).lights.some((l) => l.name === 'Reading lamp'));
  r = await executeTool('rename', { what: 'light', name: 'Reading lamp', new_name: light.name }, ctx());
  assert.ok(r.ok, r.message);
  r = await executeTool('rename', { what: 'scene', name: 'Focus', room: 'Office', new_name: 'Deep focus' }, ctx());
  assert.ok(r.ok, r.message);
  assert.ok(buildHome(await client.getAll()).scenes.some((s) => s.name === 'Deep focus'));
  r = await executeTool('rename', { what: 'scene', name: 'Deep focus', new_name: 'Focus' }, ctx());
  assert.ok(r.ok, r.message);

  r = await executeTool('set_light_power_on_behavior', { target: light.name, mode: 'custom', brightness: 40, color_temperature: 'warm' }, ctx());
  assert.ok(r.ok, r.message);
  let l2 = buildHome(await client.getAll()).lightById[light.id];
  assert.equal(l2.powerOn.preset, 'custom');
  assert.equal(l2.powerOn.brightness, 40);
  assert.ok(l2.powerOn.mirek > 300);
  r = await executeTool('set_light_power_on_behavior', { target: 'Office', mode: 'last_state' }, ctx());
  assert.ok(r.ok, r.message);
  l2 = buildHome(await client.getAll()).lightById[light.id];
  assert.equal(l2.powerOn.preset, 'last_on_state');
  r = await executeTool('set_light_power_on_behavior', { target: light.name, mode: 'default' }, ctx());
  assert.ok(r.ok, r.message);
  assert.equal(buildHome(await client.getAll()).lightById[light.id].powerOn.preset, 'safety');
});

test('e2e: rooms, zones and scenes through the tools', async () => {
  const home0 = buildHome(await client.getAll());
  const office = home0.rooms.find((g) => g.name === 'Office');
  const living = home0.rooms.find((g) => g.name.toLowerCase() === 'living room');
  const l1 = home0.lightById[office.lightIds[0]];
  const l2 = home0.lightById[living.lightIds[0]];
  let r = await executeTool('create_group', { kind: 'zone', name: 'Evening', lights: [l1.name, l2.name], icon: 'lounge' }, ctx());
  assert.ok(r.ok, r.message);
  let zone = buildHome(await client.getAll()).zones.find((z) => z.name === 'Evening');
  assert.ok(zone);
  assert.deepEqual([...zone.lightIds].sort(), [l1.id, l2.id].sort());
  assert.equal(zone.archetype, 'lounge');
  r = await executeTool('update_group', { group: 'Evening', new_name: 'Evening lights', remove_lights: [l2.name], icon: 'tv' }, ctx());
  assert.ok(r.ok, r.message);
  zone = buildHome(await client.getAll()).zones.find((z) => z.name === 'Evening lights');
  assert.ok(zone);
  assert.deepEqual(zone.lightIds, [l1.id]);
  assert.equal(zone.archetype, 'tv');
  r = await executeTool('update_group', { group: 'Evening lights', add_lights: [l2.name] }, ctx());
  assert.equal(buildHome(await client.getAll()).zones.find((z) => z.name === 'Evening lights').lightIds.length, 2);
  // A room refuses a light that already has a room; sensors in the room are kept when its lights change.
  r = await executeTool('create_group', { kind: 'room', name: 'Snug', lights: [l1.name] }, ctx());
  assert.equal(r.ok, false);
  r = await executeTool('update_group', { group: 'Office', lights: [l1.name] }, ctx());
  assert.ok(r.ok, r.message);
  const office2 = buildHome(await client.getAll()).rooms.find((g) => g.name === 'Office');
  assert.deepEqual(office2.lightIds, [l1.id]);
  assert.ok(buildHome(await client.getAll()).accessories.find((a) => a.name === 'Office motion sensor').roomId === office2.id, 'sensor stays in the room');
  r = await executeTool('update_group', { group: 'Office', lights: office.lightIds.map((id) => home0.lightById[id].name) }, ctx());
  assert.ok(r.ok, r.message);
  r = await executeTool('delete_group', { group: 'Evening lights' }, ctx());
  assert.ok(r.ok, r.message);
  assert.ok(!buildHome(await client.getAll()).zones.some((z) => z.name === 'Evening lights'));

  r = await executeTool('create_scene', { name: 'Reading', room: 'Office', lights: [{ light: l1.name, brightness: 35, color_temperature: 'warm' }], speed: 0.4 }, ctx());
  assert.ok(r.ok, r.message);
  let scene = buildHome(await client.getAll()).scenes.find((s) => s.name === 'Reading');
  assert.ok(scene);
  assert.equal(scene.groupId, office.id);
  const act = scene.actions.find((a) => a.target.rid === l1.id);
  assert.equal(act.action.dimming.brightness, 35);
  assert.ok(act.action.color_temperature.mirek > 300);
  r = await executeTool('update_scene', { scene: 'Reading', room: 'Office', new_name: 'Reading nook', speed: 0.9, lights: [{ light: l1.name, brightness: 60 }] }, ctx());
  assert.ok(r.ok, r.message);
  scene = buildHome(await client.getAll()).scenes.find((s) => s.name === 'Reading nook');
  assert.ok(scene);
  assert.equal(scene.actions.find((a) => a.target.rid === l1.id).action.dimming.brightness, 60);
  r = await executeTool('delete_scene', { scene: 'Reading nook', room: 'Office' }, ctx());
  assert.ok(r.ok, r.message);
  assert.ok(!buildHome(await client.getAll()).scenes.some((s) => s.name === 'Reading nook'));
});

test('e2e: wake-up and go-to-sleep routines', async () => {
  let r = await executeTool('set_wake_up', { rooms: ['Bedroom'], time: '7:15', days: ['weekdays'], fade_minutes: 20, end_brightness: 80, turn_off_after_minutes: 30 }, ctx());
  assert.ok(r.ok, r.message);
  let rt = buildHome(await client.getAll()).routines.find((x) => x.kind === 'wake_up');
  assert.ok(rt);
  assert.equal(rt.time, '07:15');
  assert.equal(rt.fadeMinutes, 20);
  assert.equal(rt.endBrightness, 80);
  assert.equal(rt.turnOffAfterMinutes, 30);
  assert.equal(rt.where[0].name, 'Bedroom');
  assert.match(rt.summary, /weekdays/);
  // Same rooms → the same routine is updated, not duplicated.
  r = await executeTool('set_wake_up', { rooms: ['Bedroom'], time: '06:45', turn_off_after_minutes: 0 }, ctx());
  assert.ok(r.ok, r.message);
  const wakes = buildHome(await client.getAll()).routines.filter((x) => x.kind === 'wake_up');
  assert.equal(wakes.length, 1);
  assert.equal(wakes[0].time, '06:45');
  assert.equal(wakes[0].turnOffAfterMinutes, null);
  assert.equal(wakes[0].fadeMinutes, 20);
  r = await executeTool('set_go_to_sleep', { rooms: ['Bedroom', 'Living room'], time: '23:30', fade_minutes: 15, end: 'off', name: 'Bedtime' }, ctx());
  assert.ok(r.ok, r.message);
  rt = buildHome(await client.getAll()).routines.find((x) => x.name === 'Bedtime');
  assert.equal(rt.kind, 'go_to_sleep');
  assert.equal(rt.endState, 'turn_off');
  assert.equal(rt.where.length, 2);
  r = await executeTool('list_routines', {}, ctx());
  assert.ok(r.ok);
  assert.equal(r.routines.length, 2);
  assert.equal(r.routines.find((x) => x.name === 'Bedtime').end, 'off');
  r = await executeTool('set_go_to_sleep', { rooms: ['Bedroom'], time: '23:00', name: 'Bedtime', enabled: false }, ctx());
  assert.ok(r.ok, r.message);
  rt = buildHome(await client.getAll()).routines.find((x) => x.name === 'Bedtime');
  assert.equal(rt.enabled, false);
  assert.equal(rt.where.length, 1);
  assert.ok(buildSystemPrompt(buildHome(await client.getAll())).includes('Routines:'));
  r = await executeTool('delete_routine', { routine: 'Bedtime' }, ctx());
  assert.ok(r.ok, r.message);
  r = await executeTool('delete_routine', { routine: wakes[0].id }, ctx());
  assert.ok(r.ok, r.message);
  assert.equal(buildHome(await client.getAll()).routines.length, 0);
  r = await executeTool('delete_routine', { routine: 'Bedtime' }, ctx());
  assert.equal(r.error, 'not_found');
});
