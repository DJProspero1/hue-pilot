import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { BridgeConnection } from '@hue/core';
import { DEFAULT_SETTINGS, type Settings } from '../shared/ipc-types.ts';
import { DEFAULT_PROVIDER_SETTINGS, isProviderId, PROVIDER_IDS, type ProviderId, type ProviderSettings } from '../shared/providers.ts';

interface ConfigFile {
  bridge: BridgeConnection | null;
  settings: Settings;
}

export function configDir(): string {
  if (process.env.HUE_PILOT_CONFIG_DIR) return process.env.HUE_PILOT_CONFIG_DIR;
  return path.join(app.getPath('appData'), 'hue-pilot');
}

/** Normalise settings from disk: fill defaults, merge per-provider settings, migrate the old single Gemini key. */
export function normalizeSettings(raw: Partial<Settings> & { geminiApiKey?: string; geminiModel?: string }): Settings {
  const providers = {} as Record<ProviderId, ProviderSettings>;
  for (const id of PROVIDER_IDS) {
    const stored = (raw.providers as Partial<Record<ProviderId, Partial<ProviderSettings>>> | undefined)?.[id] ?? {};
    providers[id] = {
      apiKey: typeof stored.apiKey === 'string' ? stored.apiKey : DEFAULT_PROVIDER_SETTINGS[id].apiKey,
      model: typeof stored.model === 'string' && stored.model.trim() ? stored.model : DEFAULT_PROVIDER_SETTINGS[id].model,
    };
  }
  if (raw.geminiApiKey && !providers.gemini.apiKey) providers.gemini.apiKey = raw.geminiApiKey;
  if (raw.geminiModel && !(raw.providers as Record<string, ProviderSettings> | undefined)?.gemini?.model) providers.gemini.model = raw.geminiModel;
  const { geminiApiKey: _k, geminiModel: _m, ...rest } = raw;
  return {
    ...DEFAULT_SETTINGS,
    ...rest,
    providers,
    assistantProvider: isProviderId(raw.assistantProvider) ? raw.assistantProvider : DEFAULT_SETTINGS.assistantProvider,
  };
}

export class ConfigStore {
  readonly file: string;
  private data: ConfigFile;

  constructor() {
    this.file = path.join(configDir(), 'config.json');
    this.data = { bridge: null, settings: normalizeSettings({}) };
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
        settings: normalizeSettings(parsed.settings ?? {}),
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
    const merged: Partial<Settings> = { ...this.data.settings, ...patch };
    if (patch.providers) {
      merged.providers = { ...this.data.settings.providers };
      for (const id of PROVIDER_IDS) if (patch.providers[id]) merged.providers[id] = { ...this.data.settings.providers[id], ...patch.providers[id] };
    }
    this.data.settings = normalizeSettings(merged);
    this.save();
    return this.data.settings;
  }

  updateProvider(provider: ProviderId, patch: Partial<ProviderSettings>): Settings {
    if (!isProviderId(provider)) throw new Error(`Unknown provider ${provider}`);
    return this.updateSettings({ providers: { ...this.data.settings.providers, [provider]: { ...this.data.settings.providers[provider], ...patch } } });
  }
}
