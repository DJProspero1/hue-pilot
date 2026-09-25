/**
 * Exercises the provider-neutral assistant loop against fake Gemini, OpenAI-compatible and Anthropic
 * endpoints plus the mock bridge. Base URLs are overridden through HUE_PILOT_*_BASE before import.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const SET_ROOM_ARGS = { room: 'the office', on: true, brightness: 60, color: 'warm white' };

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function serve(handler) {
  const server = http.createServer(async (req, res) => {
    try {
      const body = req.method === 'POST' ? await readJson(req) : {};
      const out = await handler(req, body);
      res.writeHead(out.status ?? 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out.body));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: String(err?.message ?? err) } }));
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

// ---- fake Gemini -----------------------------------------------------------
const gemini = await serve((req, body) => {
  if (req.headers['x-goog-api-key'] !== 'gem-key') return { status: 400, body: { error: { message: 'API key not valid. Please pass a valid API key.' } } };
  if (req.url.startsWith('/models?')) {
    return { body: { models: [{ name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] }] } };
  }
  const contents = body.contents ?? [];
  const last = contents[contents.length - 1];
  assert.ok(body.tools?.[0]?.functionDeclarations?.some((t) => t.name === 'set_room'));
  if (!last.parts.some((p) => p.functionResponse)) {
    return { body: { candidates: [{ content: { role: 'model', parts: [{ text: 'On it.', thoughtSignature: 'sig-1' }, { functionCall: { name: 'set_room', args: SET_ROOM_ARGS } }] } }] } };
  }
  const modelTurn = contents[contents.length - 2];
  assert.ok(modelTurn.parts.some((p) => p.thoughtSignature === 'sig-1'), 'thought signature echoed');
  const fr = last.parts[0].functionResponse.response;
  return { body: { candidates: [{ content: { role: 'model', parts: [{ text: `Done: ${fr.message}` }] } }] } };
});

// ---- fake OpenAI-compatible (used for openai, deepseek, openrouter) ------------
const openaiCalls = [];
const openai = await serve((req, body) => {
  const auth = req.headers.authorization ?? '';
  if (auth !== 'Bearer oa-key') return { status: 401, body: { error: { message: 'Incorrect API key provided' } } };
  if (req.url.startsWith('/models')) {
    return {
      body: {
        data: [
          { id: 'gpt-5-mini' },
          { id: 'gpt-5' },
          { id: 'gpt-4o-audio-preview' },
          { id: 'text-embedding-3-small' },
          { id: 'deepseek-chat' },
          { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', supported_parameters: ['tools', 'temperature'] },
          { id: 'some/no-tools-model', name: 'No tools', supported_parameters: ['temperature'] },
        ],
      },
    };
  }
  openaiCalls.push({ headers: req.headers, body });
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.tool_choice, 'auto');
  assert.equal(body.temperature, undefined, 'no temperature sent');
  assert.ok(body.tools.some((t) => t.type === 'function' && t.function.name === 'set_room'));
  const last = body.messages[body.messages.length - 1];
  if (last.role !== 'tool') {
    return { body: { choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 'call_abc', type: 'function', function: { name: 'set_room', arguments: JSON.stringify(SET_ROOM_ARGS) } }] } }] } };
  }
  assert.equal(last.tool_call_id, 'call_abc');
  const prev = body.messages[body.messages.length - 2];
  assert.equal(prev.role, 'assistant');
  assert.equal(prev.tool_calls[0].id, 'call_abc');
  const result = JSON.parse(last.content);
  return { body: { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: `Done: ${result.message}` } }] } };
});

// ---- fake Anthropic ------------------------------------------------------------
const anthropicCalls = [];
const ANTHROPIC_FIRST_CONTENT = [
  { type: 'thinking', thinking: '', signature: 'th-sig' },
  { type: 'text', text: 'Sure.' },
  { type: 'tool_use', id: 'toolu_01', name: 'set_room', input: SET_ROOM_ARGS },
];
const anthropic = await serve((req, body) => {
  if (req.headers['x-api-key'] !== 'ant-key') return { status: 401, body: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } };
  assert.ok(req.headers['anthropic-version'], 'anthropic-version header present');
  if (req.url.startsWith('/v1/models')) {
    return { body: { data: [{ id: 'claude-opus-5', display_name: 'Claude Opus 5', type: 'model' }, { id: 'claude-haiku-4-5', display_name: 'Claude Haiku 4.5', type: 'model' }], has_more: false, first_id: 'claude-opus-5', last_id: 'claude-haiku-4-5' } };
  }
  anthropicCalls.push(body);
  assert.equal(body.model, 'claude-opus-5');
  assert.equal(body.max_tokens, 16000);
  assert.deepEqual(body.output_config, { effort: 'low' });
  assert.ok(typeof body.system === 'string' && body.system.includes('Office'));
  assert.ok(body.tools.some((t) => t.name === 'set_room' && t.input_schema.type === 'object'));
  assert.equal(body.temperature, undefined);
  const last = body.messages[body.messages.length - 1];
  const hasToolResult = Array.isArray(last.content) && last.content.some((b) => b.type === 'tool_result');
  const base = { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } };
  if (!hasToolResult) {
    return { body: { ...base, content: ANTHROPIC_FIRST_CONTENT, stop_reason: 'tool_use' } };
  }
  const prev = body.messages[body.messages.length - 2];
  assert.equal(prev.role, 'assistant');
  assert.deepEqual(prev.content, ANTHROPIC_FIRST_CONTENT, 'assistant content (incl. thinking) echoed back unchanged');
  assert.equal(last.role, 'user');
  assert.equal(last.content.length, 1, 'all tool results in a single user message');
  assert.equal(last.content[0].tool_use_id, 'toolu_01');
  assert.equal(last.content[0].is_error, undefined);
  const result = JSON.parse(last.content[0].content);
  return { body: { ...base, content: [{ type: 'text', text: `Done: ${result.message}` }], stop_reason: 'end_turn' } };
});

process.env.HUE_PILOT_GEMINI_BASE = gemini.base;
process.env.HUE_PILOT_OPENAI_BASE = openai.base;
process.env.HUE_PILOT_DEEPSEEK_BASE = openai.base;
process.env.HUE_PILOT_OPENROUTER_BASE = openai.base;
process.env.HUE_PILOT_ANTHROPIC_BASE = anthropic.base;

const { AssistantChat, listModels } = await import('../src/main/llm/chat.ts');
const { createMockBridge } = await import('../../../packages/hue-mock-bridge/src/server.mjs');
const { HueClient } = await import('../../../packages/hue-core/src/client.ts');
const { buildHome } = await import('../../../packages/hue-core/src/model.ts');
const { executeTool, TOOL_DEFINITIONS, buildSystemPrompt } = await import('../../../packages/hue-core/src/tools.ts');

const bridge = createMockBridge({ port: 0, host: '127.0.0.1', log: false, simulate: false });
const { port } = await bridge.start();
const client = new HueClient({ host: '127.0.0.1', port, protocol: 'http', appKey: 'k' });
const getHome = async () => buildHome(await client.getAll());
const ctx = { client, getHome, appKey: 'k', defaultTransitionMs: 0 };

const KEYS = { gemini: 'gem-key', openai: 'oa-key', deepseek: 'oa-key', openrouter: 'oa-key', anthropic: 'ant-key' };
const MODELS = { gemini: 'gemini-2.5-flash', openai: 'gpt-5-mini', deepseek: 'deepseek-chat', openrouter: 'openai/gpt-5-mini', anthropic: 'claude-opus-5' };

function makeChat(state) {
  return new AssistantChat({
    getProvider: () => state.provider,
    getProviderConfig: (p) => ({ apiKey: state.keys?.[p] ?? KEYS[p], model: MODELS[p] }),
    getSystemPrompt: async () => buildSystemPrompt(await getHome()),
    tools: TOOL_DEFINITIONS,
    execute: (name, args) => executeTool(name, args, ctx),
  });
}

test.after(async () => {
  gemini.server.close();
  openai.server.close();
  anthropic.server.close();
  await bridge.stop();
});

for (const provider of ['gemini', 'openai', 'deepseek', 'openrouter', 'anthropic']) {
  test(`${provider}: tool-calling loop turns the office on and reports back`, async () => {
    await client.setGroupedLight((await getHome()).rooms.find((r) => r.name === 'Office').groupedLightId, { on: false });
    const chat = makeChat({ provider });
    const events = [];
    const produced = await chat.send('Please turn the lights in my office on', (m) => events.push(m.role));
    assert.deepEqual(events.slice(0, 1), ['user']);
    const tool = produced.find((m) => m.role === 'tool');
    assert.ok(tool, `tool message produced for ${provider}`);
    assert.equal(tool.tool.name, 'set_room');
    assert.equal(tool.tool.result.ok, true, tool.text);
    assert.match(tool.text, /Office: on, 60%, warm white/);
    assert.match(produced[produced.length - 1].text, /^Done: Office/);
    const office = (await getHome()).rooms.find((r) => r.name === 'Office');
    assert.equal(office.anyOn, true);
    assert.equal(office.brightness, 60);
    assert.equal(chat.history.length, 4, 'user, assistant(call), tool, assistant(text)');
  });
}

test('openrouter: sends the referer headers', () => {
  const call = openaiCalls.find((c) => c.headers['x-title'] === 'Hue Pilot');
  assert.ok(call, 'OpenRouter identification headers sent');
  assert.equal(call.headers['http-referer'], 'https://hue-pilot.local');
});

test('switching provider mid-conversation starts a fresh history', async () => {
  const state = { provider: 'openai' };
  const chat = makeChat(state);
  await chat.send('turn on the office');
  assert.equal(chat.history.length, 4);
  state.provider = 'anthropic';
  const produced = await chat.send('turn on the office');
  assert.equal(produced[0].role, 'system');
  assert.match(produced[0].text, /Now using Anthropic Claude · claude-opus-5/);
  assert.equal(chat.history.length, 4, 'history reset before the new provider turn');
  assert.equal(chat.history[1].raw.provider, 'anthropic');
});

test('invalid keys surface as errors and leave the history clean', async () => {
  for (const provider of ['openai', 'anthropic', 'gemini']) {
    const chat = makeChat({ provider, keys: { [provider]: 'wrong' } });
    const produced = await chat.send('hello');
    assert.equal(produced[produced.length - 1].role, 'error', provider);
    assert.match(produced[produced.length - 1].text, /key|401|400/i);
    assert.equal(chat.history.length, 0, `${provider} history rolled back`);
  }
  const chat = makeChat({ provider: 'deepseek', keys: { deepseek: '' } });
  const produced = await chat.send('hello');
  assert.match(produced[produced.length - 1].text, /No DeepSeek API key/);
});

test('model listing per provider', async () => {
  assert.deepEqual((await listModels('gemini', 'gem-key')).map((m) => m.name), ['gemini-2.5-flash']);
  assert.deepEqual((await listModels('openai', 'oa-key')).map((m) => m.name), ['gpt-5', 'gpt-5-mini']);
  assert.ok((await listModels('deepseek', 'oa-key')).some((m) => m.name === 'deepseek-chat'));
  const or = await listModels('openrouter', 'oa-key');
  assert.ok(or.some((m) => m.name === 'anthropic/claude-sonnet-4.5' && m.displayName === 'Claude Sonnet 4.5'));
  assert.ok(!or.some((m) => m.name === 'some/no-tools-model'), 'models without tool support filtered out');
  assert.deepEqual((await listModels('anthropic', 'ant-key')).map((m) => m.name), ['claude-haiku-4-5', 'claude-opus-5']);
  await assert.rejects(() => listModels('anthropic', 'wrong'), /401/);
});
