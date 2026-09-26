import { contextBridge, ipcRenderer } from 'electron';

const EVENT_CHANNELS = new Set(['hue:home', 'hue:status', 'hue:chat-event', 'hue:navigate', 'hue:settings', 'hue:motion-event']);

// contextBridge only copies plain enumerable properties, so we expose two functions and let the
// renderer build a typed proxy on top (see src/renderer/src/lib/api.ts).
contextBridge.exposeInMainWorld('hueBridge', {
  invoke: (method: string, ...args: unknown[]) => ipcRenderer.invoke('hue', method, ...args),
  on: (channel: string, cb: (payload: unknown) => void) => {
    if (!EVENT_CHANNELS.has(channel)) throw new Error(`Unknown channel ${channel}`);
    const listener = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
contextBridge.exposeInMainWorld('hueEnv', { platform: process.platform, versions: { electron: process.versions.electron } });
