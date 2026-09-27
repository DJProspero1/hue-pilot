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
  assert.equal(office.slots.length, 1);
  assert.equal(office.onlyWhenDark, false);
  assert.equal(office.slots[0].noMotionAfterMinutes, 2);
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
