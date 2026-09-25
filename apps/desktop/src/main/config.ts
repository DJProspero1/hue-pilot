import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { BridgeConnection } from '@hue/core';
import { DEFAULT_SETTINGS, type Settings } from '../shared/ipc-types.ts';

interface ConfigFile {
  bridge: BridgeConnection | null;
  settings: Settings;
}

export function configDir(): string {
  if (process.env.HUE_PILOT_CONFIG_DIR) return process.env.HUE_PILOT_CONFIG_DIR;
  return path.join(app.getPath('appData'), 'hue-pilot');
}

export class ConfigStore {
  readonly file: string;
  private data: ConfigFile;

  constructor() {
    this.file = path.join(configDir(), 'config.json');
    this.data = { bridge: null, settings: { ...DEFAULT_SETTINGS } };
    this.load();
    if (!this.data.settings.httpApiToken) {
      this.data.settings.httpApiToken = randomBytes(16).toString('hex');
      this.save();
    }
  }

  private load() {
    try {
      if (!fs.existsSync(this.file)) return;
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as Partial<ConfigFile>;
      this.data = {
        bridge: parsed.bridge ?? null,
        settings: { ...DEFAULT_SETTINGS, ...(parsed.settings ?? {}) },
      };
    } catch (err) {
      console.error('config: failed to load', err);
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  get bridge(): BridgeConnection | null {
    return this.data.bridge;
  }

  setBridge(bridge: BridgeConnection | null) {
    this.data.bridge = bridge;
    this.save();
  }

  get settings(): Settings {
    return this.data.settings;
  }

  updateSettings(patch: Partial<Settings>): Settings {
    this.data.settings = { ...this.data.settings, ...patch };
    this.save();
    return this.data.settings;
  }
}
