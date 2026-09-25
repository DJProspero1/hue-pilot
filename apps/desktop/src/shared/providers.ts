/** Assistant providers shared by the main process and the renderer (pure metadata). */

export type ProviderId = 'gemini' | 'openai' | 'anthropic' | 'deepseek' | 'openrouter';

export interface ProviderMeta {
  id: ProviderId;
  label: string;
  defaultModel: string;
  keyUrl: string;
  keyPlaceholder: string;
  modelHint: string;
}

export interface ProviderSettings {
  apiKey: string;
  model: string;
}

export interface ModelInfo {
  name: string;
  displayName: string;
}

export const PROVIDERS: ProviderMeta[] = [
  {
    id: 'gemini',
    label: 'Google Gemini',
    defaultModel: 'gemini-2.5-flash',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyPlaceholder: 'AIza…',
    modelHint: 'gemini-2.5-flash is fast and cheap.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    defaultModel: 'gpt-5-mini',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyPlaceholder: 'sk-…',
    modelHint: 'gpt-5-mini balances speed and cost; gpt-5 for the best quality.',
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude',
    defaultModel: 'claude-opus-5',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyPlaceholder: 'sk-ant-…',
    modelHint: 'claude-opus-5 by default; claude-sonnet-5 or claude-haiku-4-5 are cheaper.',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    defaultModel: 'deepseek-chat',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    keyPlaceholder: 'sk-…',
    modelHint: 'deepseek-chat supports tool calling.',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    defaultModel: 'google/gemini-2.5-flash',
    keyUrl: 'https://openrouter.ai/keys',
    keyPlaceholder: 'sk-or-…',
    modelHint: 'Any OpenRouter model that supports tools, e.g. anthropic/claude-sonnet-4.5 or openai/gpt-5-mini.',
  },
];

export const PROVIDER_IDS: ProviderId[] = PROVIDERS.map((p) => p.id);

export function providerMeta(id: ProviderId): ProviderMeta {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

export function isProviderId(v: unknown): v is ProviderId {
  return typeof v === 'string' && (PROVIDER_IDS as string[]).includes(v);
}

export const DEFAULT_PROVIDER_SETTINGS: Record<ProviderId, ProviderSettings> = Object.fromEntries(
  PROVIDERS.map((p) => [p.id, { apiKey: '', model: p.defaultModel }]),
) as Record<ProviderId, ProviderSettings>;
