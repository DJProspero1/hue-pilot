import { randomUUID } from 'node:crypto';
import type { ToolDefinition, ToolResult } from '@hue/core';
import type { ChatMessage } from '../shared/ipc-types.ts';

/** Overridable for tests (a fake Gemini endpoint). */
const API_BASE = process.env.HUE_PILOT_GEMINI_BASE ?? 'https://generativelanguage.googleapis.com/v1beta';
const MAX_TOOL_ROUNDS = 8;

export interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

export interface GeminiChatOptions {
  getApiKey(): string;
  getModel(): string;
  getSystemPrompt(): Promise<string>;
  tools: ToolDefinition[];
  execute(name: string, args: Record<string, unknown>): Promise<ToolResult>;
}

export class GeminiError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'GeminiError';
    this.status = status;
  }
}

function msg(role: ChatMessage['role'], text: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id: randomUUID(), role, text, at: Date.now(), ...extra };
}

async function geminiFetch(path: string, apiKey: string, init: RequestInit = {}): Promise<unknown> {
  if (!apiKey) throw new GeminiError('No Gemini API key configured. Add one in Settings (aistudio.google.com/apikey).');
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: any = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    const message = body?.error?.message ?? text ?? `HTTP ${res.status}`;
    throw new GeminiError(`Gemini ${res.status}: ${message}`, res.status);
  }
  return body;
}

export async function listGeminiModels(apiKey: string): Promise<{ name: string; displayName: string }[]> {
  const body = (await geminiFetch('/models?pageSize=200', apiKey)) as { models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[] };
  const skip = /embedding|imagen|veo|tts|audio|image-generation|aqa|learnlm|live|native-audio|computer-use/i;
  return (body.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .filter((m) => /gemini/i.test(m.name) && !skip.test(m.name))
    .map((m) => ({ name: m.name.replace(/^models\//, ''), displayName: m.displayName ?? m.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Multi-turn chat with Gemini function calling. Keeps the raw Gemini contents so thought signatures round-trip. */
export class GeminiChat {
  contents: GeminiContent[] = [];
  transcript: ChatMessage[] = [];
  private busy = false;
  private readonly opts: GeminiChatOptions;

  constructor(opts: GeminiChatOptions) {
    this.opts = opts;
  }

  reset() {
    this.contents = [];
    this.transcript = [];
  }

  private functionDeclarations() {
    return this.opts.tools.map((t) => {
      const decl: Record<string, unknown> = { name: t.name, description: t.description };
      if (t.parameters.properties && Object.keys(t.parameters.properties).length) decl.parameters = t.parameters;
      return decl;
    });
  }

  async send(userText: string, onEvent?: (m: ChatMessage) => void): Promise<ChatMessage[]> {
    if (this.busy) throw new GeminiError('The assistant is still working on the previous request.');
    this.busy = true;
    const produced: ChatMessage[] = [];
    const push = (m: ChatMessage) => {
      produced.push(m);
      this.transcript.push(m);
      onEvent?.(m);
    };
    try {
      const userMsg = msg('user', userText);
      this.transcript.push(userMsg);
      onEvent?.(userMsg);
      this.contents.push({ role: 'user', parts: [{ text: userText }] });
      const system = await this.opts.getSystemPrompt();
      const model = this.opts.getModel() || 'gemini-2.5-flash';

      for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
        const body = {
          systemInstruction: { parts: [{ text: system }] },
          contents: this.contents,
          tools: [{ functionDeclarations: this.functionDeclarations() }],
          toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
          generationConfig: { temperature: 0.2 },
        };
        const res = (await geminiFetch(`/models/${encodeURIComponent(model)}:generateContent`, this.opts.getApiKey(), {
          method: 'POST',
          body: JSON.stringify(body),
        })) as { candidates?: { content?: GeminiContent; finishReason?: string }[]; promptFeedback?: { blockReason?: string } };

        const candidate = res.candidates?.[0];
        if (!candidate?.content) {
          const reason = res.promptFeedback?.blockReason ?? candidate?.finishReason ?? 'no response';
          throw new GeminiError(`Gemini returned no answer (${reason}).`);
        }
        const parts = candidate.content.parts ?? [];
        this.contents.push({ role: 'model', parts });

        const calls = parts.filter((p) => p.functionCall);
        const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim();
        if (!calls.length) {
          push(msg('assistant', text || '(no reply)'));
          return produced;
        }
        if (text) push(msg('assistant', text));

        const responses: GeminiPart[] = [];
        for (const part of calls) {
          const name = part.functionCall!.name;
          const args = part.functionCall!.args ?? {};
          let result: ToolResult;
          try {
            result = await this.opts.execute(name, args);
          } catch (err) {
            result = { ok: false, error: 'exception', message: (err as Error).message };
          }
          push(msg('tool', result.message ?? (result.ok ? 'Done' : 'Failed'), { tool: { name, args, result } }));
          responses.push({ functionResponse: { name, response: result as unknown as Record<string, unknown> } });
        }
        this.contents.push({ role: 'user', parts: responses });
      }
      push(msg('assistant', 'I stopped after too many steps. Please try a simpler request.'));
      return produced;
    } catch (err) {
      const e = msg('error', (err as Error).message);
      push(e);
      // Drop the failed exchange so the next turn starts clean.
      while (this.contents.length && this.contents[this.contents.length - 1].role === 'model') this.contents.pop();
      if (this.contents.length && this.contents[this.contents.length - 1].role === 'user') {
        const last = this.contents[this.contents.length - 1];
        if (last.parts.some((p) => p.functionResponse)) this.contents.pop();
      }
      return produced;
    } finally {
      this.busy = false;
    }
  }
}
