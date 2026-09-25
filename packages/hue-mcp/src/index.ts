#!/usr/bin/env node
/**
 * Hue Pilot MCP server – exposes the Philips Hue tools to any MCP-capable agent
 * (Claude Desktop, Claude Code, Gemini CLI, Cursor, Codex, ...). Talks to the bridge directly.
 *
 * Configuration (first match wins):
 *   1. env HUE_BRIDGE_HOST + HUE_APP_KEY (+ optional HUE_BRIDGE_PORT, HUE_BRIDGE_PROTOCOL)
 *   2. --config <path to config.json written by the Hue Pilot desktop app>
 *   3. the desktop app's default config file (%APPDATA%\hue-pilot\config.json, ~/.config/hue-pilot/config.json)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { buildHome, executeTool, HueClient, TOOL_DEFINITIONS } from '@hue/core/node';
import type { BridgeConnection, HomeModel, JsonSchema } from '@hue/core/node';

const VERSION = '1.0.0';

function defaultConfigPaths(): string[] {
  const home = os.homedir();
  const out: string[] = [];
  if (process.env.APPDATA) out.push(path.join(process.env.APPDATA, 'hue-pilot', 'config.json'));
  out.push(path.join(home, 'Library', 'Application Support', 'hue-pilot', 'config.json'));
  out.push(path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'), 'hue-pilot', 'config.json'));
  return out;
}

function loadConnection(argv: string[]): BridgeConnection {
  if (process.env.HUE_BRIDGE_HOST && process.env.HUE_APP_KEY) {
    return {
      host: process.env.HUE_BRIDGE_HOST,
      appKey: process.env.HUE_APP_KEY,
      port: process.env.HUE_BRIDGE_PORT ? Number(process.env.HUE_BRIDGE_PORT) : undefined,
      protocol: process.env.HUE_BRIDGE_PROTOCOL === 'http' ? 'http' : 'https',
    };
  }
  const idx = argv.indexOf('--config');
  const candidates = idx >= 0 && argv[idx + 1] ? [argv[idx + 1]] : defaultConfigPaths();
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      const bridge = parsed?.bridge ?? parsed;
      if (bridge?.host && bridge?.appKey) {
        return { host: bridge.host, appKey: bridge.appKey, port: bridge.port, protocol: bridge.protocol, bridgeId: bridge.bridgeId, name: bridge.name };
      }
    } catch (err) {
      console.error(`hue-mcp: could not read ${file}: ${(err as Error).message}`);
    }
  }
  throw new Error(
    'No Hue bridge configured. Pair the Hue Pilot desktop app first, or set HUE_BRIDGE_HOST and HUE_APP_KEY, or pass --config <path>.',
  );
}

function zodShape(schema: JsonSchema): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  const required = new Set(schema.required ?? []);
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    let t: z.ZodTypeAny;
    switch (prop.type) {
      case 'string':
        t = prop.enum ? z.enum(prop.enum as [string, ...string[]]) : z.string();
        break;
      case 'number':
      case 'integer':
        t = z.number();
        break;
      case 'boolean':
        t = z.boolean();
        break;
      case 'array':
        t = z.array(prop.items?.type === 'number' ? z.number() : z.string());
        break;
      default:
        t = z.any();
    }
    if (prop.description) t = t.describe(prop.description);
    shape[key] = required.has(key) ? t : t.optional();
  }
  return shape;
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--version')) {
    console.log(VERSION);
    return;
  }
  if (argv.includes('--help')) {
    console.log(`hue-pilot-mcp ${VERSION}\n\nUsage: hue-pilot-mcp [--config <config.json>] [--check]\n\nEnvironment: HUE_BRIDGE_HOST, HUE_APP_KEY, HUE_BRIDGE_PORT, HUE_BRIDGE_PROTOCOL`);
    return;
  }

  const conn = loadConnection(argv);
  const client = new HueClient(conn);
  let cache: { home: HomeModel; at: number } | null = null;
  const getHome = async () => {
    if (cache && Date.now() - cache.at < 1500) return cache.home;
    const home = buildHome(await client.getAll());
    cache = { home, at: Date.now() };
    return home;
  };
  const ctx = { client, getHome, appKey: conn.appKey, defaultTransitionMs: 400 };

  if (argv.includes('--check')) {
    const home = await getHome();
    console.log(
      JSON.stringify(
        {
          ok: true,
          bridge: home.bridge?.name,
          host: conn.host,
          rooms: home.rooms.map((r) => r.name),
          zones: home.zones.map((z) => z.name),
          lights: home.lights.length,
          scenes: home.scenes.length,
          tools: TOOL_DEFINITIONS.map((t) => t.name),
        },
        null,
        2,
      ),
    );
    return;
  }

  const server = new McpServer({ name: 'hue-pilot', version: VERSION });
  for (const tool of TOOL_DEFINITIONS) {
    server.registerTool(
      tool.name,
      {
        title: tool.name.replace(/_/g, ' '),
        description: tool.description,
        inputSchema: zodShape(tool.parameters),
        annotations: {
          readOnlyHint: !!tool.readOnly,
          destructiveHint: tool.name === 'delete_schedule',
          idempotentHint: tool.name !== 'create_schedule',
          openWorldHint: false,
        },
      },
      async (args: Record<string, unknown>) => {
        if (!tool.readOnly) cache = null;
        const result = await executeTool(tool.name, args ?? {}, ctx);
        if (!tool.readOnly) cache = null;
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }], isError: !result.ok };
      },
    );
  }

  server.registerResource(
    'home',
    'hue://home',
    { title: 'Hue home overview', description: 'Rooms, zones, lights and scenes with their current state', mimeType: 'application/json' },
    async () => ({ contents: [{ uri: 'hue://home', mimeType: 'application/json', text: JSON.stringify(await executeTool('get_home_overview', {}, ctx), null, 2) }] }),
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`hue-pilot-mcp ${VERSION} connected to bridge ${conn.name ?? conn.host}`);
}

main().catch((err) => {
  console.error(`hue-pilot-mcp: ${(err as Error).message}`);
  process.exit(1);
});
