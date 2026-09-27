import { create } from 'zustand';
import { EMPTY_HOME, lightHex, type BridgeConnection, type GroupView, type HomeModel, type LightState, type LightView } from '@hue/core';
import { DEFAULT_SETTINGS, type ChatMessage, type ConnectionStatus, type MotionEvent, type Settings } from '../../shared/ipc-types.ts';

/** One screen. Settings and the assistant open as overlays on top of it. */
export type Route = { view: 'home' } | { view: 'settings' };

const MOTION_EVENT_LIMIT = 200;

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success';
}

interface Override {
  until: number;
  light?: Partial<LightView>;
  group?: Partial<GroupView>;
}

interface AppState {
  ready: boolean;
  home: HomeModel;
  status: ConnectionStatus;
  settings: Settings;
  connection: BridgeConnection | null;
  route: Route;
  /** Assistant slide-over. */
  assistantOpen: boolean;
  /** Room/zone card showing its lights. */
  expandedGroup: string | null;
  /** Camera the dashboard should be watching (from tray/shortcuts), or null. */
  wantedCamera: string | null;
  lightSheet: string | null;
  toasts: Toast[];
  chat: ChatMessage[];
  chatBusy: boolean;
  search: string;
  overrides: Record<string, Override>;
  initError: string | null;
  /** Motion timeline (cameras + sensors), newest first. */
  motionEvents: MotionEvent[];

  init(): Promise<void>;
  initInner(): Promise<void>;
  navigate(route: Route): void;
  toggleAssistant(open?: boolean): void;
  expandGroup(id: string | null): void;
  setWantedCamera(name: string | null): void;
  openLight(id: string | null): void;
  toast(text: string, kind?: Toast['kind']): void;
  dismissToast(id: number): void;
  setSearch(search: string): void;
  setLight(id: string, state: LightState): Promise<void>;
  setGroup(id: string, state: LightState): Promise<void>;
  recallScene(id: string, action?: 'active' | 'dynamic_palette' | 'static'): Promise<void>;
  sendChat(text: string): Promise<void>;
  resetChat(): Promise<void>;
  updateSettings(patch: Partial<Settings>): Promise<void>;
  refreshConnection(): Promise<void>;
  applyHome(home: HomeModel): void;
}

let toastSeq = 0;
const OVERRIDE_MS = 900;

function applyOverrides(home: HomeModel, overrides: Record<string, Override>): HomeModel {
  const now = Date.now();
  const active = Object.entries(overrides).filter(([, o]) => o.until > now);
  if (!active.length) return home;
  const lightById = { ...home.lightById };
  const groupById = { ...home.groupById };
  let homeGroup = home.home;
  for (const [id, o] of active) {
    if (o.light && lightById[id]) {
      const merged = { ...lightById[id], ...o.light };
      merged.hex = lightHex(merged);
      lightById[id] = merged;
    }
    if (o.group) {
      if (groupById[id]) groupById[id] = { ...groupById[id], ...o.group };
      else if (homeGroup && homeGroup.id === id) homeGroup = { ...homeGroup, ...o.group };
    }
  }
  const lights = home.lights.map((l) => lightById[l.id] ?? l);
  const groups = home.groups.map((g) => groupById[g.id] ?? g);
  return {
    ...home,
    lights,
    lightById,
    groups,
    groupById,
    rooms: groups.filter((g) => g.kind === 'room'),
    zones: groups.filter((g) => g.kind === 'zone'),
    home: homeGroup,
    totalLightsOn: lights.filter((l) => l.on).length,
  };
}

function applyTheme(theme: Settings['theme']) {
  const dark = theme === 'system' ? window.matchMedia('(prefers-color-scheme: dark)').matches : theme === 'dark';
  document.documentElement.classList.toggle('dark', dark);
}

function speak(text: string) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  } catch {
    /* unsupported */
  }
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  home: EMPTY_HOME,
  status: { state: 'disconnected', stream: 'closed' },
  settings: DEFAULT_SETTINGS,
  connection: null,
  route: { view: 'home' },
  assistantOpen: false,
  expandedGroup: null,
  wantedCamera: null,
  lightSheet: null,
  toasts: [],
  chat: [],
  chatBusy: false,
  search: '',
  overrides: {},
  initError: null,
  motionEvents: [],

  async init() {
    try {
      await get().initInner();
    } catch (err) {
      set({ initError: (err as Error).message ?? String(err), ready: true });
    }
  },

  async initInner() {
    // Subscribe before the first fetches: the bridge usually connects while this runs, and a
    // status event that arrived before the listener existed used to leave the UI on "connecting".
    window.hue.onHome((home) => get().applyHome(home));
    window.hue.onStatus((status) => set({ status }));
    window.hue.onMotionEvent((event) => {
      const current = get().motionEvents;
      if (current.some((e) => e.id === event.id)) return;
      set({ motionEvents: [event, ...current].slice(0, MOTION_EVENT_LIMIT) });
    });
    window.hue.onSettings((settings) => {
      applyTheme(settings.theme);
      set({ settings });
    });
    window.hue.onChatEvent((m) => {
      const chat = get().chat;
      if (chat.some((x) => x.id === m.id)) return;
      set({ chat: [...chat, m] });
      if (m.role === 'assistant' && get().settings.speakReplies) speak(m.text);
    });
    window.hue.onNavigate((route) => {
      // Tray / shortcuts: "room:<id>", "light:<id>", "camera:<name>", "settings", "assistant", anything else = home.
      const idx = route.indexOf(':');
      const view = idx >= 0 ? route.slice(0, idx) : route;
      const id = idx >= 0 ? route.slice(idx + 1) : '';
      if (view === 'room' && id) set({ route: { view: 'home' }, expandedGroup: id, lightSheet: null });
      else if (view === 'light' && id) set({ route: { view: 'home' }, lightSheet: id });
      else if (view === 'camera' && id) set({ route: { view: 'home' }, wantedCamera: id });
      else if (view === 'settings') set({ route: { view: 'settings' } });
      else if (view === 'assistant') set({ route: { view: 'home' }, assistantOpen: true });
      else set({ route: { view: 'home' } });
    });
    const [settings, connection, chat] = await Promise.all([window.hue.getSettings(), window.hue.getConnection(), window.hue.getChatHistory()]);
    applyTheme(settings.theme);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applyTheme(get().settings.theme));
    set({ settings, connection, chat });
    if (connection) {
      try {
        const home = await window.hue.getHome();
        get().applyHome(home);
      } catch {
        /* status event will explain */
      }
      window.hue
        .getMotionEvents()
        .then((motionEvents) => set({ motionEvents }))
        .catch(() => undefined);
    }
    set({ status: await window.hue.getStatus(), ready: true });
  },

  applyHome(home) {
    // A disconnect sends EMPTY_HOME (updatedAt 0); the main process also drops its motion timeline then.
    set({ home: applyOverrides(home, get().overrides), ...(home.updatedAt === 0 ? { motionEvents: [] } : {}) });
  },

  navigate(route) {
    set({ route, lightSheet: null });
  },

  toggleAssistant(open) {
    set({ assistantOpen: open ?? !get().assistantOpen });
  },

  expandGroup(id) {
    set({ expandedGroup: get().expandedGroup === id ? null : id });
  },

  setWantedCamera(name) {
    set({ wantedCamera: name });
  },

  openLight(id) {
    set({ lightSheet: id });
  },

  toast(text, kind = 'info') {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts, { id, text, kind }] });
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 6000 : 3200);
  },

  dismissToast(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  },

  setSearch(search) {
    set({ search });
  },

  async setLight(id, state) {
    const { home, overrides } = get();
    const l = home.lightById[id];
    if (l) {
      const patch: Partial<LightView> = {};
      if (state.on !== undefined) patch.on = state.on;
      if (state.brightness !== undefined) {
        patch.brightness = state.brightness;
        if (state.on === undefined) patch.on = true;
      }
      if (state.xy) {
        patch.xy = state.xy;
        patch.colorMode = 'xy';
        patch.on = state.on ?? true;
      }
      if (state.mirek !== undefined) {
        patch.mirek = state.mirek;
        patch.kelvin = Math.round(1e6 / state.mirek);
        patch.colorMode = 'ct';
        patch.on = state.on ?? true;
      }
      if (state.effect !== undefined) patch.effect = state.effect;
      const next = { ...overrides, [id]: { until: Date.now() + OVERRIDE_MS, light: patch } };
      set({ overrides: next, home: applyOverrides(home, next) });
    }
    try {
      await window.hue.setLight(id, state);
    } catch (err) {
      get().toast((err as Error).message, 'error');
    }
  },

  async setGroup(id, state) {
    const { home, overrides } = get();
    const g = home.groupById[id] ?? (home.home?.id === id ? home.home : undefined);
    if (g) {
      const patch: Partial<GroupView> = {};
      if (state.on !== undefined) {
        patch.on = state.on;
        patch.anyOn = state.on;
      }
      if (state.brightness !== undefined) {
        patch.brightness = state.brightness;
        if (state.on === undefined) {
          patch.on = true;
          patch.anyOn = true;
        }
      }
      const next: Record<string, Override> = { ...overrides, [id]: { until: Date.now() + OVERRIDE_MS, group: patch } };
      for (const lid of g.lightIds) {
        const lp: Partial<LightView> = {};
        if (patch.on !== undefined) lp.on = patch.on;
        if (state.brightness !== undefined) lp.brightness = state.brightness;
        if (state.xy) {
          lp.xy = state.xy;
          lp.colorMode = 'xy';
        }
        if (state.mirek !== undefined) {
          lp.mirek = state.mirek;
          lp.kelvin = Math.round(1e6 / state.mirek);
          lp.colorMode = 'ct';
        }
        if (Object.keys(lp).length) next[lid] = { until: Date.now() + OVERRIDE_MS, light: lp };
      }
      set({ overrides: next, home: applyOverrides(home, next) });
    }
    try {
      await window.hue.setGroup(id, state);
    } catch (err) {
      get().toast((err as Error).message, 'error');
    }
  },

  async recallScene(id, action = 'active') {
    try {
      await window.hue.recallScene(id, action);
    } catch (err) {
      get().toast((err as Error).message, 'error');
    }
  },

  async sendChat(text) {
    if (!text.trim() || get().chatBusy) return;
    set({ chatBusy: true });
    try {
      await window.hue.chat(text.trim());
    } catch (err) {
      get().toast((err as Error).message, 'error');
    } finally {
      set({ chatBusy: false });
    }
  },

  async resetChat() {
    await window.hue.resetChat();
    set({ chat: [] });
  },

  async updateSettings(patch) {
    const settings = await window.hue.updateSettings(patch);
    applyTheme(settings.theme);
    set({ settings });
  },

  async refreshConnection() {
    const connection = await window.hue.getConnection();
    set({ connection });
  },
}));

export const selectRoomLights = (home: HomeModel, group: GroupView): LightView[] =>
  group.lightIds.map((id) => home.lightById[id]).filter(Boolean);
