import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app } from 'electron';
import type { AgentInfo, AgentTarget } from '../shared/ipc-types.ts';

export function mcpScriptPath(): string {
  if (app.isPackaged) return path.join(process.resourcesPath, 'hue-mcp.mjs');
  return path.resolve(app.getAppPath(), '..', '..', 'packages', 'hue-mcp', 'dist', 'hue-mcp.mjs');
}

let nodeCache: string | null | undefined;
export function findNode(): string | null {
  if (nodeCache !== undefined) return nodeCache;
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const out = execFileSync(cmd, ['node'], { encoding: 'utf8', windowsHide: true, timeout: 4000 });
    const first = out.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.toLowerCase().includes('\\claude\\'));
    nodeCache = first ?? null;
  } catch {
    nodeCache = null;
  }
  return nodeCache;
}

function findOnPath(binary: string): string | null {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    const out = execFileSync(cmd, [binary], { encoding: 'utf8', windowsHide: true, timeout: 4000 });
    return out.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? null;
  } catch {
    return null;
  }
}

interface ServerSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export function serverSpec(configPath: string): ServerSpec {
  const script = mcpScriptPath();
  const node = findNode();
  if (node) return { command: node, args: [script, '--config', configPath] };
  // Fall back to Electron running as Node.
  return { command: process.execPath, args: [script, '--config', configPath], env: { ELECTRON_RUN_AS_NODE: '1' } };
}

const home = () => os.homedir();

export function agentConfigFile(target: AgentTarget): string {
  switch (target) {
    case 'claude-desktop':
      return process.platform === 'win32'
        ? path.join(process.env.APPDATA ?? path.join(home(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json')
        : process.platform === 'darwin'
          ? path.join(home(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json')
          : path.join(home(), '.config', 'Claude', 'claude_desktop_config.json');
    case 'gemini-cli':
      return path.join(home(), '.gemini', 'settings.json');
    case 'claude-code':
      return path.join(home(), '.claude.json');
    case 'cursor':
      return path.join(home(), '.cursor', 'mcp.json');
    case 'codex':
      return path.join(home(), '.codex', 'config.toml');
    case 'vscode':
      return process.platform === 'win32'
        ? path.join(process.env.APPDATA ?? path.join(home(), 'AppData', 'Roaming'), 'Code', 'User', 'mcp.json')
        : process.platform === 'darwin'
          ? path.join(home(), 'Library', 'Application Support', 'Code', 'User', 'mcp.json')
          : path.join(home(), '.config', 'Code', 'User', 'mcp.json');
  }
}

function readJson(file: string): Record<string, any> {
  try {
    if (!fs.existsSync(file)) return {};
    return JSON.parse(fs.readFileSync(file, 'utf8')) ?? {};
  } catch {
    return {};
  }
}

function writeJson(file: string, data: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.hue-pilot.bak`);
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function tomlString(s: string) {
  return JSON.stringify(s);
}

export function buildSnippets(configPath: string): AgentInfo['snippets'] {
  const spec = serverSpec(configPath);
  const jsonServer = { command: spec.command, args: spec.args, ...(spec.env ? { env: spec.env } : {}) };
  const mcpServersJson = JSON.stringify({ mcpServers: { hue: jsonServer } }, null, 2);
  const vscodeJson = JSON.stringify({ servers: { hue: { type: 'stdio', ...jsonServer } } }, null, 2);
  const codexToml = [
    '[mcp_servers.hue]',
    `command = ${tomlString(spec.command)}`,
    `args = [${spec.args.map(tomlString).join(', ')}]`,
    ...(spec.env ? ['[mcp_servers.hue.env]', ...Object.entries(spec.env).map(([k, v]) => `${k} = ${tomlString(v)}`)] : []),
  ].join('\n');
  const claudeCodeCmd = `claude mcp add --scope user hue ${spec.env ? Object.entries(spec.env).map(([k, v]) => `-e ${k}=${v} `).join('') : ''}-- ${[spec.command, ...spec.args].map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`;
  return {
    'claude-desktop': { title: 'Claude Desktop', file: agentConfigFile('claude-desktop'), content: mcpServersJson, language: 'json' },
    'gemini-cli': { title: 'Gemini CLI', file: agentConfigFile('gemini-cli'), content: mcpServersJson, language: 'json' },
    'claude-code': { title: 'Claude Code', file: 'terminal', content: claudeCodeCmd, language: 'bash' },
    cursor: { title: 'Cursor', file: agentConfigFile('cursor'), content: mcpServersJson, language: 'json' },
    codex: { title: 'Codex CLI', file: agentConfigFile('codex'), content: codexToml, language: 'toml' },
    vscode: { title: 'VS Code (Copilot)', file: agentConfigFile('vscode'), content: vscodeJson, language: 'json' },
  };
}

export function detectInstalled(): AgentInfo['installed'] {
  const has = (file: string, key: string) => {
    try {
      if (!fs.existsSync(file)) return false;
      const txt = fs.readFileSync(file, 'utf8');
      return txt.includes(key);
    } catch {
      return false;
    }
  };
  return {
    'claude-desktop': has(agentConfigFile('claude-desktop'), '"hue"'),
    'gemini-cli': has(agentConfigFile('gemini-cli'), '"hue"'),
    'claude-code': has(agentConfigFile('claude-code'), '"hue"'),
    cursor: has(agentConfigFile('cursor'), '"hue"'),
    codex: has(agentConfigFile('codex'), 'mcp_servers.hue'),
    vscode: has(agentConfigFile('vscode'), '"hue"'),
  };
}

export async function installAgent(target: AgentTarget, configPath: string): Promise<{ ok: boolean; message: string }> {
  const spec = serverSpec(configPath);
  const server = { command: spec.command, args: spec.args, ...(spec.env ? { env: spec.env } : {}) };
  const file = agentConfigFile(target);
  try {
    switch (target) {
      case 'claude-desktop':
      case 'gemini-cli':
      case 'cursor': {
        const data = readJson(file);
        data.mcpServers = { ...(data.mcpServers ?? {}), hue: server };
        writeJson(file, data);
        return { ok: true, message: `Added the "hue" MCP server to ${file}. Restart the app to load it.` };
      }
      case 'vscode': {
        const data = readJson(file);
        data.servers = { ...(data.servers ?? {}), hue: { type: 'stdio', ...server } };
        writeJson(file, data);
        return { ok: true, message: `Added the "hue" MCP server to ${file}.` };
      }
      case 'codex': {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
        if (existing.includes('[mcp_servers.hue]')) return { ok: true, message: `Codex already has the "hue" server in ${file}.` };
        if (existing) fs.copyFileSync(file, `${file}.hue-pilot.bak`);
        fs.writeFileSync(file, `${existing.trimEnd()}\n\n${buildSnippets(configPath).codex.content}\n`, 'utf8');
        return { ok: true, message: `Appended the "hue" server to ${file}.` };
      }
      case 'claude-code': {
        const claude = findOnPath(process.platform === 'win32' ? 'claude.cmd' : 'claude') ?? findOnPath('claude');
        if (!claude) return { ok: false, message: 'Claude Code CLI not found on PATH. Run the command shown below in a terminal instead.' };
        const args = ['mcp', 'add', '--scope', 'user'];
        if (spec.env) for (const [k, v] of Object.entries(spec.env)) args.push('-e', `${k}=${v}`);
        args.push('hue', '--', spec.command, ...spec.args);
        try {
          execFileSync(claude, ['mcp', 'remove', '--scope', 'user', 'hue'], { encoding: 'utf8', windowsHide: true, timeout: 15000, shell: process.platform === 'win32' });
        } catch {
          /* not installed yet */
        }
        const out = execFileSync(claude, args, { encoding: 'utf8', windowsHide: true, timeout: 15000, shell: process.platform === 'win32' });
        return { ok: true, message: out.trim() || 'Added the "hue" MCP server to Claude Code (user scope).' };
      }
    }
  } catch (err) {
    return { ok: false, message: `Could not update ${file}: ${(err as Error).message}` };
  }
  return { ok: false, message: 'Unknown target' };
}
