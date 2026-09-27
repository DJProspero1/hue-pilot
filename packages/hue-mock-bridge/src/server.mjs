#!/usr/bin/env node
/**
 * Mock Philips Hue bridge (CLIP v2 + the v1 bits the suite uses).
 * Plain HTTP, no dependencies. Pairing always succeeds.
 *
 *   node packages/hue-mock-bridge/src/server.mjs --port 8080
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { kelvinToRgb, rgbToXy, GAMUT_C } from '../../hue-core/src/color.ts';

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

function ctToXy(mirek) {
  return rgbToXy(kelvinToRgb(1_000_000 / mirek), GAMUT_C);
}

// -----------------------------------------------------------------------------
// Seed data
// -----------------------------------------------------------------------------

export function createSeed() {
  const res = new Map();
  const put = (r) => (res.set(r.id, r), r);
  let lightV1 = 0;
  let groupV1 = 0;
  let sceneV1 = 0;

  const bridgeDeviceId = randomUUID();
  const bridgeId = randomUUID();
  put({
    id: bridgeDeviceId,
    type: 'device',
    product_data: {
      model_id: 'BSB002',
      manufacturer_name: 'Signify Netherlands B.V.',
      product_name: 'Hue Bridge',
      product_archetype: 'bridge_v2',
      certified: true,
      software_version: '1.70.1970000000',
    },
    metadata: { name: 'Mock Hue Bridge', archetype: 'bridge_v2' },
    services: [{ rid: bridgeId, rtype: 'bridge' }],
  });
  put({
    id: bridgeId,
    id_v1: '',
    type: 'bridge',
    owner: { rid: bridgeDeviceId, rtype: 'device' },
    bridge_id: 'mock0000000001',
    time_zone: { time_zone: 'Europe/Lisbon' },
  });

  const zigbee = (deviceId) =>
    put({ id: randomUUID(), type: 'zigbee_connectivity', owner: { rid: deviceId, rtype: 'device' }, status: 'connected', mac_address: '00:17:88:01:' + Math.random().toString(16).slice(2, 8) });

  const mkLight = ({ name, archetype = 'sultan_bulb', product = 'Hue color lamp', model = 'LCA001', color = true, ct = true, dim = true, gradient = false, effects = ['candle', 'fire', 'prism', 'sparkle', 'opal', 'glisten'], on = false, bri = 80, mirek = 366, xy }) => {
    const deviceId = randomUUID();
    const lightId = randomUUID();
    lightV1 += 1;
    const light = {
      id: lightId,
      id_v1: `/lights/${lightV1}`,
      type: 'light',
      owner: { rid: deviceId, rtype: 'device' },
      metadata: { name, archetype, function: 'mixed' },
      on: { on },
      mode: 'normal',
      alert: { action_values: ['breathe'] },
      signaling: { signal_values: ['no_signal', 'on_off', 'on_off_color', 'alternating'] },
      powerup: { preset: 'safety', configured: true },
    };
    if (dim) light.dimming = { brightness: bri, min_dim_level: 0.2 };
    if (ct) {
      light.color_temperature = { mirek: xy ? null : mirek, mirek_valid: !xy, mirek_schema: { mirek_minimum: 153, mirek_maximum: 500 } };
    }
    if (color) {
      light.color = { xy: xy ?? ctToXy(mirek), gamut: GAMUT_C, gamut_type: 'C' };
      light.dynamics = { status: 'none', status_values: ['none', 'dynamic_palette'], speed: 0, speed_valid: false };
      light.effects_v2 = {
        action: { effect_values: ['no_effect', ...effects] },
        status: { effect: 'no_effect', effect_values: ['no_effect', ...effects] },
      };
      light.timed_effects = { status_values: ['no_effect', 'sunrise', 'sunset'], status: 'no_effect', effect_values: ['no_effect', 'sunrise', 'sunset'] };
    }
    if (gradient) {
      light.gradient = { points: [], mode: 'interpolated_palette', points_capable: 5, mode_values: ['interpolated_palette', 'interpolated_palette_mirrored', 'random_pixelated'], pixel_count: 7 };
    }
    put({
      id: deviceId,
      id_v1: `/lights/${lightV1}`,
      type: 'device',
      product_data: { model_id: model, manufacturer_name: 'Signify Netherlands B.V.', product_name: product, product_archetype: archetype, certified: true, software_version: '1.116.3' },
      metadata: { name, archetype },
      services: [{ rid: lightId, rtype: 'light' }],
    });
    zigbee(deviceId);
    put(light);
    return { deviceId, lightId };
  };

  const mkGroup = (type, { name, archetype, children }) => {
    const id = randomUUID();
    const glId = randomUUID();
    groupV1 += 1;
    put({ id, id_v1: `/groups/${groupV1}`, type, metadata: { name, archetype }, children, services: [{ rid: glId, rtype: 'grouped_light' }] });
    put({ id: glId, id_v1: `/groups/${groupV1}`, type: 'grouped_light', owner: { rid: id, rtype: type }, on: { on: false }, dimming: { brightness: 0 }, alert: { action_values: ['breathe'] } });
    return { id, glId };
  };

  const office = [
    mkLight({ name: 'Desk Lamp', archetype: 'table_shade', product: 'Hue color lamp', on: true, bri: 70, mirek: 300 }),
    mkLight({ name: 'Office Ceiling', archetype: 'ceiling_round', product: 'Hue color ceiling', model: 'LCA002', on: true, bri: 90, mirek: 250 }),
    mkLight({ name: 'Bookshelf Strip', archetype: 'hue_lightstrip', product: 'Hue gradient lightstrip', model: 'LCX004', gradient: true, on: true, bri: 40, xy: { x: 0.2, y: 0.4 } }),
  ];
  const living = [
    mkLight({ name: 'Floor Lamp', archetype: 'floor_shade', product: 'Hue color lamp', on: true, bri: 60, xy: { x: 0.5, y: 0.41 } }),
    mkLight({ name: 'TV Lightstrip', archetype: 'hue_lightstrip_tv', product: 'Hue Play gradient lightstrip', model: 'LCX001', gradient: true, on: true, bri: 50, xy: { x: 0.16, y: 0.2 } }),
    mkLight({ name: 'Sofa Lamp', archetype: 'table_shade', product: 'Hue white ambiance lamp', model: 'LTA001', color: false, effects: [], on: false, bri: 60, mirek: 400 }),
  ];
  const bedroom = [
    mkLight({ name: 'Bedside Left', archetype: 'table_shade', product: 'Hue color lamp', on: false, bri: 30, mirek: 447 }),
    mkLight({ name: 'Bedside Right', archetype: 'table_shade', product: 'Hue color lamp', on: false, bri: 30, mirek: 447 }),
  ];
  const kitchen = [
    mkLight({ name: 'Kitchen Spots', archetype: 'recessed_ceiling', product: 'Hue white ambiance spot', model: 'LTG002', color: false, effects: [], on: true, bri: 100, mirek: 233 }),
    mkLight({ name: 'Counter Strip', archetype: 'hue_lightstrip', product: 'Hue lightstrip plus', model: 'LST002', on: false, bri: 80, mirek: 300 }),
  ];
  const hallway = [mkLight({ name: 'Hallway', archetype: 'pendant_round', product: 'Hue white lamp', model: 'LWA001', color: false, ct: false, effects: [], on: false, bri: 100 })];

  const dev = (arr) => arr.map((l) => ({ rid: l.deviceId, rtype: 'device' }));
  const rooms = {
    office: mkGroup('room', { name: 'Office', archetype: 'office', children: dev(office) }),
    living: mkGroup('room', { name: 'Living Room', archetype: 'living_room', children: dev(living) }),
    bedroom: mkGroup('room', { name: 'Bedroom', archetype: 'bedroom', children: dev(bedroom) }),
    kitchen: mkGroup('room', { name: 'Kitchen', archetype: 'kitchen', children: dev(kitchen) }),
    hallway: mkGroup('room', { name: 'Hallway', archetype: 'hallway', children: dev(hallway) }),
  };
  mkGroup('zone', { name: 'Downstairs', archetype: 'downstairs', children: [...living, ...kitchen, ...hallway].map((l) => ({ rid: l.lightId, rtype: 'light' })) });

  // bridge_home
  const allDevices = [...res.values()].filter((r) => r.type === 'device' && r.id !== bridgeDeviceId).map((d) => ({ rid: d.id, rtype: 'device' }));
  const homeGl = randomUUID();
  const homeId = randomUUID();
  put({ id: homeId, id_v1: '/groups/0', type: 'bridge_home', children: [...allDevices, { rid: bridgeDeviceId, rtype: 'device' }], services: [{ rid: homeGl, rtype: 'grouped_light' }] });
  put({ id: homeGl, id_v1: '/groups/0', type: 'grouped_light', owner: { rid: homeId, rtype: 'bridge_home' }, on: { on: true }, dimming: { brightness: 60 }, alert: { action_values: ['breathe'] } });

  // Scenes
  const sceneId = () => {
    sceneV1 += 1;
    return `/scenes/mock${String(sceneV1).padStart(4, '0')}`;
  };
  const presets = {
    Relax: { mirek: 447, bri: 56 },
    Energize: { mirek: 156, bri: 100 },
    Concentrate: { mirek: 233, bri: 100 },
    Read: { mirek: 346, bri: 100 },
    Nightlight: { mirek: 500, bri: 1 },
    'Dimmed': { mirek: 366, bri: 30 },
  };
  const mkScene = (name, group, lights, spec, extra = {}) => {
    const actions = lights.map((l) => {
      const light = res.get(l.lightId);
      const action = { on: { on: true } };
      if (light.dimming) action.dimming = { brightness: spec.bri };
      if (spec.xyList) {
        const xy = spec.xyList[lights.indexOf(l) % spec.xyList.length];
        if (light.color) action.color = { xy };
        else if (light.color_temperature) action.color_temperature = { mirek: 366 };
      } else if (light.color_temperature) action.color_temperature = { mirek: spec.mirek };
      else if (light.color) action.color = { xy: ctToXy(spec.mirek) };
      return { target: { rid: l.lightId, rtype: 'light' }, action };
    });
    const palette = spec.xyList
      ? { color: spec.xyList.map((xy) => ({ color: { xy }, dimming: { brightness: spec.bri } })), dimming: [], color_temperature: [] }
      : { color: [], dimming: [{ brightness: spec.bri }], color_temperature: [{ color_temperature: { mirek: spec.mirek }, dimming: { brightness: spec.bri } }] };
    put({
      id: randomUUID(),
      id_v1: sceneId(),
      type: 'scene',
      metadata: { name, image: { rid: randomUUID(), rtype: 'public_image' } },
      group: { rid: group.id, rtype: res.get(group.id).type },
      actions,
      palette,
      speed: 0.5,
      auto_dynamic: !!spec.xyList,
      status: { active: 'inactive' },
      ...extra,
    });
  };
  for (const [key, lights] of [['office', office], ['living', living], ['bedroom', bedroom], ['kitchen', kitchen], ['hallway', hallway]]) {
    for (const [name, spec] of Object.entries(presets)) mkScene(name, rooms[key], lights, spec);
  }
  mkScene('Savanna sunset', rooms.living, living, { bri: 70, xyList: [{ x: 0.5776, y: 0.3813 }, { x: 0.4813, y: 0.4291 }, { x: 0.4218, y: 0.4437 }, { x: 0.5325, y: 0.4243 }] });
  mkScene('Tropical twilight', rooms.bedroom, bedroom, { bri: 60, xyList: [{ x: 0.1587, y: 0.1054 }, { x: 0.2286, y: 0.1421 }, { x: 0.4359, y: 0.2364 }, { x: 0.302, y: 0.1534 }] });
  mkScene('Focus', rooms.office, office, { mirek: 200, bri: 100 });

  // Motion sensor (office)
  const motionDev = randomUUID();
  const motionSvc = randomUUID();
  put({
    id: motionDev,
    id_v1: '/sensors/10',
    type: 'device',
    product_data: { model_id: 'SML001', manufacturer_name: 'Signify Netherlands B.V.', product_name: 'Hue motion sensor', product_archetype: 'unknown_archetype', certified: true, software_version: '6.1.1.27575' },
    metadata: { name: 'Office motion sensor', archetype: 'unknown_archetype' },
    services: [{ rid: motionSvc, rtype: 'motion' }],
  });
  put({ id: motionSvc, id_v1: '/sensors/10', type: 'motion', owner: { rid: motionDev, rtype: 'device' }, enabled: true, motion: { motion: false, motion_valid: true, motion_report: { changed: now(), motion: false } }, sensitivity: { status: 'set', sensitivity: 2, sensitivity_max: 4 } });
  const tempSvc = put({ id: randomUUID(), id_v1: '/sensors/11', type: 'temperature', owner: { rid: motionDev, rtype: 'device' }, enabled: true, temperature: { temperature: 22.4, temperature_valid: true, temperature_report: { changed: now(), temperature: 22.4 } } });
  const levelSvc = put({ id: randomUUID(), id_v1: '/sensors/12', type: 'light_level', owner: { rid: motionDev, rtype: 'device' }, enabled: true, light: { light_level: 18432, light_level_valid: true, light_level_report: { changed: now(), light_level: 18432 } } });
  const powerSvc = put({ id: randomUUID(), type: 'device_power', owner: { rid: motionDev, rtype: 'device' }, power_state: { battery_state: 'normal', battery_level: 87 } });
  res.get(motionDev).services.push({ rid: tempSvc.id, rtype: 'temperature' }, { rid: levelSvc.id, rtype: 'light_level' }, { rid: powerSvc.id, rtype: 'device_power' });
  zigbee(motionDev);

  // Dimmer switch (bedroom)
  const switchDev = randomUUID();
  const buttons = [1, 2, 3, 4].map((n) => ({ id: randomUUID(), n }));
  put({
    id: switchDev,
    id_v1: '/sensors/20',
    type: 'device',
    product_data: { model_id: 'RWL022', manufacturer_name: 'Signify Netherlands B.V.', product_name: 'Hue dimmer switch', product_archetype: 'unknown_archetype', certified: true, software_version: '2.47.8' },
    metadata: { name: 'Bedroom dimmer', archetype: 'unknown_archetype' },
    services: buttons.map((b) => ({ rid: b.id, rtype: 'button' })),
  });
  for (const b of buttons) {
    put({ id: b.id, id_v1: '/sensors/20', type: 'button', owner: { rid: switchDev, rtype: 'device' }, metadata: { control_id: b.n }, button: { last_event: b.n === 1 ? 'short_release' : undefined, button_report: b.n === 1 ? { updated: now(), event: 'short_release' } : undefined, repeat_interval: 800, event_values: ['initial_press', 'repeat', 'short_release', 'long_press', 'long_release'] } });
  }
  const swPower = put({ id: randomUUID(), type: 'device_power', owner: { rid: switchDev, rtype: 'device' }, power_state: { battery_state: 'normal', battery_level: 64 } });
  res.get(switchDev).services.push({ rid: swPower.id, rtype: 'device_power' });
  zigbee(switchDev);

  // Hue Secure cameras, shaped exactly like a real Hue Bridge Pro reports them:
  // a battery camera (camera_motion + device_power + light_level) and a floodlight camera
  // (camera_motion + light_level) whose floodlight is a separate light device (archetype hue_floodlight_camera).
  const mkCamera = ({ name, model, product, battery, motion = false, lux = 12000, software = '2.86.1' }) => {
    const deviceId = randomUUID();
    const camMotion = put({ id: randomUUID(), type: 'camera_motion', owner: { rid: deviceId, rtype: 'device' }, enabled: true, motion: { motion, motion_valid: true, motion_report: { changed: now(), motion } } });
    const level = put({ id: randomUUID(), type: 'light_level', owner: { rid: deviceId, rtype: 'device' }, enabled: true, light: { light_level: lux, light_level_valid: true, light_level_report: { changed: now(), light_level: lux } } });
    const services = [{ rid: camMotion.id, rtype: 'camera_motion' }, { rid: level.id, rtype: 'light_level' }];
    if (battery != null) {
      const power = put({ id: randomUUID(), type: 'device_power', owner: { rid: deviceId, rtype: 'device' }, power_state: { battery_state: battery < 20 ? 'low' : 'normal', battery_level: battery } });
      services.push({ rid: power.id, rtype: 'device_power' });
    }
    put({
      id: deviceId,
      type: 'device',
      product_data: { model_id: model, manufacturer_name: 'Signify Netherlands B.V.', product_name: product, product_archetype: 'unknown_archetype', certified: true, software_version: software },
      metadata: { name, archetype: 'unknown_archetype' },
      identify: {},
      services,
    });
    zigbee(deviceId);
    return deviceId;
  };
  const cam1 = mkCamera({ name: 'Front door camera', model: 'CMB001', product: 'Secure battery camera', battery: 72, lux: 16000 });
  const cam2 = mkCamera({ name: 'Driveway camera', model: 'CMW002', product: 'Secure floodlight camera', battery: null, motion: true, lux: 4000 });
  const floodlight = mkLight({ name: 'Driveway floodlight', archetype: 'hue_floodlight_camera', product: 'Secure floodlight camera', model: '442296118491', on: false, bri: 100, mirek: 300 });
  mkGroup('room', { name: 'Driveway', archetype: 'driveway', children: dev([floodlight]) });

  // Automations: the "Hue Accessories" behavior script and one motion-sensor rule (office), as the Hue app creates them.
  const ACCESSORY_SCRIPT = '67d9395b-4403-42cc-b5f0-740b699d67c6';
  put({ id: ACCESSORY_SCRIPT, type: 'behavior_script', description: 'Motion sensors and Hue Secure cameras', configuration_schema: { $ref: 'config.json#' }, trigger_schema: { $ref: 'trigger.json#' }, state_schema: { $ref: 'state.json#' }, version: '0.0.1', metadata: { name: 'Hue Accessories', category: 'accessory' }, supported_features: [] });
  const officeRoom = [...res.values()].find((r) => r.type === 'room' && r.metadata?.name === 'Office') ?? [...res.values()].find((r) => r.type === 'room');
  const focusScene = [...res.values()].find((r) => r.type === 'scene' && r.metadata?.name === 'Focus') ?? [...res.values()].find((r) => r.type === 'scene');
  put({
    id: randomUUID(),
    type: 'behavior_instance',
    script_id: ACCESSORY_SCRIPT,
    enabled: true,
    status: 'running',
    last_error: '',
    state: { source_type: 'device', model_id: 'SML001' },
    dependees: [],
    metadata: { name: 'Office motion sensor' },
    configuration: {
      source: { rid: motionDev, rtype: 'device' },
      light_level: { daylight: { sunrise_sunset: { sunrise_offset: { hours: -2 }, sunset_offset: { hours: 2 } } } },
      motion: {
        motion_service: { rid: motionSvc, rtype: 'motion' },
        where: [{ group: { rid: officeRoom.id, rtype: 'room' } }],
        when: {
          timeslots: [
            { start_time: { type: 'time', time: { hour: 7, minute: 0 } }, do_not_disturb: true, on_motion: { recall_single: [{ action: 'do_nothing' }] }, on_no_motion: { after: { minutes: 10 }, recall_single: [{ action: 'all_off' }] } },
            { start_time: { type: 'time', time: { hour: 22, minute: 0 } }, on_motion: { recall_single: [{ action: { recall: { rid: focusScene.id, rtype: 'scene' } } }] }, on_no_motion: { after: { minutes: 5 }, recall_single: [{ action: 'all_off' }] } },
          ],
        },
      },
    },
  });
  res.get(homeId).children.push({ rid: cam1, rtype: 'device' }, { rid: cam2, rtype: 'device' }, { rid: floodlight.deviceId, rtype: 'device' });

  return res;
}

// -----------------------------------------------------------------------------
// Server
// -----------------------------------------------------------------------------

export function createMockBridge({ port = 8080, host = '0.0.0.0', log = true, simulate = true, seed } = {}) {
  const resources = seed ?? createSeed();
  const schedules = new Map();
  let scheduleSeq = 0;
  const sseClients = new Set();
  let eventSeq = 0;
  const logger = log ? (...a) => console.log(new Date().toISOString().slice(11, 19), ...a) : () => {};

  const byType = (type) => [...resources.values()].filter((r) => r.type === type);

  function emit(type, items) {
    if (!items.length) return;
    eventSeq += 1;
    const event = { creationtime: now(), id: randomUUID(), type, data: items };
    const frame = `id: ${eventSeq}\ndata: ${JSON.stringify([event])}\n\n`;
    for (const res of sseClients) res.write(frame);
  }

  function groupsContaining(lightId) {
    const out = [];
    const light = resources.get(lightId);
    for (const g of resources.values()) {
      if (g.type !== 'room' && g.type !== 'zone' && g.type !== 'bridge_home') continue;
      const ids = memberLightIds(g);
      if (ids.includes(lightId) || (g.type === 'bridge_home' && light)) out.push(g);
    }
    return out;
  }

  function memberLightIds(group) {
    const ids = [];
    for (const c of group.children ?? []) {
      if (c.rtype === 'light') ids.push(c.rid);
      else if (c.rtype === 'device') {
        const d = resources.get(c.rid);
        for (const s of d?.services ?? []) if (s.rtype === 'light') ids.push(s.rid);
      }
    }
    return ids;
  }

  function refreshGroupedLight(group) {
    const glRef = (group.services ?? []).find((s) => s.rtype === 'grouped_light');
    const gl = glRef && resources.get(glRef.rid);
    if (!gl) return;
    const members = memberLightIds(group).map((id) => resources.get(id)).filter(Boolean);
    const on = members.some((l) => l.on?.on);
    const onMembers = members.filter((l) => l.on?.on && l.dimming);
    const bri = onMembers.length ? Math.round(onMembers.reduce((a, l) => a + l.dimming.brightness, 0) / onMembers.length) : 0;
    const changed = {};
    if (gl.on?.on !== on) {
      gl.on = { on };
      changed.on = gl.on;
    }
    if (gl.dimming?.brightness !== bri) {
      gl.dimming = { brightness: bri };
      changed.dimming = gl.dimming;
    }
    if (Object.keys(changed).length) emit('update', [{ id: gl.id, id_v1: gl.id_v1, type: 'grouped_light', owner: gl.owner, ...changed }]);
  }

  function applyLightUpdate(light, body) {
    const changed = {};
    if (body.on && typeof body.on.on === 'boolean') {
      light.on = { on: body.on.on };
      changed.on = light.on;
    }
    if (body.dimming && light.dimming && typeof body.dimming.brightness === 'number') {
      light.dimming.brightness = clamp(body.dimming.brightness, 0, 100);
      changed.dimming = { brightness: light.dimming.brightness };
    }
    if (body.dimming_delta && light.dimming) {
      const d = body.dimming_delta.brightness_delta ?? 10;
      light.dimming.brightness = clamp(light.dimming.brightness + (body.dimming_delta.action === 'down' ? -d : d), 0, 100);
      changed.dimming = { brightness: light.dimming.brightness };
    }
    if (body.color?.xy && light.color) {
      light.color.xy = { x: Number(body.color.xy.x), y: Number(body.color.xy.y) };
      changed.color = { xy: light.color.xy };
      if (light.color_temperature) {
        light.color_temperature.mirek = null;
        light.color_temperature.mirek_valid = false;
        changed.color_temperature = { mirek: null, mirek_valid: false };
      }
    }
    if (body.color_temperature?.mirek && light.color_temperature) {
      const m = clamp(Math.round(body.color_temperature.mirek), light.color_temperature.mirek_schema.mirek_minimum, light.color_temperature.mirek_schema.mirek_maximum);
      light.color_temperature.mirek = m;
      light.color_temperature.mirek_valid = true;
      changed.color_temperature = { mirek: m, mirek_valid: true };
      if (light.color) {
        light.color.xy = ctToXy(m);
        changed.color = { xy: light.color.xy };
      }
    }
    if (body.effects_v2?.action?.effect && light.effects_v2) {
      light.effects_v2.status.effect = body.effects_v2.action.effect;
      changed.effects_v2 = { status: { effect: light.effects_v2.status.effect } };
    }
    if (body.effects?.effect && light.effects_v2) {
      light.effects_v2.status.effect = body.effects.effect;
      changed.effects_v2 = { status: { effect: light.effects_v2.status.effect } };
    }
    if (body.metadata?.name) {
      light.metadata.name = String(body.metadata.name);
      changed.metadata = { name: light.metadata.name };
      const dev = resources.get(light.owner?.rid);
      if (dev) dev.metadata.name = light.metadata.name;
    }
    if (body.gradient?.points && light.gradient) {
      light.gradient.points = body.gradient.points;
      changed.gradient = { points: light.gradient.points };
    }
    if (body.alert?.action === 'breathe') logger(`  (${light.metadata.name} blinks)`);
    return changed;
  }

  function updateLight(id, body, { deactivateScenes = true } = {}) {
    const light = resources.get(id);
    if (!light || light.type !== 'light') return null;
    const changed = applyLightUpdate(light, body);
    if (Object.keys(changed).length) {
      emit('update', [{ id, id_v1: light.id_v1, type: 'light', owner: light.owner, ...changed }]);
      for (const g of groupsContaining(id)) {
        refreshGroupedLight(g);
        if (deactivateScenes) deactivateScenesOf(g.id);
      }
    }
    return [{ rid: id, rtype: 'light' }];
  }

  function deactivateScenesOf(groupId) {
    const changed = [];
    for (const s of byType('scene')) {
      if (s.group.rid === groupId && s.status?.active !== 'inactive') {
        s.status = { active: 'inactive' };
        changed.push({ id: s.id, id_v1: s.id_v1, type: 'scene', status: s.status });
      }
    }
    emit('update', changed);
  }

  function updateGroupedLight(id, body) {
    const gl = resources.get(id);
    if (!gl || gl.type !== 'grouped_light') return null;
    const group = resources.get(gl.owner.rid);
    const members = memberLightIds(group);
    for (const lid of members) {
      const light = resources.get(lid);
      const changed = applyLightUpdate(light, body);
      if (Object.keys(changed).length) emit('update', [{ id: lid, id_v1: light.id_v1, type: 'light', owner: light.owner, ...changed }]);
    }
    for (const g of new Set(members.flatMap((lid) => groupsContaining(lid)))) refreshGroupedLight(g);
    refreshGroupedLight(group);
    if (body.on || body.dimming || body.color || body.color_temperature) deactivateScenesOf(group.id);
    return [{ rid: id, rtype: 'grouped_light' }];
  }

  function recallScene(scene, recall) {
    for (const a of scene.actions) {
      const light = resources.get(a.target.rid);
      if (!light) continue;
      const changed = applyLightUpdate(light, a.action);
      if (Object.keys(changed).length) emit('update', [{ id: light.id, id_v1: light.id_v1, type: 'light', owner: light.owner, ...changed }]);
    }
    const group = resources.get(scene.group.rid);
    if (group) {
      refreshGroupedLight(group);
      for (const g of new Set(memberLightIds(group).flatMap((lid) => groupsContaining(lid)))) refreshGroupedLight(g);
    }
    const changed = [];
    for (const s of byType('scene')) {
      if (s.group.rid !== scene.group.rid) continue;
      const active = s.id === scene.id ? (recall.action === 'dynamic_palette' ? 'dynamic_palette' : 'static') : 'inactive';
      if (s.status?.active !== active) {
        s.status = { active, ...(s.id === scene.id ? { last_recall: now() } : {}) };
        changed.push({ id: s.id, id_v1: s.id_v1, type: 'scene', status: s.status });
      }
    }
    emit('update', changed);
  }

  function json(res, status, body) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,OPTIONS' });
    res.end(JSON.stringify(body));
  }

  function readBody(req) {
    return new Promise((resolve) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        try {
          resolve(raw ? JSON.parse(raw) : {});
        } catch {
          resolve({});
        }
      });
    });
  }

  const config = () => ({
    name: 'Mock Hue Bridge',
    datastoreversion: '170',
    swversion: '1970000000',
    apiversion: '1.70.0',
    mac: '00:17:88:aa:bb:cc',
    bridgeid: 'MOCK0000000001',
    factorynew: false,
    replacesbridgeid: null,
    modelid: 'BSB002',
    starterkitid: '',
    zigbeechannel: 25,
    timezone: 'Europe/Lisbon',
    localtime: new Date().toISOString().slice(0, 19),
  });

  async function handle(req, res) {
    const url = new URL(req.url, 'http://mock');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const method = req.method;
    if (method === 'OPTIONS') return json(res, 204, {});
    logger(method, path);

    // ---- pairing & config (v1)
    if (path === '/api' && method === 'POST') {
      const body = await readBody(req);
      return json(res, 200, [{ success: { username: `mock-${randomUUID().replace(/-/g, '').slice(0, 32)}`, clientkey: 'A1B2C3D4E5F60718293A4B5C6D7E8F90' } }]);
    }
    let m;
    if ((m = path.match(/^\/api\/([^/]+)\/config$/)) && method === 'GET') return json(res, 200, config());
    if ((m = path.match(/^\/api\/0\/config$/))) return json(res, 200, config());

    // ---- v1 schedules
    if ((m = path.match(/^\/api\/([^/]+)\/schedules$/))) {
      if (method === 'GET') return json(res, 200, Object.fromEntries(schedules));
      if (method === 'POST') {
        const body = await readBody(req);
        scheduleSeq += 1;
        const id = String(scheduleSeq);
        schedules.set(id, { name: 'schedule', status: 'enabled', recycle: false, autodelete: true, ...body, created: now().slice(0, 19), time: body.localtime });
        return json(res, 200, [{ success: { id } }]);
      }
    }
    if ((m = path.match(/^\/api\/([^/]+)\/schedules\/([^/]+)$/))) {
      const id = m[2];
      if (!schedules.has(id)) return json(res, 200, [{ error: { type: 3, address: path, description: `resource, /schedules/${id}, not available` } }]);
      if (method === 'GET') return json(res, 200, schedules.get(id));
      if (method === 'PUT') {
        const body = await readBody(req);
        schedules.set(id, { ...schedules.get(id), ...body });
        return json(res, 200, Object.keys(body).map((k) => ({ success: { [`/schedules/${id}/${k}`]: body[k] } })));
      }
      if (method === 'DELETE') {
        schedules.delete(id);
        return json(res, 200, [{ success: `/schedules/${id} deleted` }]);
      }
    }
    if ((m = path.match(/^\/api\/([^/]+)\/lights$/)) && method === 'POST') return json(res, 200, [{ success: { '/lights': 'Searching for new devices' } }]);
    if ((m = path.match(/^\/api\/([^/]+)\/lights\/new$/))) return json(res, 200, { lastscan: 'active' });
    if ((m = path.match(/^\/api\/([^/]+)\/groups\/([^/]+)\/action$/)) && method === 'PUT') {
      const body = await readBody(req);
      const v1 = `/groups/${m[2]}`;
      const group = [...resources.values()].find((r) => (r.type === 'room' || r.type === 'zone' || r.type === 'bridge_home') && r.id_v1 === v1);
      if (!group) return json(res, 200, [{ error: { type: 3, address: path, description: 'resource not available' } }]);
      if (body.scene) {
        const scene = byType('scene').find((s) => s.id_v1 === `/scenes/${body.scene}`);
        if (scene) recallScene(scene, { action: 'active' });
      }
      const v2 = {};
      if (typeof body.on === 'boolean') v2.on = { on: body.on };
      if (typeof body.bri === 'number') v2.dimming = { brightness: Math.round((body.bri / 254) * 100) };
      const glRef = group.services.find((s) => s.rtype === 'grouped_light');
      if (Object.keys(v2).length && glRef) updateGroupedLight(glRef.rid, v2);
      return json(res, 200, Object.keys(body).map((k) => ({ success: { [`${v1}/action/${k}`]: body[k] } })));
    }

    // ---- event stream
    if (path === '/eventstream/clip/v2') {
      if (!req.headers['hue-application-key']) return json(res, 403, { errors: [{ description: 'unauthorized user' }], data: [] });
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
      res.write(': hi\n\n');
      sseClients.add(res);
      const ka = setInterval(() => res.write(': hi\n\n'), 15000);
      req.on('close', () => {
        clearInterval(ka);
        sseClients.delete(res);
      });
      return;
    }

    // ---- CLIP v2
    if ((m = path.match(/^\/clip\/v2\/resource(?:\/([a-z_]+))?(?:\/([^/]+))?$/))) {
      if (!req.headers['hue-application-key']) return json(res, 403, { errors: [{ description: 'unauthorized user' }], data: [] });
      const [, type, id] = m;
      if (method === 'GET') {
        if (!type) return json(res, 200, { errors: [], data: [...resources.values()] });
        if (!id) return json(res, 200, { errors: [], data: byType(type) });
        const r = resources.get(id);
        if (!r || r.type !== type) return json(res, 404, { errors: [{ description: `resource ${type}/${id} not found` }], data: [] });
        return json(res, 200, { errors: [], data: [r] });
      }
      if (method === 'PUT' && type && id) {
        const body = await readBody(req);
        const r = resources.get(id);
        if (!r || r.type !== type) return json(res, 404, { errors: [{ description: `resource ${type}/${id} not found` }], data: [] });
        if (type === 'light') return json(res, 200, { errors: [], data: updateLight(id, body) });
        if (type === 'grouped_light') return json(res, 200, { errors: [], data: updateGroupedLight(id, body) });
        if (type === 'scene') {
          if (body.recall) recallScene(r, body.recall);
          if (body.metadata?.name) r.metadata.name = body.metadata.name;
          if (body.actions) r.actions = body.actions;
          if (typeof body.speed === 'number') r.speed = body.speed;
          if (typeof body.auto_dynamic === 'boolean') r.auto_dynamic = body.auto_dynamic;
          if (body.palette) r.palette = body.palette;
          if (body.metadata || body.actions || body.speed !== undefined || body.palette) emit('update', [{ id, id_v1: r.id_v1, type: 'scene', metadata: r.metadata, speed: r.speed, auto_dynamic: r.auto_dynamic }]);
          return json(res, 200, { errors: [], data: [{ rid: id, rtype: 'scene' }] });
        }
        if (type === 'motion' || type === 'camera_motion' || type === 'temperature' || type === 'light_level') {
          if (typeof body.enabled === 'boolean') r.enabled = body.enabled;
          if (body.sensitivity && r.sensitivity) r.sensitivity.sensitivity = body.sensitivity.sensitivity;
          emit('update', [{ id, type, owner: r.owner, enabled: r.enabled, ...(r.sensitivity ? { sensitivity: r.sensitivity } : {}) }]);
          return json(res, 200, { errors: [], data: [{ rid: id, rtype: type }] });
        }
        if (type === 'behavior_instance') {
          // Like the real bridge: script_id may not be sent on PUT, and a PUT that carries `enabled` without the configuration is refused.
          if (body.script_id !== undefined) return json(res, 200, { errors: [{ description: 'property: script_id  not allowed' }], data: [{ rid: id, rtype: type }] });
          if (typeof body.enabled === 'boolean' && !body.configuration) return json(res, 200, { errors: [{ description: "The instance doesn't support triggers." }], data: [{ rid: id, rtype: type }] });
          if (typeof body.enabled === 'boolean') r.enabled = body.enabled;
          if (body.metadata) r.metadata = { ...r.metadata, ...body.metadata };
          if (body.configuration) r.configuration = body.configuration;
          r.status = r.enabled ? 'running' : 'disabled';
          emit('update', [{ id, type, enabled: r.enabled, status: r.status, metadata: r.metadata, configuration: r.configuration }]);
          return json(res, 200, { errors: [], data: [{ rid: id, rtype: type }] });
        }
        if (body.metadata) {
          r.metadata = { ...r.metadata, ...body.metadata };
          emit('update', [{ id, id_v1: r.id_v1, type, metadata: r.metadata }]);
        }
        if (body.children && (type === 'room' || type === 'zone')) {
          r.children = body.children;
          emit('update', [{ id, id_v1: r.id_v1, type, children: r.children }]);
          refreshGroupedLight(r);
        }
        return json(res, 200, { errors: [], data: [{ rid: id, rtype: type }] });
      }
      if (method === 'POST' && type && !id) {
        const body = await readBody(req);
        if (type === 'scene') {
          const newId = randomUUID();
          const scene = {
            id: newId,
            id_v1: `/scenes/user${String(++scheduleSeq).padStart(4, '0')}`,
            type: 'scene',
            metadata: body.metadata ?? { name: 'New scene' },
            group: body.group,
            actions: body.actions ?? [],
            palette: body.palette ?? { color: [], dimming: [], color_temperature: [] },
            speed: body.speed ?? 0.5,
            auto_dynamic: !!body.auto_dynamic,
            status: { active: 'inactive' },
          };
          resources.set(newId, scene);
          emit('add', [scene]);
          return json(res, 200, { errors: [], data: [{ rid: newId, rtype: 'scene' }] });
        }
        if (type === 'zone' || type === 'room') {
          const newId = randomUUID();
          const glId = randomUUID();
          const g = { id: newId, id_v1: `/groups/${90 + scheduleSeq++}`, type, metadata: body.metadata ?? { name: 'New' }, children: body.children ?? [], services: [{ rid: glId, rtype: 'grouped_light' }] };
          const gl = { id: glId, type: 'grouped_light', owner: { rid: newId, rtype: type }, on: { on: false }, dimming: { brightness: 0 } };
          resources.set(newId, g);
          resources.set(glId, gl);
          emit('add', [g, gl]);
          refreshGroupedLight(g);
          return json(res, 200, { errors: [], data: [{ rid: newId, rtype: type }] });
        }
        if (type === 'behavior_instance') {
          const srcRid = body.configuration?.source?.rid;
          const existing = [...resources.values()].find((r) => r.type === 'behavior_instance' && r.script_id === body.script_id && srcRid && r.configuration?.source?.rid === srcRid);
          if (existing) {
            if (typeof body.enabled === 'boolean') existing.enabled = body.enabled;
            if (body.metadata) existing.metadata = { ...existing.metadata, ...body.metadata };
            if (body.configuration) existing.configuration = body.configuration;
            existing.status = existing.enabled ? 'running' : 'disabled';
            emit('update', [{ id: existing.id, type, enabled: existing.enabled, status: existing.status, metadata: existing.metadata, configuration: existing.configuration }]);
            return json(res, 200, { errors: [], data: [{ rid: existing.id, rtype: type }] });
          }
          const newId = randomUUID();
          const inst = { id: newId, type, script_id: body.script_id, enabled: body.enabled !== false, status: body.enabled === false ? 'disabled' : 'running', last_error: '', state: {}, dependees: [], metadata: body.metadata ?? { name: 'Automation' }, configuration: body.configuration ?? {} };
          resources.set(newId, inst);
          emit('add', [inst]);
          return json(res, 200, { errors: [], data: [{ rid: newId, rtype: type }] });
        }
        return json(res, 405, { errors: [{ description: `cannot create ${type}` }], data: [] });
      }
      if (method === 'DELETE' && type && id) {
        const r = resources.get(id);
        if (!r) return json(res, 404, { errors: [{ description: 'not found' }], data: [] });
        resources.delete(id);
        if (r.services) for (const s of r.services) if (s.rtype === 'grouped_light') resources.delete(s.rid);
        emit('delete', [{ id, id_v1: r.id_v1, type }]);
        return json(res, 200, { errors: [], data: [{ rid: id, rtype: type }] });
      }
    }
    json(res, 404, { errors: [{ description: `no route for ${method} ${path}` }], data: [] });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      logger('error', err);
      json(res, 500, { errors: [{ description: String(err) }], data: [] });
    });
  });

  let simTimer = null;
  return {
    server,
    resources,
    schedules,
    emit,
    start() {
      for (const g of [...resources.values()]) if (g.type === 'room' || g.type === 'zone' || g.type === 'bridge_home') refreshGroupedLight(g);
      return new Promise((resolve) => {
        server.listen(port, host, () => {
          const actual = server.address().port;
          logger(`Mock Hue bridge listening on http://${host}:${actual}`);
          if (simulate) {
            let motion = false;
            simTimer = setInterval(() => {
              motion = !motion;
              const svc = byType('motion')[0];
              if (svc) {
                svc.motion = { motion, motion_valid: true, motion_report: { changed: now(), motion } };
                emit('update', [{ id: svc.id, type: 'motion', owner: svc.owner, motion: svc.motion }]);
              }
              const cam = byType('camera_motion')[0];
              if (cam && cam.enabled !== false) {
                cam.motion = { motion: !motion, motion_valid: true, motion_report: { changed: now(), motion: !motion } };
                emit('update', [{ id: cam.id, type: 'camera_motion', owner: cam.owner, motion: cam.motion }]);
              }
              const t = byType('temperature')[0];
              if (t) {
                const v = Math.round((t.temperature.temperature + (Math.random() - 0.5) * 0.4) * 100) / 100;
                t.temperature = { temperature: v, temperature_valid: true, temperature_report: { changed: now(), temperature: v } };
                emit('update', [{ id: t.id, type: 'temperature', owner: t.owner, temperature: t.temperature }]);
              }
            }, 25000);
          }
          resolve({ port: actual });
        });
      });
    },
    stop() {
      if (simTimer) clearInterval(simTimer);
      for (const c of sseClients) c.end();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1].replace(/\\/g, '/').replace(/^([a-z]):/i, (m0) => m0) ? true : process.argv[1]?.endsWith('server.mjs');
if (isMain) {
  const args = process.argv.slice(2);
  const portIdx = args.indexOf('--port');
  const port = portIdx >= 0 ? Number(args[portIdx + 1]) : 8080;
  const hostIdx = args.indexOf('--host');
  const host = hostIdx >= 0 ? args[hostIdx + 1] : '0.0.0.0';
  createMockBridge({ port, host }).start();
}
