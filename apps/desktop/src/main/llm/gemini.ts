import { fetchJson, LlmError, toolSchema, type CompletionRequest, type CompletionResult, type ModelInfo, type ProviderAdapter, type ToolCall } from './types.ts';

interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

const base = () => process.env.HUE_PILOT_GEMINI_BASE ?? 'https://generativelanguage.googleapis.com/v1beta';

export class GeminiAdapter implements ProviderAdapter {
  readonly id = 'gemini' as const;

  private headers(apiKey: string) {
    if (!apiKey) throw new LlmError('gemini', 'No Gemini API key configured. Add one in Settings (aistudio.google.com/apikey).');
    return { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey };
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const contents: GeminiContent[] = [];
    for (const m of req.messages) {
      if (m.role === 'user') contents.push({ role: 'user', parts: [{ text: m.text }] });
      else if (m.role === 'assistant') {
        if (m.raw?.provider === 'gemini' && Array.isArray(m.raw.payload)) contents.push({ role: 'model', parts: m.raw.payload as GeminiPart[] });
        else {
          const parts: GeminiPart[] = [];
          if (m.text) parts.push({ text: m.text });
          for (const c of m.toolCalls) parts.push({ functionCall: { name: c.name, args: c.args } });
          if (parts.length) contents.push({ role: 'model', parts });
        }
      } else {
        contents.push({ role: 'user', parts: m.results.map((r) => ({ functionResponse: { name: r.name, response: r.result as unknown as Record<string, unknown> } })) });
      }
    }
    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents,
      tools: [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parameters: toolSchema(t) })) }],
      toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
      generationConfig: { temperature: 0.2 },
    };
    const res = await fetchJson(`${base()}/models/${encodeURIComponent(req.model)}:generateContent`, { method: 'POST', headers: this.headers(req.apiKey), body: JSON.stringify(body) }, 'gemini', 'Gemini');
    const candidate = res?.candidates?.[0];
    if (!candidate?.content) {
      const reason = res?.promptFeedback?.blockReason ?? candidate?.finishReason ?? 'no response';
      throw new LlmError('gemini', `Gemini returned no answer (${reason}).`);
    }
    const parts: GeminiPart[] = candidate.content.parts ?? [];
    const toolCalls: ToolCall[] = parts
      .filter((p) => p.functionCall)
      .map((p, i) => ({ id: p.functionCall!.id ?? `call_${Date.now()}_${i}`, name: p.functionCall!.name, args: p.functionCall!.args ?? {} }));
    const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim();
    return {
      text,
      toolCalls,
      raw: { provider: 'gemini', payload: parts },
      note: candidate.finishReason === 'MAX_TOKENS' ? 'The reply was cut short by the model output limit.' : undefined,
    };
  }

  async listModels(apiKey: string): Promise<ModelInfo[]> {
    const res = await fetchJson(`${base()}/models?pageSize=200`, { headers: this.headers(apiKey) }, 'gemini', 'Gemini');
    const skip = /embedding|imagen|veo|tts|audio|image-generation|aqa|learnlm|live|native-audio|computer-use/i;
    return ((res?.models ?? []) as { name: string; displayName?: string; supportedGenerationMethods?: string[] }[])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .filter((m) => /gemini/i.test(m.name) && !skip.test(m.name))
      .map((m) => ({ name: m.name.replace(/^models\//, ''), displayName: m.displayName ?? m.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
