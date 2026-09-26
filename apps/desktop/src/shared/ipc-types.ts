import type {
  BridgeConfigV1,
  BridgeConnection,
  DiscoveredBridge,
  HomeModel,
  LightState,
  ResourceType,
  SceneAction,
  ScheduleV1,
  ToolDefinition,
  ToolResult,
} from '@hue/core';
import { DEFAULT_PROVIDER_SETTINGS, type ModelInfo, type ProviderId, type ProviderSettings } from './providers.ts';

export interface Settings {
  /** Which assistant backend the chat uses. */
  assistantProvider: ProviderId;
  /** API key and model per provider. */
  providers: Record<ProviderId, ProviderSettings>;
  theme: 'system' | 'dark' | 'light';
  transitionMs: number;
  minimizeToTray: boolean;
  launchAtLogin: boolean;
  httpApiEnabled: boolean;
  httpApiPort: number;
  httpApiToken: string;
  favouriteGroupIds: string[];
  speakReplies: boolean;
  language: 'auto' | 'en' | 'pt';
}

export const DEFAULT_SETTINGS: Settings = {
  assistantProvider: 'gemini',
  providers: DEFAULT_PROVIDER_SETTINGS,
  theme: 'system',
  transitionMs: 400,
  minimizeToTray: true,
  launchAtLogin: false,
  httpApiEnabled: true,
  httpApiPort: 8787,
  httpApiToken: '',
  favouriteGroupIds: [],
  speakReplies: false,
  language: 'auto',
};

export interface ConnectionStatus {
  state: 'disconnected' | 'connecting' | 'connected' | 'error';
  stream: 'open' | 'connecting' | 'closed';
  error?: string;
  bridgeName?: string;
  host?: string;
  lastUpdate?: number;
}

/** One entry of the in-memory motion timeline (cameras and motion sensors), newest first when listed. */
export interface MotionEvent {
  id: string;
  /** Device id of the camera or sensor. */
  sourceId: string;
  sourceName: string;
  kind: 'camera' | 'sensor';
  motion: boolean;
  /** ISO time reported by the bridge (motion_report.changed) or the time the event arrived. */
  at: string;
}

export interface PairTarget {
  host: string;
  port?: number;
  protocol?: 'https' | 'http';
}

export type PairResponse = { ok: true; bridge: BridgeConnection } | { ok: false; linkButton: boolean; error: string };

export interface ChatToolCall {
  name: string;
  args: Record<string, unknown>;
  result: ToolResult;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'error' | 'system';
  text: string;
  tool?: ChatToolCall;
  at: number;
}

export interface ScheduleView {
  id: string;
  name: string;
  when: string;
  localtime: string;
  status: 'enabled' | 'disabled';
  target?: { kind: 'group' | 'light' | 'unknown'; id?: string; name: string };
  action: { on?: boolean; brightness?: number; sceneId?: string; sceneName?: string; summary: string };
  createdBy: 'hue-pilot' | 'other';
  raw: ScheduleV1;
}

export interface ScheduleSpec {
  name: string;
  time: string;
  days?: string[];
  onceDate?: string;
  target: { kind: 'group' | 'light'; id: string };
  on?: boolean;
  brightness?: number;
  sceneId?: string;
}

export type AgentTarget = 'claude-desktop' | 'gemini-cli' | 'claude-code' | 'cursor' | 'codex' | 'vscode';

export interface AgentInfo {
  mcpPath: string;
  nodeCommand: string | null;
  electronPath: string;
  configPath: string;
  bridgeConfigured: boolean;
  httpApi: { enabled: boolean; port: number; token: string; url: string };
  snippets: Record<AgentTarget, { title: string; file: string; content: string; language: string }>;
  installed: Record<AgentTarget, boolean>;
}

export interface AppInfo {
  version: string;
  platform: string;
  configPath: string;
  isPackaged: boolean;
  electron: string;
}

export interface CreateSceneInput {
  name: string;
  groupId: string;
  groupType: 'room' | 'zone';
  actions: SceneAction[];
  fromCurrentState?: boolean;
}

/** API exposed to the renderer through the preload script. */
export interface HueApi {
  // bridge & pairing
  discover(): Promise<DiscoveredBridge[]>;
  probe(target: PairTarget): Promise<BridgeConfigV1>;
  pair(target: PairTarget): Promise<PairResponse>;
  forgetBridge(): Promise<void>;
  getConnection(): Promise<BridgeConnection | null>;
  getStatus(): Promise<ConnectionStatus>;
  reconnect(): Promise<void>;

  // state
  getHome(): Promise<HomeModel>;
  refresh(): Promise<HomeModel>;

  // control
  setLight(id: string, state: LightState): Promise<void>;
  setGroup(groupId: string, state: LightState): Promise<void>;
  recallScene(id: string, action?: 'active' | 'dynamic_palette' | 'static'): Promise<void>;
  identify(lightId: string): Promise<void>;
  identifyGroup(groupId: string): Promise<void>;
  rename(type: ResourceType, id: string, name: string): Promise<void>;
  createScene(input: CreateSceneInput): Promise<string>;
  updateScene(id: string, patch: { name?: string; speed?: number; autoDynamic?: boolean; actions?: SceneAction[] }): Promise<void>;
  deleteScene(id: string): Promise<void>;
  setSensorEnabled(type: ResourceType, id: string, enabled: boolean): Promise<void>;
  /** Motion detection on/off for a Hue Secure camera (id = camera_motion service id). */
  setCameraMotionDetection(cameraMotionId: string, enabled: boolean): Promise<void>;
  /** Motion timeline (cameras + motion sensors) collected while the app runs, newest first. */
  getMotionEvents(): Promise<MotionEvent[]>;
  searchLights(): Promise<void>;
  updateGroupChildren(type: 'room' | 'zone', id: string, children: { rid: string; rtype: string }[]): Promise<void>;
  createGroup(type: 'room' | 'zone', name: string, archetype: string, children: { rid: string; rtype: string }[]): Promise<string>;
  deleteGroup(type: 'room' | 'zone', id: string): Promise<void>;

  // schedules
  listSchedules(): Promise<ScheduleView[]>;
  createSchedule(spec: ScheduleSpec): Promise<string>;
  updateSchedule(id: string, patch: { status?: 'enabled' | 'disabled'; name?: string }): Promise<void>;
  deleteSchedule(id: string): Promise<void>;

  // assistant
  chat(text: string): Promise<ChatMessage[]>;
  resetChat(): Promise<void>;
  getChatHistory(): Promise<ChatMessage[]>;
  listModels(provider: ProviderId): Promise<ModelInfo[]>;
  runTool(name: string, args: Record<string, unknown>): Promise<ToolResult>;
  listTools(): Promise<ToolDefinition[]>;

  // settings & agents
  getSettings(): Promise<Settings>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
  updateProvider(provider: ProviderId, patch: Partial<ProviderSettings>): Promise<Settings>;
  getAgentInfo(): Promise<AgentInfo>;
  installAgent(target: AgentTarget): Promise<{ ok: boolean; message: string }>;
  getAppInfo(): Promise<AppInfo>;
  openExternal(url: string): Promise<void>;
  openPath(path: string): Promise<void>;
  copyText(text: string): Promise<void>;

  // events
  onHome(cb: (home: HomeModel) => void): () => void;
  onStatus(cb: (status: ConnectionStatus) => void): () => void;
  onChatEvent(cb: (message: ChatMessage) => void): () => void;
  onNavigate(cb: (route: string) => void): () => void;
  onSettings(cb: (settings: Settings) => void): () => void;
  onMotionEvent(cb: (event: MotionEvent) => void): () => void;
}
