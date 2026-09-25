import type { HueApi } from '../shared/ipc-types.ts';

declare global {
  interface Window {
    hue: HueApi;
    hueBridge: {
      invoke(method: string, ...args: unknown[]): Promise<unknown>;
      on(channel: string, cb: (payload: unknown) => void): () => void;
    };
    hueEnv: { platform: string; versions: { electron: string } };
  }
}

export {};
