import fs from 'node:fs';
import path from 'node:path';
import { app, BrowserWindow, clipboard, ipcMain, Menu, nativeImage, nativeTheme, safeStorage, shell, Tray } from 'electron';
import { EmulatorHost } from './hue-emulator.ts';
import {
  buildSystemPrompt,
  buildLocalTime,
  buildScheduleCommand,
  describeLocalTime,
  executeTool,
  HueClient,
  LinkButtonNotPressedError,
  parseLocalTime,
  parseScheduleCommand,
  TOOL_DEFINITIONS,
  v1Id,
  type BridgeConnection,
  type LightState,
  type ResourceType,
  type SceneAction,
  type ScheduleV1,
  type XY,
} from '@hue/core/node';
import { ConfigStore } from './config.ts';
import { HueService } from './hue-service.ts';
import { AssistantChat, listModels } from './llm/chat.ts';
import { providerMeta, type ProviderId, type ProviderSettings } from '../shared/providers.ts';
import { LocalApi } from './http-api.ts';
import { buildSnippets, detectInstalled, findNode, installAgent, mcpScriptPath } from './agents.ts';
import { HueCloud, HUE_AUDIENCE } from './hue-cloud.ts';
import { cancelActiveBrowserLogin, findChromiumBrowser, signInWithHueAccount, signInWithSystemBrowser, startClipboardSignIn, stopClipboardWatcher } from './cloud-login.ts';
import type { AgentInfo, ChatMessage, CreateSceneInput, HueApi, PairTarget, ScheduleSpec, ScheduleView, Settings } from '../shared/ipc-types.ts';

app.setName('Hue Pilot');
// Isolated config dirs (tests, screenshots) also get their own Electron data + single-instance lock.
if (process.env.HUE_PILOT_CONFIG_DIR) app.setPath('userData', path.join(process.env.HUE_PILOT_CONFIG_DIR, 'electron'));
if (process.platform === 'win32') app.setAppUserModelId('pt.prospero.huepilot');

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();

const config = new ConfigStore();
const hue = new HueService();

// Hue account (cloud live view). Tokens are encrypted with the OS keychain when available.
const cloudLog: string[] = [];
const cloud = new HueCloud({
  file: path.join(app.getPath('userData'), 'hue-account.json'),
  encrypt: (plain) => (safeStorage.isEncryptionAvailable() ? `enc:${safeStorage.encryptString(plain).toString('base64')}` : plain),
  decrypt: (data) => (data.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(data.slice(4), 'base64')) : data),
  log: (line) => {
    const entry = `${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}  ${line}`;
    cloudLog.push(entry);
    if (cloudLog.length > 200) cloudLog.shift();
    broadcast('hue:cloud-log', entry);
  },
});
cloud.on('status', (s) => broadcast('hue:cloud-status', s));

// Camera engine: the official Hue app in a hidden Android emulator, streamed into the Cameras page.
const emulator = new EmulatorHost({
  log: (line) => {
    const entry = `${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}  [camera engine] ${line}`;
    cloudLog.push(entry);
    if (cloudLog.length > 200) cloudLog.shift();
    broadcast('hue:cloud-log', entry);
  },
});
emulator.on('status', (s) => broadcast('hue:emu-status', s));
emulator.on('frame', (chunk: Buffer) => broadcast('hue:emu-frame', chunk));
emulator.on('stream-restart', () => broadcast('hue:emu-frame', { restart: true }));
/**
 * Audiences to try for the Hue Auth0 login, in order. Probed on 2026-09-26: the tenant accepts
 * `https://account.meethue.com` and the default audience; `https://api.meethue.com` (used by an
 * older community project) is rejected with "Service not found". If the account API later refuses
 * the token (401), the next audience is tried — the Auth0 session cookie makes that instant.
 */
// The Hue account site itself requests no audience (default), so that goes first.
const CLOUD_AUDIENCES: (string | null)[] = [null, 'https://account.meethue.com', HUE_AUDIENCE];
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;

// -----------------------------------------------------------------------------
// Assistant + local API
// -----------------------------------------------------------------------------

const toolCtx = () => ({
  client: hue.requireClient(),
  getHome: () => hue.getHome(),
  appKey: config.bridge?.appKey ?? '',
  defaultTransitionMs: config.settings.transitionMs,
});

const READ_ONLY_TOOLS = new Set(TOOL_DEFINITIONS.filter((t) => t.readOnly).map((t) => t.name));

const runTool = async (name: string, args: Record<string, unknown>) => {
  const result = await executeTool(name, args, toolCtx());
  // Let the event stream deliver the new state before the caller reads it back.
  if (!READ_ONLY_TOOLS.has(name) && result.ok && hue.status.stream === 'open') await hue.settle(400);
  return result;
};

const chat = new AssistantChat({
  getProvider: () => config.settings.assistantProvider,
  getProviderConfig: (p: ProviderId) => config.settings.providers[p] ?? { apiKey: '', model: providerMeta(p).defaultModel },
  getSystemPrompt: async () => {
    const home = await hue.getHome();
    const lang = config.settings.language;
    const extra = lang === 'pt' ? 'Responde sempre em português europeu.' : lang === 'en' ? 'Always answer in English.' : undefined;
    return buildSystemPrompt(home, extra);
  },
  tools: TOOL_DEFINITIONS,
  execute: runTool,
});

const api = new LocalApi({
  getToken: () => config.settings.httpApiToken,
  listTools: () => TOOL_DEFINITIONS,
  execute: runTool,
  chat: (text) => chat.send(text, (m) => broadcast('hue:chat-event', m)),
  overview: () => runTool('get_home_overview', {}),
});

async function restartApi() {
  await api.stop();
  if (!config.settings.httpApiEnabled) return;
  try {
    await api.start(config.settings.httpApiPort);
  } catch (err) {
    console.error('local api failed to start', err);
  }
}

// -----------------------------------------------------------------------------
// Window / theme / tray
// -----------------------------------------------------------------------------

function broadcast(channel: string, payload: unknown) {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload);
}

function isDark(): boolean {
  const t = config.settings.theme;
  return t === 'system' ? nativeTheme.shouldUseDarkColors : t === 'dark';
}

function overlayColors() {
  return isDark() ? { color: '#0b0f17', symbolColor: '#e2e8f0', height: 40 } : { color: '#f8fafc', symbolColor: '#0f172a', height: 40 };
}

function applyTheme() {
  nativeTheme.themeSource = config.settings.theme;
  if (win && process.platform === 'win32') {
    try {
      win.setTitleBarOverlay(overlayColors());
    } catch {
      /* not supported */
    }
  }
}

function resourcePath(name: string): string {
  return app.isPackaged ? path.join(process.resourcesPath, 'app', name) : path.join(app.getAppPath(), 'resources', name);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: isDark() ? '#0b0f17' : '#f8fafc',
    title: 'Hue Pilot',
    icon: resourcePath('icon.png'),
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'win32' ? 'hidden' : 'hiddenInset',
    ...(process.platform === 'win32' ? { titleBarOverlay: overlayColors() } : {}),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) win?.show();
  });
  win.on('close', (e) => {
    if (!quitting && config.settings.minimizeToTray && tray) {
      e.preventDefault();
      win?.hide();
    }
  });
  win.on('closed', () => {
    win = null;
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(path.join(__dirname, '../renderer/index.html'));
}

function showWindow() {
  if (!win) createWindow();
  else {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
}

function createTray() {
  try {
    const img = nativeImage.createFromPath(resourcePath('tray.png'));
    tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
    tray.setToolTip('Hue Pilot');
    tray.on('click', showWindow);
    tray.on('double-click', showWindow);
    updateTray();
  } catch (err) {
    console.error('tray failed', err);
  }
}

function updateTray() {
  if (!tray) return;
  const home = hue.home;
  const favourites = config.settings.favouriteGroupIds.map((id) => home.groupById[id]).filter(Boolean);
  const groups = favourites.length ? favourites : home.rooms.slice(0, 6);
  const menu = Menu.buildFromTemplate([
    { label: 'Open Hue Pilot', click: showWindow },
    { type: 'separator' },
    {
      label: hue.connected ? `${home.totalLightsOn} of ${home.lights.length} lights on` : 'Bridge not connected',
      enabled: false,
    },
    { label: 'All lights on', enabled: hue.connected, click: () => runTool('set_all_lights', { on: true }) },
    { label: 'All lights off', enabled: hue.connected, click: () => runTool('set_all_lights', { on: false }) },
    { type: 'separator' },
    ...groups.map((g) => ({
      label: g.name,
      type: 'checkbox' as const,
      checked: g.anyOn,
      click: () => g.groupedLightId && hue.requireClient().setGroupedLight(g.groupedLightId, { on: !g.anyOn, transitionMs: config.settings.transitionMs }),
    })),
    ...(groups.length ? [{ type: 'separator' as const }] : []),
    {
      label: 'Quit',
      click: () => {
        quitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

// -----------------------------------------------------------------------------
// Helpers for IPC handlers
// -----------------------------------------------------------------------------

function actionFromLight(lightId: string): SceneAction {
  const l = hue.home.lightById[lightId];
  const action: SceneAction['action'] = { on: { on: !!l?.on } };
  if (!l) return { target: { rid: lightId, rtype: 'light' }, action };
  if (l.on) {
    if (l.supportsDimming) action.dimming = { brightness: Math.max(1, Math.round(l.brightness)) };
    if (l.colorMode === 'xy' && l.xy) action.color = { xy: l.xy };
    else if (l.colorMode === 'ct' && l.mirek) action.color_temperature = { mirek: l.mirek };
    if (l.effect && l.effect !== 'no_effect') {
      if (l.effectsV2) action.effects_v2 = { action: { effect: l.effect } };
      else action.effects = { effect: l.effect };
    }
  }
  return { target: { rid: lightId, rtype: 'light' }, action };
}

function paletteFromActions(actions: SceneAction[]) {
  const color: { color: { xy: XY }; dimming: { brightness: number } }[] = [];
  const ct: { color_temperature: { mirek: number }; dimming: { brightness: number } }[] = [];
  const seen = new Set<string>();
  for (const a of actions) {
    const bri = a.action.dimming?.brightness ?? 100;
    if (a.action.color?.xy) {
      const key = `${a.action.color.xy.x.toFixed(3)},${a.action.color.xy.y.toFixed(3)}`;
      if (!seen.has(key) && color.length < 9) {
        seen.add(key);
        color.push({ color: { xy: a.action.color.xy }, dimming: { brightness: bri } });
      }
    } else if (a.action.color_temperature?.mirek && ct.length < 1) {
      ct.push({ color_temperature: { mirek: a.action.color_temperature.mirek }, dimming: { brightness: bri } });
    }
  }
  return { color, dimming: [], color_temperature: ct };
}

async function scheduleViews(): Promise<ScheduleView[]> {
  const client = hue.requireClient();
  const home = await hue.getHome();
  const map = await client.listSchedules();
  const byV1 = new Map<string, { kind: 'group' | 'light'; id: string; name: string }>();
  for (const g of home.groups) if (g.idV1) byV1.set(g.idV1, { kind: 'group', id: g.id, name: g.kind === 'zone' ? `${g.name} (zone)` : g.name });
  if (home.home) byV1.set('/groups/0', { kind: 'group', id: home.home.id, name: 'All lights' });
  for (const l of home.lights) if (l.idV1) byV1.set(l.idV1, { kind: 'light', id: l.id, name: l.name });
  const sceneByV1 = new Map<string, { id: string; name: string }>();
  for (const s of home.scenes) {
    const id = v1Id(s.idV1);
    if (id) sceneByV1.set(id, { id: s.id, name: s.name });
  }
  return Object.entries(map)
    .map(([id, s]) => {
      const cmd = parseScheduleCommand(s.command);
      const key = cmd.v1Id ? `/${cmd.targetKind === 'group' ? 'groups' : 'lights'}/${cmd.v1Id}` : '';
      const target = byV1.get(key);
      const scene = cmd.sceneV1Id ? sceneByV1.get(cmd.sceneV1Id) : undefined;
      const parts = [scene ? `Scene "${scene.name}"` : null, cmd.on !== undefined ? (cmd.on ? 'On' : 'Off') : null, cmd.brightness !== undefined ? `${cmd.brightness}%` : null].filter(Boolean);
      return {
        id,
        name: s.name,
        when: describeLocalTime(parseLocalTime(s.localtime ?? s.time ?? '')),
        localtime: s.localtime ?? s.time ?? '',
        status: s.status ?? 'enabled',
        target: target ?? (cmd.v1Id ? { kind: cmd.targetKind, name: `${cmd.targetKind} ${cmd.v1Id}` } : undefined),
        action: { on: cmd.on, brightness: cmd.brightness, sceneId: scene?.id, sceneName: scene?.name, summary: parts.join(' · ') || 'Custom command' },
        createdBy: s.description?.includes('Hue Pilot') ? 'hue-pilot' : 'other',
        raw: s,
      } satisfies ScheduleView;
    })
    .sort((a, b) => a.localtime.localeCompare(b.localtime));
}

async function chatSend(text: string): Promise<ChatMessage[]> {
  return chat.send(text, (m) => broadcast('hue:chat-event', m));
}

function agentInfo(): AgentInfo {
  const configPath = config.file;
  return {
    mcpPath: mcpScriptPath(),
    nodeCommand: findNode(),
    electronPath: process.execPath,
    configPath,
    bridgeConfigured: !!config.bridge,
    httpApi: { enabled: config.settings.httpApiEnabled, port: api.port || config.settings.httpApiPort, token: config.settings.httpApiToken, url: `http://127.0.0.1:${api.port || config.settings.httpApiPort}` },
    snippets: buildSnippets(configPath),
    installed: detectInstalled(),
  };
}

// -----------------------------------------------------------------------------
// IPC
// -----------------------------------------------------------------------------

type Handlers = { [K in keyof HueApi as K extends `on${string}` ? never : K]: HueApi[K] };

const handlers: Handlers = {
  discover: () => HueClient.discover(),
  probe: (target: PairTarget) => HueClient.getBridgeConfig(target),
  pair: async (target: PairTarget) => {
    try {
      const result = await HueClient.pair(target, 'hue_pilot#desktop');
      let name: string | undefined;
      let bridgeId: string | undefined;
      try {
        const cfg = await HueClient.getBridgeConfig(target);
        name = cfg.name;
        bridgeId = cfg.bridgeid;
      } catch {
        /* optional */
      }
      const bridge: BridgeConnection = { host: target.host, port: target.port, protocol: target.protocol ?? 'https', appKey: result.appKey, clientKey: result.clientKey, name, bridgeId };
      config.setBridge(bridge);
      await hue.connect(bridge);
      return { ok: true, bridge };
    } catch (err) {
      return { ok: false, linkButton: err instanceof LinkButtonNotPressedError, error: (err as Error).message };
    }
  },
  forgetBridge: async () => {
    hue.disconnect();
    config.setBridge(null);
    chat.reset();
  },
  getConnection: async () => config.bridge,
  getStatus: async () => hue.status,
  reconnect: async () => {
    if (config.bridge) await hue.connect(config.bridge);
  },

  getHome: () => hue.getHome(),
  refresh: () => hue.refresh(),

  setLight: async (id: string, state: LightState) => {
    const l = hue.home.lightById[id];
    await hue.requireClient().setLight(id, { transitionMs: config.settings.transitionMs, ...state }, { effectsV2: l?.effectsV2 ?? true });
  },
  setGroup: async (groupId: string, state: LightState) => {
    const g = hue.home.groupById[groupId] ?? (hue.home.home?.id === groupId ? hue.home.home : undefined);
    if (!g?.groupedLightId) throw new Error('Group has no grouped light service');
    await hue.requireClient().setGroupedLight(g.groupedLightId, { transitionMs: config.settings.transitionMs, ...state });
  },
  recallScene: async (id: string, action = 'active') => {
    await hue.requireClient().recallScene(id, action, config.settings.transitionMs);
  },
  identify: async (lightId: string) => {
    await hue.requireClient().identify(lightId);
  },
  identifyGroup: async (groupId: string) => {
    const g = hue.home.groupById[groupId];
    if (g?.groupedLightId) await hue.requireClient().identifyGroup(g.groupedLightId);
  },
  rename: async (type: ResourceType, id: string, name: string) => {
    await hue.requireClient().rename(type, id, name.trim().slice(0, 32));
  },
  createScene: async (input: CreateSceneInput) => {
    const group = hue.home.groupById[input.groupId];
    if (!group) throw new Error('Unknown room');
    const actions = input.fromCurrentState ? group.lightIds.map(actionFromLight) : input.actions;
    const refs = await hue.requireClient().createScene({
      name: input.name.trim().slice(0, 32),
      group: { rid: input.groupId, rtype: input.groupType },
      actions,
      palette: paletteFromActions(actions),
      speed: 0.5,
      autoDynamic: false,
    });
    return refs[0]?.rid ?? '';
  },
  updateScene: async (id: string, patch) => {
    const body: Record<string, unknown> = {};
    if (patch.name !== undefined) body.metadata = { name: patch.name.trim().slice(0, 32) };
    if (patch.speed !== undefined) body.speed = patch.speed;
    if (patch.autoDynamic !== undefined) body.auto_dynamic = patch.autoDynamic;
    if (patch.actions) {
      body.actions = patch.actions;
      body.palette = paletteFromActions(patch.actions);
    }
    await hue.requireClient().updateScene(id, body);
  },
  deleteScene: async (id: string) => {
    await hue.requireClient().deleteScene(id);
  },
  setSensorEnabled: async (type: ResourceType, id: string, enabled: boolean) => {
    await hue.requireClient().updateResource(type, id, { enabled });
  },
  setCameraMotionDetection: (cameraMotionId: string, enabled: boolean) => hue.setCameraMotionDetection(cameraMotionId, enabled),
  getMotionEvents: async () => hue.getMotionEvents(),
  searchLights: async () => {
    await hue.requireClient().searchNewLights();
    setTimeout(() => hue.refresh().catch(() => undefined), 45_000);
  },
  updateGroupChildren: async (type, id, children) => {
    await hue.requireClient().updateResource(type, id, { children });
  },
  createGroup: async (type, name, archetype, children) => {
    const refs = await hue.requireClient().createResource(type, { type, metadata: { name: name.trim().slice(0, 32), archetype }, children });
    await hue.refresh().catch(() => undefined);
    return refs[0]?.rid ?? '';
  },
  deleteGroup: async (type, id) => {
    await hue.requireClient().deleteResource(type, id);
    await hue.refresh().catch(() => undefined);
  },

  listSchedules: () => scheduleViews(),
  createSchedule: async (spec: ScheduleSpec) => {
    const home = await hue.getHome();
    const appKey = config.bridge?.appKey ?? '';
    let target: { kind: 'group' | 'light'; v1Id: string };
    let label: string;
    if (spec.target.kind === 'group') {
      const g = home.groupById[spec.target.id] ?? (home.home?.id === spec.target.id ? home.home : undefined);
      if (!g) throw new Error('Unknown room');
      const id = g.kind === 'home' ? '0' : v1Id(g.idV1);
      if (!id) throw new Error(`${g.name} cannot be scheduled by the bridge (no v1 id).`);
      target = { kind: 'group', v1Id: id };
      label = g.name;
    } else {
      const l = home.lightById[spec.target.id];
      if (!l) throw new Error('Unknown light');
      const id = v1Id(l.idV1);
      if (!id) throw new Error(`${l.name} cannot be scheduled by the bridge (no v1 id).`);
      target = { kind: 'light', v1Id: id };
      label = l.name;
    }
    let sceneV1Id: string | undefined;
    if (spec.sceneId) {
      const s = home.sceneById[spec.sceneId];
      sceneV1Id = v1Id(s?.idV1);
      if (!sceneV1Id) throw new Error('This scene cannot be scheduled (no v1 id).');
    }
    const schedule: ScheduleV1 = {
      name: (spec.name || label).trim().slice(0, 32),
      description: 'Created by Hue Pilot',
      command: buildScheduleCommand({ appKey, target, on: spec.on, brightness: spec.brightness, sceneV1Id }),
      localtime: buildLocalTime({ time: spec.time, days: spec.days, onceDate: spec.onceDate }),
      status: 'enabled',
      autodelete: !!spec.onceDate,
    };
    return hue.requireClient().createSchedule(schedule);
  },
  updateSchedule: async (id, patch) => {
    await hue.requireClient().updateSchedule(id, patch);
  },
  deleteSchedule: async (id: string) => {
    await hue.requireClient().deleteSchedule(id);
  },

  chat: (text: string) => chatSend(text),
  resetChat: async () => chat.reset(),
  getChatHistory: async () => chat.transcript,
  listModels: (provider: ProviderId) => listModels(provider, config.settings.providers[provider]?.apiKey ?? ''),
  runTool: (name, args) => runTool(name, args),
  listTools: async () => TOOL_DEFINITIONS,

  getSettings: async () => config.settings,
  updateSettings: async (patch: Partial<Settings>) => {
    const before = config.settings;
    const next = config.updateSettings(patch);
    if (patch.theme !== undefined) applyTheme();
    if (patch.launchAtLogin !== undefined) {
      try {
        app.setLoginItemSettings({ openAtLogin: next.launchAtLogin, args: ['--hidden'] });
      } catch {
        /* unsupported */
      }
    }
    if (patch.httpApiEnabled !== undefined || (patch.httpApiPort !== undefined && patch.httpApiPort !== before.httpApiPort)) await restartApi();
    if (patch.favouriteGroupIds) updateTray();
    broadcast('hue:settings', next);
    return next;
  },
  updateProvider: async (provider: ProviderId, patch: Partial<ProviderSettings>) => {
    const next = config.updateProvider(provider, patch);
    broadcast('hue:settings', next);
    return next;
  },
  getCloudStatus: async () => cloud.status(),
  cloudSignIn: async (mode?: 'browser' | 'window') => {
    const log = (line: string) => cloud.emit('log', line);
    if (mode === 'window') return signInWithHueAccount(cloud, win, CLOUD_AUDIENCES, log);
    const audience = CLOUD_AUDIENCES[Math.min(cloud.audienceAttempt, CLOUD_AUDIENCES.length - 1)] ?? null;
    const browser = await findChromiumBrowser();
    if (!browser) {
      log('No Edge/Chrome/Brave found; falling back to the default browser and the clipboard.');
      return startClipboardSignIn(cloud, audience, log);
    }
    return signInWithSystemBrowser(cloud, browser, audience, path.join(app.getPath('userData'), 'hue-login-browser'), log);
  },
  cloudFinishSignIn: async (text: string) => {
    const status = await cloud.finishBrowserLogin(text);
    if (!status) throw new Error('That does not look like the address from the Hue account page (it should contain "code=").');
    stopClipboardWatcher();
    return status;
  },
  cloudCancelSignIn: async () => {
    stopClipboardWatcher();
    cancelActiveBrowserLogin();
    return cloud.cancelBrowserLogin();
  },
  cloudSetPassphrase: async (passphrase: string) => cloud.setPassphrase(passphrase),
  cloudSignOffer: async (sdp: string) => cloud.signOffer(sdp),
  cloudSignOut: async () => cloud.signOut(),
  cloudRefresh: () => cloud.discover(),
  cloudSetHome: (homeId: string) => cloud.setHome(homeId),
  cloudPrepareLiveView: (cameraId: string) => cloud.prepareLiveView(cameraId),
  cloudLog: async () => [...cloudLog],
  getEmulatorStatus: async () => emulator.status(),
  emulatorEnsureRunning: () => emulator.ensureRunning(),
  emulatorOpenCamera: (name: string) => emulator.openCamera(name),
  emulatorCloseCamera: () => emulator.closeCamera(),
  emulatorStartStream: async () => emulator.startStream(),
  emulatorStopStream: async () => emulator.stopStream(),
  emulatorStop: () => emulator.stopEmulator(),
  getAgentInfo: async () => agentInfo(),
  installAgent: (target) => installAgent(target, config.file),
  getAppInfo: async () => ({ version: app.getVersion(), platform: process.platform, configPath: config.file, isPackaged: app.isPackaged, electron: process.versions.electron }),
  openExternal: async (url: string) => {
    if (/^https?:\/\//.test(url)) await shell.openExternal(url);
  },
  openPath: async (p: string) => {
    await shell.openPath(p);
  },
  copyText: async (text: string) => clipboard.writeText(text),
};

ipcMain.handle('hue', async (_event, method: string, ...args: unknown[]) => {
  const fn = (handlers as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[method];
  if (!fn) throw new Error(`Unknown IPC method ${method}`);
  return fn(...args);
});

hue.on('home', (home) => {
  broadcast('hue:home', home);
  updateTray();
});
hue.on('status', (status) => {
  broadcast('hue:status', status);
  updateTray();
});
hue.on('motion-event', (event) => broadcast('hue:motion-event', event));
nativeTheme.on('updated', () => {
  if (config.settings.theme === 'system') applyTheme();
});

// -----------------------------------------------------------------------------
// Screenshot helper for automated verification:
//   HUE_PILOT_SCREENSHOT_DIR=<dir> HUE_PILOT_SCREENSHOT_ROUTES=home,room:<id>,... (renderer navigates per route)
// -----------------------------------------------------------------------------

async function runScreenshots() {
  const dir = process.env.HUE_PILOT_SCREENSHOT_DIR;
  if (!dir || !win) return;
  const routes = (process.env.HUE_PILOT_SCREENSHOT_ROUTES ?? 'home').split(',').map((r) => r.trim()).filter(Boolean);
  fs.mkdirSync(dir, { recursive: true });
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  win.webContents.setBackgroundThrottling(false);
  win.show();
  win.moveTop();
  win.focus();
  await wait(2500);
  for (const route of routes) {
    win.webContents.send('hue:navigate', route);
    await wait(1600);
    win.moveTop();
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, `${route.replace(/[^a-z0-9_-]+/gi, '_')}.png`), img.toPNG());
  }
  quitting = true;
  app.quit();
}

// -----------------------------------------------------------------------------
// Lifecycle
// -----------------------------------------------------------------------------

app.on('second-instance', showWindow);
app.on('before-quit', () => {
  quitting = true;
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !(config.settings.minimizeToTray && tray)) app.quit();
});
app.on('activate', showWindow);

app.whenReady().then(async () => {
  cloud.load();
  // Warm the camera engine in the background so the first camera click is instant.
  if (emulator.status().available) setTimeout(() => emulator.ensureRunning().catch(() => undefined), 4000);
  nativeTheme.themeSource = config.settings.theme;
  createWindow();
  createTray();
  if (config.bridge) hue.connect(config.bridge).catch(() => undefined);
  restartApi().catch(() => undefined);
  if (process.env.HUE_PILOT_SCREENSHOT_DIR) {
    win?.webContents.once('did-finish-load', () => {
      runScreenshots().catch((err) => {
        console.error('screenshot failed', err);
        quitting = true;
        app.quit();
      });
    });
  }
});
