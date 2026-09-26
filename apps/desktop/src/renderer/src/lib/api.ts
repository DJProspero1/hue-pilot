import type { HueApi } from '../../../shared/ipc-types.ts';

const EVENT_METHODS: Record<string, string> = {
  onHome: 'hue:home',
  onStatus: 'hue:status',
  onChatEvent: 'hue:chat-event',
  onNavigate: 'hue:navigate',
  onSettings: 'hue:settings',
  onMotionEvent: 'hue:motion-event',
  onMirrorStatus: 'hue:mirror-status',
  onCloudStatus: 'hue:cloud-status',
  onCloudLog: 'hue:cloud-log',
};

/** Typed facade over the preload bridge. Every method call becomes an IPC invoke. */
export function createHueApi(): HueApi {
  const bridge = window.hueBridge;
  if (!bridge) throw new Error('Preload bridge unavailable');
  return new Proxy({} as HueApi, {
    get(_target, prop: string) {
      if (prop in EVENT_METHODS) return (cb: (payload: unknown) => void) => bridge.on(EVENT_METHODS[prop], cb);
      if (prop === 'then' || typeof prop !== 'string') return undefined;
      return (...args: unknown[]) => bridge.invoke(prop, ...args);
    },
  });
}

export function installHueApi() {
  window.hue = createHueApi();
}
