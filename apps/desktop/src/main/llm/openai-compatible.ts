import { fetchJson, LlmError, safeJsonParse, toolSchema, type CompletionRequest, type CompletionResult, type ModelInfo, type ProviderAdapter, type ProviderId, type ToolCall } from './types.ts';

interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

type OpenAiMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAiToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface OpenAiCompatibleSpec {
  id: ProviderId;
  label: string;
  baseUrl: string;
  /** Environment variable that overrides the base URL (tests). */
  baseEnv: string;
  extraHeaders?: Record<string, string>;
  noKeyMessage: string;
  filterModels(entry: { id: string; name?: string; supported_parameters?: string[] }): boolean;
}

/** Chat Completions protocol shared by OpenAI, DeepSeek and OpenRouter. */
export class OpenAiCompatibleAdapter implements ProviderAdapter {
  readonly id: ProviderId;
  private readonly spec: OpenAiCompatibleSpec;

  constructor(spec: OpenAiCompatibleSpec) {
    this.spec = spec;
    this.id = spec.id;
  }

  private base() {
    return process.env[this.spec.baseEnv] ?? this.spec.baseUrl;
  }

  private headers(apiKey: string) {
    if (!apiKey) throw new LlmError(this.id, this.spec.noKeyMessage);
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, ...(this.spec.extraHeaders ?? {}) };
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const messages: OpenAiMessage[] = [{ role: 'system', content: req.system }];
    for (const m of req.messages) {
      if (m.role === 'user') messages.push({ role: 'user', content: m.text });
      else if (m.role === 'assistant') {
        const entry: OpenAiMessage = { role: 'assistant', content: m.text || null };
        if (m.toolCalls.length) entry.tool_calls = m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } }));
        messages.push(entry);
      } else {
        for (const r of m.results) messages.push({ role: 'tool', tool_call_id: r.id, content: JSON.stringify(r.result) });
      }
    }
    const body = {
      model: req.model,
      messages,
      tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: toolSchema(t) } })),
      tool_choice: 'auto',
    };
    const res = await fetchJson(`${this.base()}/chat/completions`, { method: 'POST', headers: this.headers(req.apiKey), body: JSON.stringify(body) }, this.id, this.spec.label);
    const choice = res?.choices?.[0];
    if (!choice?.message) throw new LlmError(this.id, `${this.spec.label} returned no answer.`);
    const msg = choice.message as { content?: string | null; tool_calls?: OpenAiToolCall[] };
    const toolCalls: ToolCall[] = (msg.tool_calls ?? [])
      .filter((c) => c?.function?.name)
      .map((c, i) => ({ id: c.id ?? `call_${Date.now()}_${i}`, name: c.function.name, args: safeJsonParse(c.function.arguments) }));
    return {
      text: (msg.content ?? '').trim(),
      toolCalls,
      note: choice.finish_reason === 'length' ? 'The reply was cut short by the model output limit.' : undefined,
    };
  }

  async listModels(apiKey: string): Promise<ModelInfo[]> {
    const res = await fetchJson(`${this.base()}/models`, { headers: this.headers(apiKey) }, this.id, this.spec.label);
    const data = (res?.data ?? []) as { id: string; name?: string; supported_parameters?: string[] }[];
    return data
      .filter((m) => m?.id && this.spec.filterModels(m))
      .map((m) => ({ name: m.id, displayName: m.name && m.name !== m.id ? m.name : m.id }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 400);
  }
}

const OPENAI_SKIP = /audio|realtime|tts|transcribe|embedding|image|search|instruct|moderation|codex|davinci|babbage/i;

export const openAiAdapter = new OpenAiCompatibleAdapter({
  id: 'openai',
  label: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  baseEnv: 'HUE_PILOT_OPENAI_BASE',
  noKeyMessage: 'No OpenAI API key configured. Add one in Settings (platform.openai.com/api-keys).',
  filterModels: (m) => /^(gpt-|o[1-9]|chatgpt-)/.test(m.id) && !OPENAI_SKIP.test(m.id),
});

export const deepSeekAdapter = new OpenAiCompatibleAdapter({
  id: 'deepseek',
  label: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com/v1',
  baseEnv: 'HUE_PILOT_DEEPSEEK_BASE',
  noKeyMessage: 'No DeepSeek API key configured. Add one in Settings (platform.deepseek.com/api_keys).',
  filterModels: () => true,
});

export const openRouterAdapter = new OpenAiCompatibleAdapter({
  id: 'openrouter',
  label: 'OpenRouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  baseEnv: 'HUE_PILOT_OPENROUTER_BASE',
  extraHeaders: { 'HTTP-Referer': 'https://hue-pilot.local', 'X-Title': 'Hue Pilot' },
  noKeyMessage: 'No OpenRouter API key configured. Add one in Settings (openrouter.ai/keys).',
  filterModels: (m) => !m.supported_parameters || m.supported_parameters.includes('tools'),
});
