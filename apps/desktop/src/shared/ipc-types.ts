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
  /** Pause/resume a sensor's or camera's motion automation (bridge behavior_instance). */
  setMotionAutomationEnabled(id: string, enabled: boolean): Promise<void>;
  deleteMotionAutomation(id: string): Promise<void>;

  // Hue account / cloud live view (experimental)
  getCloudStatus(): Promise<CloudStatus>;
  /**
   * `browser` (default): opens the Hue sign-in page in the system browser and waits for the redirect
   * address (clipboard or `cloudFinishSignIn`). `window`: embedded sign-in window (email/password
   * accounts only; Google/Apple refuse embedded windows).
   */
  cloudSignIn(mode?: 'browser' | 'window'): Promise<CloudStatus>;
  /** Completes a browser sign-in from the pasted redirect address (or bare code). */
  cloudFinishSignIn(text: string): Promise<CloudStatus>;
  cloudCancelSignIn(): Promise<CloudStatus>;
  /** Stores (or clears, with an empty string) the home's E2EE passphrase from the Hue app. */
  cloudSetPassphrase(passphrase: string): Promise<CloudStatus>;
  /** Signed-offer variants for an SDP offer (empty without a passphrase). */
  cloudSignOffer(sdp: string): Promise<{ name: string; fields: Record<string, string> }[]>;
  cloudSignOut(): Promise<CloudStatus>;
  cloudRefresh(): Promise<CloudStatus>;
  cloudSetHome(homeId: string): Promise<CloudStatus>;
  /** Wakes the camera and returns the signaling session for the renderer's WebRTC viewer. */
  cloudPrepareLiveView(cameraId: string): Promise<LiveViewSession>;
  /** Recent cloud/live-view log lines (for the diagnostics panel). */
  cloudLog(): Promise<string[]>;

  // camera engine: the real Philips Hue app in a hidden Android emulator, streamed into Hue Pilot
  getEmulatorStatus(): Promise<EmulatorStatus>;
  emulatorEnsureRunning(): Promise<EmulatorStatus>;
  emulatorOpenCamera(name: string): Promise<EmulatorStatus>;
  emulatorCloseCamera(): Promise<EmulatorStatus>;
  emulatorStartStream(): Promise<EmulatorStatus>;
  emulatorStopStream(): Promise<EmulatorStatus>;
  emulatorStop(): Promise<EmulatorStatus>;

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
  onEmulatorStatus(cb: (status: EmulatorStatus) => void): () => void;
  /** Raw Annex-B H.264 chunks of the camera engine's screen, or `{ restart: true }` when the stream re-keys. */
  onEmulatorFrame(cb: (frame: Uint8Array | { restart: true }) => void): () => void;
  onCloudStatus(cb: (status: CloudStatus) => void): () => void;
  onCloudLog(cb: (line: string) => void): () => void;
}

export interface CloudHome {
  id: string;
  name: string;
  /** Bridge ids linked to the home (from the account service). */
  bridges?: string[];
  /** Devices linked to the home: `type` is the model id (CMB001, CMW002, BSB003…), `id` the cloud device id. */
  devices?: { type: string; id: string }[];
  securityActivated?: boolean;
}

export interface CloudCamera {
  /** Device id as the cloud names it (usually the camera's MAC without separators). */
  id: string;
  name: string;
  model: string | null;
  online: boolean | null;
  /** Field names the cloud returned for this device (diagnostics only). */
  raw: string[];
  productName?: string | null;
  /** Battery percentage (battery cameras only). */
  battery?: number | null;
  /** Wi-Fi strength as the cloud reports it (0–4). */
  wifiStrength?: number | null;
  /** "Live view protection" (E2EE-signed live view) switched on for this camera. */
  liveViewProtected?: boolean | null;
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
  /** A system-browser sign-in is waiting for the redirect. */
  pendingLogin: { startedAt: number; method: 'browser' | 'clipboard' } | null;
  hasPassphrase: boolean;
}

/** The camera engine: the official Hue app running in a hidden Android emulator on this PC. */
export interface EmulatorStatus {
  /** Android SDK with adb and the emulator was found. */
  available: boolean;
  state: 'absent' | 'stopped' | 'starting' | 'booting' | 'preparing' | 'ready' | 'error';
  avd: string | null;
  serial: string | null;
  hueAppInstalled: boolean | null;
  /** Camera whose live view is open in the Hue app, if any. */
  camera: string | null;
  /** Camera names as the Hue app lists them on its Security page. */
  cameras: string[];
  /** Where the video sits on the emulator screen (pixels), so the renderer can crop to it. */
  videoBox: { x: number; y: number; w: number; h: number } | null;
  streaming: boolean;
  error: string | null;
  hint: string | null;
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

