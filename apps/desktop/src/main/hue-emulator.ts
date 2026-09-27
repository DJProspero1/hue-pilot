import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import type { EmulatorStatus } from '../shared/ipc-types.ts';

/**
 * Runs the real Philips Hue Android app in a hidden Android emulator on this PC and pulls its
 * screen into Hue Pilot as an H.264 stream, so Hue Secure live view works on the desktop.
 *
 * Why: Hue Secure cameras only start streaming when the official app asks over Signify's private
 * channel, which cannot be reproduced. The official app in an emulator can, and Google sign-in is
 * allowed there because the app opens real Chrome. The emulator's user-mode network cannot finish
 * WebRTC's UDP path, so UDP is blocked inside the emulator (except DNS and the emulator's own
 * subnet), which makes WebRTC fall back to the TURN relay over TCP — that connects in about a second.
 *
 * The emulator is kept running in the background (detached) so opening a camera is instant after
 * the first boot. Sign-in and the E2EE passphrase live in the AVD's own storage.
 */

export const HUE_APP_PACKAGE = 'com.philips.lighting.hue2';
const PREFERRED_AVD = 'huepilot';
const BOOT_TIMEOUT_MS = 180_000;
const APPEAR_TIMEOUT_MS = 90_000;

export interface EmulatorPaths {
  sdk: string;
  adb: string;
  emulator: string;
}

/** Android SDK with adb and the emulator, from the usual environment variables or the default install. */
export function findSdk(): EmulatorPaths | null {
  const candidates = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT, process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk') : null].filter((p): p is string => !!p);
  for (const sdk of candidates) {
    const adb = path.join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb');
    const emulator = path.join(sdk, 'emulator', process.platform === 'win32' ? 'emulator.exe' : 'emulator');
    if (fs.existsSync(adb) && fs.existsSync(emulator)) return { sdk, adb, emulator };
  }
  return null;
}

function run(file: string, args: string[], timeoutMs = 20_000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      const code = err && typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : err ? 1 : 0;
      resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Parses `adb devices -l` and returns the serial of a booted emulator, if any. */
export function parseEmulatorSerial(devicesOutput: string): string | null {
  for (const line of devicesOutput.split(/\r?\n/)) {
    const m = line.match(/^(emulator-\d+)\s+device\b/);
    if (m) return m[1];
  }
  return null;
}

/**
 * Finds the camera tile named [name] on the Hue app's Security page and returns its centre.
 * Camera tiles carry status lines under the name ("Camera\n Fair\n2 min ago"), which is what
 * distinguishes them from a room of the same name on the Home page.
 */
export function findTileCentre(uiXml: string, name: string): { x: number; y: number } | null {
  const b = findTileBounds(uiXml, name);
  return b ? { x: Math.round((b.x1 + b.x2) / 2), y: Math.round((b.y1 + b.y2) / 2) } : null;
}

export function findTileBounds(uiXml: string, name: string): { x1: number; y1: number; x2: number; y2: number } | null {
  const re = new RegExp(`content-desc="${escapeRegex(name)}&#10;[^"]*"[^>]*?bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`);
  const m = uiXml.match(re);
  if (!m) return null;
  const [x1, y1, x2, y2] = m.slice(1, 5).map(Number);
  return { x1, y1, x2, y2 };
}

const BOTTOM_NAV = /^(HOME|AUTOMATIONS|SYNC|EXPLORE|SETTINGS)$/;

/**
 * A safe point to tap inside [tile]: its centre, unless the app's bottom navigation bar covers the
 * lower part of the tile (the last camera on the Security page), in which case the centre of the
 * visible strip. Null when too little of the tile is visible, so the caller should scroll first.
 */
export function visibleTapPoint(uiXml: string, tile: { x1: number; y1: number; x2: number; y2: number }): { x: number; y: number } | null {
  const nav = findNodeBounds(uiXml, BOTTOM_NAV);
  let y2 = tile.y2;
  if (nav && nav.y1 < y2 && nav.y1 > tile.y1) y2 = nav.y1 - 8;
  if (y2 - tile.y1 < 120) return null; // too thin a strip to trust; scroll it into view instead
  return { x: Math.round((tile.x1 + tile.x2) / 2), y: Math.round((tile.y1 + y2) / 2) };
}

/** Bounds of the first node whose accessibility label matches [re] in a uiautomator dump. */
export function findNodeBounds(uiXml: string, re: RegExp): { x1: number; y1: number; x2: number; y2: number } | null {
  for (const m of uiXml.matchAll(/content-desc="([^"]*)"[^>]*?bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)) {
    if (re.test(m[1].replace(/&#10;/g, '\n'))) {
      const [x1, y1, x2, y2] = m.slice(2, 6).map(Number);
      return { x1, y1, x2, y2 };
    }
  }
  return null;
}

/**
 * The 16:9 video area of the Hue app's live view (portrait layout): the widest node below the
 * header that is roughly player-sized, minus the app's side margins.
 */
export function findVideoBox(uiXml: string): { x: number; y: number; w: number; h: number } | null {
  let best: { x1: number; y1: number; x2: number; y2: number } | null = null;
  for (const m of uiXml.matchAll(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)) {
    const [x1, y1, x2, y2] = m.slice(1, 5).map(Number);
    const w = x2 - x1;
    const h = y2 - y1;
    if (w >= 900 && h >= 500 && h <= 1000 && y1 > 300 && (!best || y1 < best.y1)) best = { x1, y1, x2, y2 };
  }
  if (!best) return null;
  const margin = 32;
  const w = best.x2 - best.x1 - 2 * margin;
  return { x: best.x1 + margin, y: best.y1, w, h: Math.round((w * 9) / 16) };
}

/** Screen size from the root node's bounds in a uiautomator dump (falls back to a phone portrait). */
export function screenSize(uiXml: string): { w: number; h: number } {
  let w = 0;
  let h = 0;
  for (const m of uiXml.matchAll(/bounds="\[0,0\]\[(\d+),(\d+)\]"/g)) {
    w = Math.max(w, Number(m[1]));
    h = Math.max(h, Number(m[2]));
  }
  return w && h ? { w, h } : { w: 1080, h: 2400 };
}

export interface EmulatorHostOptions {
  log?: (line: string) => void;
}

export class EmulatorHost extends EventEmitter {
  private readonly paths: EmulatorPaths | null;
  private readonly logFn: (line: string) => void;
  private st: EmulatorStatus;
  private serial: string | null = null;
  private starting: Promise<EmulatorStatus> | null = null;
  private stream: ChildProcess | null = null;
  private streamWanted = false;
  private emulatorProc: ChildProcess | null = null;

  constructor(opts: EmulatorHostOptions = {}) {
    super();
    this.paths = findSdk();
    this.logFn = opts.log ?? (() => undefined);
    this.st = {
      available: !!this.paths,
      state: this.paths ? 'stopped' : 'absent',
      avd: null,
      serial: null,
      hueAppInstalled: null,
      camera: null,
      videoBox: null,
      streaming: false,
      error: this.paths ? null : 'Android SDK with adb and the emulator was not found (ANDROID_HOME, ANDROID_SDK_ROOT or %LOCALAPPDATA%\\Android\\Sdk).',
      hint: null,
    };
  }

  private log(line: string) {
    this.logFn(line);
  }

  status(): EmulatorStatus {
    return { ...this.st, serial: this.serial, streaming: !!this.stream };
  }

  private set(patch: Partial<EmulatorStatus>) {
    Object.assign(this.st, patch);
    this.emit('status', this.status());
  }

  private adbArgs(...args: string[]): string[] {
    return this.serial ? ['-s', this.serial, ...args] : args;
  }

  private async adb(args: string[], timeoutMs = 20_000) {
    return run(this.paths!.adb, this.adbArgs(...args), timeoutMs);
  }

  private async shell(cmd: string, timeoutMs = 20_000): Promise<string> {
    const r = await this.adb(['shell', cmd], timeoutMs);
    return r.stdout.replace(/\r/g, '');
  }

  async listAvds(): Promise<string[]> {
    if (!this.paths) return [];
    const r = await run(this.paths.emulator, ['-list-avds']);
    return r.stdout.split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith('INFO'));
  }

  async connectedEmulator(): Promise<string | null> {
    if (!this.paths) return null;
    const r = await run(this.paths.adb, ['devices'], 15_000);
    return parseEmulatorSerial(r.stdout);
  }

  /** Starts the emulator if needed, waits for boot, applies the network fix and launches the Hue app. */
  ensureRunning(): Promise<EmulatorStatus> {
    if (this.starting) return this.starting;
    this.starting = this.ensureInner().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async ensureInner(): Promise<EmulatorStatus> {
    if (!this.paths) return this.status();
    try {
      this.set({ error: null, hint: null });
      let serial = await this.connectedEmulator();
      if (!serial) {
        const avds = await this.listAvds();
        const avd = avds.includes(PREFERRED_AVD) ? PREFERRED_AVD : avds[0];
        if (!avd) {
          this.set({ state: 'error', error: 'No Android emulator (AVD) exists. Create one in Android Studio (an x86_64 "Google APIs" image, Android 13 or newer) and install the Philips Hue app in it.' });
          return this.status();
        }
        this.set({ state: 'starting', avd });
        this.log(`Starting the camera engine (emulator "${avd}", hidden)…`);
        serial = await this.launchEmulator(avd);
        if (!serial) {
          this.set({ state: 'error', error: 'The emulator did not come up within 90 s. Open Android Studio → Device Manager and check that the AVD boots.' });
          return this.status();
        }
      } else {
        this.log(`Camera engine already running (${serial}).`);
      }
      this.serial = serial;
      this.set({ state: 'booting', serial });
      const booted = await this.waitForBoot();
      if (!booted) {
        this.set({ state: 'error', error: 'Android did not finish booting within 3 minutes.' });
        return this.status();
      }
      this.set({ state: 'preparing' });
      await this.applyNetworkFix();
      const installed = (await this.shell(`pm list packages ${HUE_APP_PACKAGE}`)).includes(HUE_APP_PACKAGE);
      this.set({ hueAppInstalled: installed });
      if (!installed) {
        this.set({ state: 'error', error: 'The Philips Hue app is not installed in the emulator. Install it (base + arm64 split APKs) and sign in once with the emulator window visible.' });
        return this.status();
      }
      await this.shell(`am start -W -n ${HUE_APP_PACKAGE}/.ContentActivity`, 30_000);
      this.set({ state: 'ready' });
      this.log('Camera engine ready.');
    } catch (err) {
      this.set({ state: 'error', error: (err as Error).message });
    }
    return this.status();
  }

  private async launchEmulator(avd: string): Promise<string | null> {
    const args = ['-avd', avd, '-no-window', '-no-audio', '-no-boot-anim', '-gpu', 'host', '-memory', '4096', '-cores', '4', '-netspeed', 'full', '-netdelay', 'none'];
    const proc = spawn(this.paths!.emulator, args, { detached: true, stdio: 'ignore', windowsHide: true });
    proc.unref();
    this.emulatorProc = proc;
    let exited = false;
    proc.on('exit', (code) => {
      exited = true;
      this.log(`Emulator process exited (${code}).`);
    });
    const t0 = Date.now();
    while (Date.now() - t0 < APPEAR_TIMEOUT_MS) {
      await sleep(2000);
      const serial = await this.connectedEmulator();
      if (serial) return serial;
      if (exited) return null;
    }
    return null;
  }

  private async waitForBoot(): Promise<boolean> {
    const t0 = Date.now();
    while (Date.now() - t0 < BOOT_TIMEOUT_MS) {
      const v = (await this.shell('getprop sys.boot_completed', 10_000)).trim();
      if (v === '1') return true;
      await sleep(3000);
    }
    return false;
  }

  /** Root + block UDP (except DNS and the emulator subnet) so WebRTC uses the TCP relay. Idempotent. */
  private async applyNetworkFix() {
    await this.adb(['root'], 15_000);
    await this.adb(['wait-for-device'], 30_000);
    const rules = [
      'iptables -C OUTPUT -p udp --dport 53 -j ACCEPT 2>/dev/null || iptables -I OUTPUT 1 -p udp --dport 53 -j ACCEPT',
      'iptables -C OUTPUT -p udp -d 10.0.2.0/24 -j ACCEPT 2>/dev/null || iptables -I OUTPUT 2 -p udp -d 10.0.2.0/24 -j ACCEPT',
      'iptables -C OUTPUT -p udp -j REJECT 2>/dev/null || iptables -A OUTPUT -p udp -j REJECT --reject-with icmp-port-unreachable',
    ];
    for (const r of rules) await this.shell(r, 15_000);
    const check = await this.shell('iptables -L OUTPUT -n 2>/dev/null | grep -c "REJECT.*udp"');
    this.log(`Network fix applied (${check.trim() || '0'} UDP reject rule).`);
  }

  private async uiDump(): Promise<string> {
    const r = await this.adb(['exec-out', 'uiautomator', 'dump', '/dev/tty'], 20_000);
    return r.stdout;
  }

  private async tap(b: { x1: number; y1: number; x2: number; y2: number }) {
    await this.shell(`input tap ${Math.round((b.x1 + b.x2) / 2)} ${Math.round((b.y1 + b.y2) / 2)}`);
  }

  /** Navigates the Hue app to [name]'s live view and turns the emulator to landscape. */
  async openCamera(name: string): Promise<EmulatorStatus> {
    await this.ensureRunning();
    if (this.st.state !== 'ready') return this.status();
    try {
      this.set({ error: null, videoBox: null });
      // Keep the phone portrait (the app's default); Hue Pilot crops the picture to the video box.
      await this.shell('settings put system accelerometer_rotation 0; wm user-rotation lock 0');
      await this.shell(`am start -W -n ${HUE_APP_PACKAGE}/.ContentActivity`, 30_000);
      await sleep(1500);
      // Navigate like a person: close an open live view, go to the Home tab, open the Security
      // tile, then pick the camera tile. Every step is found by its accessibility label.
      let xml = await this.uiDump();
      const closeBtn = findNodeBounds(xml, /^Close$/);
      if (closeBtn && findNodeBounds(xml, /^(Live view|Connection Issue|Connecting)/)) {
        await this.tap(closeBtn);
        await sleep(1500);
        xml = await this.uiDump();
      }
      let centre = findTileCentre(xml, name);
      if (!centre) {
        const homeTab = findNodeBounds(xml, /^HOME$/);
        if (homeTab) {
          await this.tap(homeTab);
          await sleep(1500);
          xml = await this.uiDump();
        }
        // On Home the security tile reads "Disarmed\nReady to arm" (two lines); tap it.
        const security = findNodeBounds(xml, /^(Disarmed|Armed)[^\n]*\n/);
        if (security) {
          await this.tap(security);
          await sleep(2500);
        } else {
          await this.shell(`am start -W -a android.intent.action.VIEW -d "hue://security_center/" ${HUE_APP_PACKAGE}`, 30_000);
          await sleep(2500);
        }
      }
      // Find the camera tile; scroll when it is missing or mostly hidden under the bottom navigation bar.
      let point: { x: number; y: number } | null = null;
      for (let attempt = 0; attempt < 8 && !point; attempt++) {
        xml = await this.uiDump();
        const tile = findTileBounds(xml, name);
        point = tile ? visibleTapPoint(xml, tile) : null;
        if (!point) {
          const size = screenSize(xml);
          const dy = tile ? Math.min(700, tile.y2 - tile.y1 + 200) : Math.round(size.h * 0.5);
          if (attempt >= 1 || tile) await this.shell(`input swipe ${Math.round(size.w / 2)} ${Math.round(size.h * 0.75)} ${Math.round(size.w / 2)} ${Math.round(size.h * 0.75) - dy} 300`);
          await sleep(1200);
        }
      }
      if (!point) throw new Error(`The camera "${name}" was not found on the Hue app's Security page.`);
      // Tap, then confirm the live view really opened (retry the tap once), and measure the video box.
      let videoBox: EmulatorStatus['videoBox'] = null;
      let opened = false;
      for (let round = 0; round < 2 && !opened; round++) {
        await this.shell(`input tap ${point.x} ${point.y}`);
        for (let attempt = 0; attempt < 6 && !opened; attempt++) {
          await sleep(1200);
          xml = await this.uiDump();
          if (findNodeBounds(xml, /^Live view$|^Connection Issue$|^Connecting/)) {
            opened = true;
            videoBox = findVideoBox(xml);
          }
        }
      }
      if (!opened) throw new Error(`Tapped "${name}" but the Hue app did not open its live view.`);
      this.set({ camera: name, videoBox });
      this.log(`Opened live view for ${name}.`);
    } catch (err) {
      this.set({ error: (err as Error).message });
    }
    return this.status();
  }

  async closeCamera(): Promise<EmulatorStatus> {
    if (this.st.state === 'ready' && this.serial) {
      try {
        const closeBtn = findNodeBounds(await this.uiDump(), /^Close$/);
        if (closeBtn) await this.tap(closeBtn);
        else await this.shell('input keyevent KEYCODE_BACK');
      } catch {
        /* ignore */
      }
    }
    this.set({ camera: null, videoBox: null });
    return this.status();
  }

  /** Streams the emulator screen as raw Annex-B H.264 ('frame' events); restarts every 3 minutes (screenrecord's limit). */
  startStream(): EmulatorStatus {
    this.streamWanted = true;
    if (!this.stream) this.spawnStream();
    return this.status();
  }

  private spawnStream() {
    if (!this.paths || !this.serial || !this.streamWanted) return;
    const proc = spawn(this.paths.adb, this.adbArgs('exec-out', 'screenrecord', '--output-format=h264', '--bit-rate', '6000000', '--time-limit', '180', '-'), { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    this.stream = proc;
    this.emit('status', this.status());
    proc.stdout?.on('data', (chunk: Buffer) => this.emit('frame', chunk));
    proc.on('exit', () => {
      if (this.stream === proc) this.stream = null;
      if (this.streamWanted) {
        this.emit('stream-restart');
        setTimeout(() => this.spawnStream(), 200);
      } else this.emit('status', this.status());
    });
  }

  stopStream(): EmulatorStatus {
    this.streamWanted = false;
    if (this.stream) {
      try {
        this.stream.kill();
      } catch {
        /* ignore */
      }
      this.stream = null;
    }
    return this.status();
  }

  async stopEmulator(): Promise<EmulatorStatus> {
    this.stopStream();
    if (this.serial) {
      await this.adb(['emu', 'kill'], 15_000).catch(() => undefined);
      this.serial = null;
    }
    this.set({ state: this.paths ? 'stopped' : 'absent', camera: null, serial: null });
    return this.status();
  }
}
