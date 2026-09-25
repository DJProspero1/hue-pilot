import { randomUUID } from 'node:crypto';
import type { ToolDefinition, ToolResult } from '@hue/core';
import type { ChatMessage } from '../../shared/ipc-types.ts';
import { providerMeta, type ModelInfo, type ProviderId } from '../../shared/providers.ts';
import { AnthropicAdapter } from './anthropic.ts';
import { GeminiAdapter } from './gemini.ts';
import { deepSeekAdapter, openAiAdapter, openRouterAdapter } from './openai-compatible.ts';
import { LlmError, type NeutralMessage, type ProviderAdapter, type ToolResultMessage } from './types.ts';

const ADAPTERS: Record<ProviderId, ProviderAdapter> = {
  gemini: new GeminiAdapter(),
  openai: openAiAdapter,
  anthropic: new AnthropicAdapter(),
  deepseek: deepSeekAdapter,
  openrouter: openRouterAdapter,
};

export function adapterFor(provider: ProviderId): ProviderAdapter {
  const a = ADAPTERS[provider];
  if (!a) throw new LlmError('gemini', `Unknown assistant provider "${provider}"`);
  return a;
}

export function listModels(provider: ProviderId, apiKey: string): Promise<ModelInfo[]> {
  return adapterFor(provider).listModels(apiKey);
}

export interface AssistantChatOptions {
  getProvider(): ProviderId;
  getProviderConfig(provider: ProviderId): { apiKey: string; model: string };
  getSystemPrompt(): Promise<string>;
  tools: ToolDefinition[];
  execute(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  maxRounds?: number;
}

function msg(role: ChatMessage['role'], text: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id: randomUUID(), role, text, at: Date.now(), ...extra };
}

/** Provider-agnostic multi-turn chat with tool calling. The neutral history is re-encoded per provider on every turn. */
export class AssistantChat {
  history: NeutralMessage[] = [];
  transcript: ChatMessage[] = [];
  private busy = false;
  private bound: { provider: ProviderId; model: string } | null = null;
  private readonly opts: AssistantChatOptions;

  constructor(opts: AssistantChatOptions) {
    this.opts = opts;
  }

  reset() {
    this.history = [];
    this.transcript = [];
    this.bound = null;
  }

  get current(): { provider: ProviderId; model: string } {
    const provider = this.opts.getProvider();
    const cfg = this.opts.getProviderConfig(provider);
    return { provider, model: cfg.model || providerMeta(provider).defaultModel };
  }

  async send(userText: string, onEvent?: (m: ChatMessage) => void): Promise<ChatMessage[]> {
    if (this.busy) throw new LlmError(this.opts.getProvider(), 'The assistant is still working on the previous request.');
    this.busy = true;
    const produced: ChatMessage[] = [];
    const push = (m: ChatMessage) => {
      produced.push(m);
      this.transcript.push(m);
      onEvent?.(m);
    };
    try {
      const provider = this.opts.getProvider();
      const cfg = this.opts.getProviderConfig(provider);
      const model = cfg.model || providerMeta(provider).defaultModel;
      if (this.bound && (this.bound.provider !== provider || this.bound.model !== model)) {
        this.history = [];
        push(msg('system', `Now using ${providerMeta(provider).label} · ${model}. Starting a new conversation.`));
      }
      this.bound = { provider, model };
      const adapter = adapterFor(provider);

      push(msg('user', userText));
      const checkpoint = this.history.length;
      this.history.push({ role: 'user', text: userText });

      try {
        const system = await this.opts.getSystemPrompt();
        const maxRounds = this.opts.maxRounds ?? 8;
        for (let round = 0; round <= maxRounds; round++) {
          const res = await adapter.complete({ apiKey: cfg.apiKey, model, system, messages: this.history, tools: this.opts.tools });
          this.history.push({ role: 'assistant', text: res.text, toolCalls: res.toolCalls, raw: res.raw });
          if (!res.toolCalls.length) {
            push(msg('assistant', (res.text || '(no reply)') + (res.note ? `\n\n_${res.note}_` : '')));
            return produced;
          }
          if (res.text) push(msg('assistant', res.text));
          const results: ToolResultMessage[] = [];
          for (const call of res.toolCalls) {
            let result: ToolResult;
            try {
              result = await this.opts.execute(call.name, call.args);
            } catch (err) {
              result = { ok: false, error: 'exception', message: (err as Error).message };
            }
            push(msg('tool', result.message ?? (result.ok ? 'Done' : 'Failed'), { tool: { name: call.name, args: call.args, result } }));
            results.push({ id: call.id, name: call.name, result });
          }
          this.history.push({ role: 'tool', results });
        }
        push(msg('assistant', 'I stopped after too many steps. Please try a simpler request.'));
        return produced;
      } catch (err) {
        push(msg('error', (err as Error).message ?? String(err)));
        // Drop the failed exchange so the next turn starts from a consistent history.
        this.history.splice(checkpoint);
        return produced;
      }
    } finally {
      this.busy = false;
    }
  }
}
