import type { JsonSchema, ToolDefinition, ToolResult } from '@hue/core';
import type { ModelInfo, ProviderId } from '../../shared/providers.ts';

export type { ModelInfo, ProviderId };

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResultMessage {
  id: string;
  name: string;
  result: ToolResult;
}

/** Provider-specific payload echoed back verbatim on later turns (Gemini thought signatures, Claude content blocks). */
export interface RawEcho {
  provider: ProviderId;
  payload: unknown;
}

export type NeutralMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; toolCalls: ToolCall[]; raw?: RawEcho }
  | { role: 'tool'; results: ToolResultMessage[] };

export interface CompletionRequest {
  apiKey: string;
  model: string;
  system: string;
  messages: NeutralMessage[];
  tools: ToolDefinition[];
}

export interface CompletionResult {
  text: string;
  toolCalls: ToolCall[];
  raw?: RawEcho;
  /** Extra note to show the user (e.g. output truncated). */
  note?: string;
}

export interface ProviderAdapter {
  readonly id: ProviderId;
  complete(req: CompletionRequest): Promise<CompletionResult>;
  listModels(apiKey: string): Promise<ModelInfo[]>;
}

export class LlmError extends Error {
  readonly provider: ProviderId;
  readonly status?: number;
  constructor(provider: ProviderId, message: string, status?: number) {
    super(message);
    this.name = 'LlmError';
    this.provider = provider;
    this.status = status;
  }
}

/** Tool schemas with no properties are sent as an empty object schema (every provider accepts that). */
export function toolSchema(def: ToolDefinition): JsonSchema {
  const props = def.parameters.properties ?? {};
  if (Object.keys(props).length === 0) return { type: 'object', properties: {} };
  return def.parameters;
}

/** True for tool results that represent a real failure (as opposed to "not found"/"ambiguous" answers). */
export function isHardFailure(result: ToolResult): boolean {
  return !result.ok && (result.error === 'bridge_error' || result.error === 'exception');
}

export function safeJsonParse(text: string | undefined | null): Record<string, unknown> {
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function fetchJson(url: string, init: RequestInit, provider: ProviderId, label: string): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new LlmError(provider, `Could not reach ${label}: ${(err as Error).message}`);
  }
  const text = await res.text();
  let body: any = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    const message = body?.error?.message ?? body?.message ?? (text || `HTTP ${res.status}`);
    if (res.status === 401 || res.status === 403) throw new LlmError(provider, `${label} rejected the API key (${res.status}): ${message}`, res.status);
    throw new LlmError(provider, `${label} ${res.status}: ${message}`, res.status);
  }
  return body;
}
