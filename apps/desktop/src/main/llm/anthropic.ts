import Anthropic from '@anthropic-ai/sdk';
import { isHardFailure, LlmError, toolSchema, type CompletionRequest, type CompletionResult, type ModelInfo, type ProviderAdapter, type ToolCall } from './types.ts';

/** Models that accept `output_config.effort` (Opus 4.5+, Sonnet 4.6+, Fable, Mythos). Haiku and older reject it. */
const SUPPORTS_EFFORT = /claude-(opus-(4-[5678]|5)|sonnet-(4-6|5)|fable|mythos)/;

export class AnthropicAdapter implements ProviderAdapter {
  readonly id = 'anthropic' as const;

  private client(apiKey: string): Anthropic {
    if (!apiKey) throw new LlmError('anthropic', 'No Anthropic API key configured. Add one in Settings (console.anthropic.com/settings/keys).');
    return new Anthropic({ apiKey, baseURL: process.env.HUE_PILOT_ANTHROPIC_BASE, maxRetries: 1, timeout: 120_000 });
  }

  private translateError(err: unknown): LlmError {
    if (err instanceof Anthropic.AuthenticationError) return new LlmError('anthropic', 'Anthropic rejected the API key (401). Check it in Settings.', 401);
    if (err instanceof Anthropic.RateLimitError) return new LlmError('anthropic', 'Anthropic rate limit reached. Try again in a moment.', 429);
    if (err instanceof Anthropic.NotFoundError) return new LlmError('anthropic', `Anthropic could not find that model: ${err.message}`, 404);
    if (err instanceof Anthropic.APIError) return new LlmError('anthropic', `Anthropic ${err.status ?? ''}: ${err.message}`.trim(), err.status);
    if (err instanceof Anthropic.APIConnectionError) return new LlmError('anthropic', `Could not reach Anthropic: ${err.message}`);
    return err instanceof LlmError ? err : new LlmError('anthropic', (err as Error).message ?? String(err));
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const messages: Anthropic.MessageParam[] = [];
    for (const m of req.messages) {
      if (m.role === 'user') {
        messages.push({ role: 'user', content: [{ type: 'text', text: m.text }] });
      } else if (m.role === 'assistant') {
        if (m.raw?.provider === 'anthropic' && Array.isArray(m.raw.payload)) {
          messages.push({ role: 'assistant', content: m.raw.payload as Anthropic.ContentBlockParam[] });
        } else {
          const content: Anthropic.ContentBlockParam[] = [];
          if (m.text) content.push({ type: 'text', text: m.text });
          for (const c of m.toolCalls) content.push({ type: 'tool_use', id: c.id, name: c.name, input: c.args });
          if (content.length) messages.push({ role: 'assistant', content });
        }
      } else {
        // All tool results for one assistant turn go back in a single user message.
        const content: Anthropic.ToolResultBlockParam[] = m.results.map((r) => ({
          type: 'tool_result',
          tool_use_id: r.id,
          content: JSON.stringify(r.result),
          ...(isHardFailure(r.result) ? { is_error: true } : {}),
        }));
        messages.push({ role: 'user', content });
      }
    }
    const tools: Anthropic.Tool[] = req.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: toolSchema(t) as unknown as Anthropic.Tool.InputSchema,
    }));

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: req.model,
      max_tokens: 16000,
      system: req.system,
      messages,
      tools,
    };
    // Light control is a simple task: keep thinking short on models that support effort.
    if (SUPPORTS_EFFORT.test(req.model)) (params as unknown as Record<string, unknown>).output_config = { effort: 'low' };

    let res: Anthropic.Message;
    try {
      res = await this.client(req.apiKey).messages.create(params);
    } catch (err) {
      throw this.translateError(err);
    }

    const toolCalls: ToolCall[] = [];
    let text = '';
    for (const block of res.content) {
      if (block.type === 'text') text += block.text;
      else if (block.type === 'tool_use') toolCalls.push({ id: block.id, name: block.name, args: (block.input ?? {}) as Record<string, unknown> });
    }
    let note: string | undefined;
    if (res.stop_reason === 'refusal') {
      const explanation = (res as unknown as { stop_details?: { explanation?: string } }).stop_details?.explanation;
      text = text || `The model declined this request.${explanation ? ` ${explanation}` : ''}`;
      toolCalls.length = 0;
    } else if (res.stop_reason === 'max_tokens') {
      note = 'The reply was cut short by the model output limit.';
    }
    return { text: text.trim(), toolCalls, raw: { provider: 'anthropic', payload: res.content }, note };
  }

  async listModels(apiKey: string): Promise<ModelInfo[]> {
    const out: ModelInfo[] = [];
    try {
      for await (const m of this.client(apiKey).models.list({ limit: 100 })) {
        out.push({ name: m.id, displayName: m.display_name ?? m.id });
      }
    } catch (err) {
      throw this.translateError(err);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
}
