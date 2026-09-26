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

  // Hue account / cloud live view (experimental)
  getCloudStatus(): Promise<CloudStatus>;
  /** Opens the Hue sign-in window; resolves when the login completes or is cancelled. */
  cloudSignIn(): Promise<CloudStatus>;
  cloudSignOut(): Promise<CloudStatus>;
  cloudRefresh(): Promise<CloudStatus>;
  cloudSetHome(homeId: string): Promise<CloudStatus>;
  /** Wakes the camera and returns the signaling session for the renderer's WebRTC viewer. */
  cloudPrepareLiveView(cameraId: string): Promise<LiveViewSession>;
  /** Recent cloud/live-view log lines (for the diagnostics panel). */
  cloudLog(): Promise<string[]>;

  // phone mirror ("watch live on this PC" through the Philips Hue app on an Android phone)
  getMirrorStatus(): Promise<MirrorStatus>;
  mirrorInstall(): Promise<MirrorStatus>;
  mirrorRefreshDevices(): Promise<MirrorStatus>;
  mirrorConnect(address: string): Promise<MirrorStatus>;
  mirrorStart(serial?: string): Promise<MirrorStatus>;
  mirrorStop(): Promise<MirrorStatus>;
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
  onMirrorStatus(cb: (status: MirrorStatus) => void): () => void;
  onCloudStatus(cb: (status: CloudStatus) => void): () => void;
  onCloudLog(cb: (line: string) => void): () => void;
}

export interface CloudHome {
  id: string;
  name: string;
}

export interface CloudCamera {
  /** Device id as the cloud names it (usually the camera's MAC without separators). */
  id: string;
  name: string;
  model: string | null;
  online: boolean | null;
  /** Field names the cloud returned for this device (diagnostics only). */
  raw: string[];
}

export interface CloudStatus {
  signedIn: boolean;
  busy: boolean;
  homeId: string | null;
  homes: CloudHome[];
  cameras: CloudCamera[];
  tokenExpiresAt: number | null;
  canRefresh: boolean;
  error: string | null;
}

/** Everything the renderer needs to open a WebRTC live-view session through Kinesis signaling. */
export interface LiveViewSession {
  cameraId: string;
  cameraName: string;
  clientId: string;
  wssUrl: string;
  iceServers: { urls: string | string[]; username?: string; credential?: string }[];
  region: string;
  channelArn: string;
  responseKeys: string[];
  expiresAt: number;
}

/** An Android device known to adb. */
export interface MirrorDevice {
  serial: string;
  /** `device` (ready), `unauthorized` (accept the prompt on the phone), `offline`, … */
  state: string;
  model: string | null;
  transport: 'usb' | 'wifi' | 'emulator';
}

export interface MirrorStatus {
  /** Windows only. */
  supported: boolean;
  installed: boolean;
  installing: boolean;
  /** Download progress 0..100 while installing. */
  progress: number | null;
  running: boolean;
  /** Serial of the phone being mirrored. */
  serial: string | null;
  devices: MirrorDevice[];
  error: string | null;
  /** What the user should do next, when something is missing. */
  hint: string | null;
  version: string;
  hueApp: string;
}
