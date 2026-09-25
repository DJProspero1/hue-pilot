/**
 * Exercises the Gemini function-calling loop against a fake Gemini endpoint and the mock bridge.
 * Run: HUE_PILOT_GEMINI_BASE is set below before importing the module.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const fake = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  const json = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  if (req.headers['x-goog-api-key'] !== 'test-key') return json(400, { error: { message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT' } });
  if (req.url.startsWith('/models?')) {
    return json(200, {
      models: [
        { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-embedding-001', displayName: 'Embedding', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/gemini-2.5-flash-preview-tts', displayName: 'TTS', supportedGenerationMethods: ['generateContent'] },
      ],
    });
  }
  const contents = body.contents ?? [];
  const last = contents[contents.length - 1];
  const tools = body.tools?.[0]?.functionDeclarations ?? [];
  assert.ok(tools.some((t) => t.name === 'set_room'), 'tool declarations are sent');
  assert.ok(body.systemInstruction?.parts?.[0]?.text?.includes('Office'), 'system prompt lists the home');
  const userText = contents.find((c) => c.role === 'user')?.parts?.[0]?.text ?? '';
  // Turn 1: model decides to call a tool (with a thought signature that must round-trip).
  if (!last.parts.some((p) => p.functionResponse)) {
    if (/fail/i.test(userText)) return json(200, { candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: 'set_room', args: { room: 'garage', on: true } } }] } }] });
    return json(200, {
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              { text: 'Sure, turning on the office.', thoughtSignature: 'sig-123' },
              { functionCall: { name: 'set_room', args: { room: 'the office', on: true, brightness: 60, color: 'warm white' } } },
            ],
          },
        },
      ],
    });
  }
  // Turn 2: after the function response, answer with text.
  const fr = last.parts.find((p) => p.functionResponse).functionResponse;
  const modelTurn = contents[contents.length - 2];
  assert.equal(modelTurn.role, 'model');
  if (fr.response.ok) {
    assert.ok(modelTurn.parts.some((p) => p.thoughtSignature === 'sig-123'), 'thought signature echoed back');
    return json(200, { candidates: [{ content: { role: 'model', parts: [{ text: `Done: ${fr.response.message}` }] } }] });
  }
  return json(200, { candidates: [{ content: { role: 'model', parts: [{ text: `I could not do that: ${fr.response.message}` }] } }] });
});

let base;
let bridge;
let GeminiChat;
let listGeminiModels;
let ctx;

test.before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${fake.address().port}`;
  process.env.HUE_PILOT_GEMINI_BASE = base;
  ({ GeminiChat, listGeminiModels } = await import('../src/main/gemini.ts'));
  const { createMockBridge } = await import('../../../packages/hue-mock-bridge/src/server.mjs');
  const { HueClient } = await import('../../../packages/hue-core/src/client.ts');
  const { buildHome } = await import('../../../packages/hue-core/src/model.ts');
  const { executeTool, TOOL_DEFINITIONS, buildSystemPrompt } = await import('../../../packages/hue-core/src/tools.ts');
  bridge = createMockBridge({ port: 0, host: '127.0.0.1', log: false, simulate: false });
  const { port } = await bridge.start();
  const client = new HueClient({ host: '127.0.0.1', port, protocol: 'http', appKey: 'k' });
  const getHome = async () => buildHome(await client.getAll());
  ctx = { client, getHome, appKey: 'k', defaultTransitionMs: 0, TOOL_DEFINITIONS, buildSystemPrompt, executeTool };
});

test.after(async () => {
  fake.close();
  await bridge.stop();
});

test('gemini: function-calling loop executes the tool and returns the final answer', async () => {
  const chat = new GeminiChat({
    getApiKey: () => 'test-key',
    getModel: () => 'gemini-2.5-flash',
    getSystemPrompt: async () => ctx.buildSystemPrompt(await ctx.getHome()),
    tools: ctx.TOOL_DEFINITIONS,
    execute: (name, args) => ctx.executeTool(name, args, ctx),
  });
  const events = [];
  const produced = await chat.send('Please turn the lights in my office on', (m) => events.push(m.role));
  assert.deepEqual(events, ['user', 'assistant', 'tool', 'assistant']);
  const tool = produced.find((m) => m.role === 'tool');
  assert.equal(tool.tool.name, 'set_room');
  assert.equal(tool.tool.result.ok, true);
  assert.match(tool.text, /Office: on, 60%, warm white/);
  assert.match(produced[produced.length - 1].text, /^Done: Office/);
  const home = await ctx.getHome();
  const office = home.rooms.find((r) => r.name === 'Office');
  assert.equal(office.anyOn, true);
  assert.equal(office.brightness, 60);
  assert.equal(chat.contents.length, 4, 'user, model(call), user(functionResponse), model(text)');
  assert.equal(chat.transcript.length, 4);
});

test('gemini: tool failures are reported back to the model', async () => {
  const chat = new GeminiChat({
    getApiKey: () => 'test-key',
    getModel: () => 'gemini-2.5-flash',
    getSystemPrompt: async () => ctx.buildSystemPrompt(await ctx.getHome()),
    tools: ctx.TOOL_DEFINITIONS,
    execute: (name, args) => ctx.executeTool(name, args, ctx),
  });
  const produced = await chat.send('fail please');
  const tool = produced.find((m) => m.role === 'tool');
  assert.equal(tool.tool.result.ok, false);
  assert.equal(tool.tool.result.error, 'not_found');
  assert.match(produced[produced.length - 1].text, /could not do that/);
});

test('gemini: invalid API key surfaces as an error message and the history stays clean', async () => {
  const chat = new GeminiChat({
    getApiKey: () => 'wrong',
    getModel: () => 'gemini-2.5-flash',
    getSystemPrompt: async () => 'sys',
    tools: ctx.TOOL_DEFINITIONS,
    execute: async () => ({ ok: true }),
  });
  const produced = await chat.send('hello');
  assert.equal(produced[0].role, 'error');
  assert.match(produced[0].text, /API key not valid/);
  assert.equal(chat.contents.filter((c) => c.role === 'model').length, 0);
});

test('gemini: model listing filters to chat-capable models', async () => {
  const models = await listGeminiModels('test-key');
  assert.deepEqual(models.map((m) => m.name), ['gemini-2.5-flash']);
  await assert.rejects(() => listGeminiModels(''), /No Gemini API key/);
});
