/** Scene actions and palettes built from light views (what "save the current look" stores on the bridge). */
import type { LightView } from './model.ts';
import type { SceneAction, XY } from './types.ts';

/** The light's current state as a scene action. */
export function sceneActionFromLight(l: LightView): SceneAction {
  const action: SceneAction['action'] = { on: { on: !!l.on } };
  if (l.on) {
    if (l.supportsDimming) action.dimming = { brightness: Math.max(1, Math.round(l.brightness)) };
    if (l.colorMode === 'xy' && l.xy) action.color = { xy: l.xy };
    else if (l.colorMode === 'ct' && l.mirek) action.color_temperature = { mirek: l.mirek };
    if (l.effect && l.effect !== 'no_effect') {
      if (l.effectsV2) action.effects_v2 = { action: { effect: l.effect } };
      else action.effects = { effect: l.effect };
    }
  }
  return { target: { rid: l.id, rtype: 'light' }, action };
}

/** An explicit action for a light (a wanted state rather than the current one). */
export function sceneActionFor(lightId: string, state: { on?: boolean; brightness?: number; xy?: XY; mirek?: number }): SceneAction {
  const on = state.on ?? true;
  const action: SceneAction['action'] = { on: { on } };
  if (on) {
    if (state.brightness !== undefined) action.dimming = { brightness: Math.max(1, Math.min(100, Math.round(state.brightness))) };
    if (state.xy) action.color = { xy: state.xy };
    else if (state.mirek !== undefined) action.color_temperature = { mirek: state.mirek };
  }
  return { target: { rid: lightId, rtype: 'light' }, action };
}

/** The palette the Hue app shows for a scene: up to 9 colours, one white. */
export function paletteFromActions(actions: SceneAction[]) {
  const color: { color: { xy: XY }; dimming: { brightness: number } }[] = [];
  const ct: { color_temperature: { mirek: number }; dimming: { brightness: number } }[] = [];
  const seen = new Set<string>();
  for (const a of actions) {
    const bri = a.action.dimming?.brightness ?? 100;
    if (a.action.color?.xy) {
      const key = `${a.action.color.xy.x.toFixed(3)},${a.action.color.xy.y.toFixed(3)}`;
      if (!seen.has(key) && color.length < 9) {
        seen.add(key);
        color.push({ color: { xy: a.action.color.xy }, dimming: { brightness: bri } });
      }
    } else if (a.action.color_temperature?.mirek && ct.length < 1) {
      ct.push({ color_temperature: { mirek: a.action.color_temperature.mirek }, dimming: { brightness: bri } });
    }
  }
  return { color, dimming: [], color_temperature: ct };
}
