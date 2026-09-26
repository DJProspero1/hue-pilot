import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import type { MirrorDevice, MirrorStatus } from '../shared/ipc-types.ts';

const execFileAsync = promisify(execFile);

/**
 * "Watch live on this PC": Hue Secure video only plays inside the Philips Hue app, so the desktop
 * mirrors the user's Android phone (scrcpy, Apache-2.0) and opens the Hue app in a window here.
 * scrcpy is downloaded on first use into the app's user-data folder (not bundled in the installer).
 */
export const SCRCPY_VERSION = '4.1';
export const SCRCPY_URL = `https://github.com/Genymobile/scrcpy/releases/download/v${SCRCPY_VERSION}/scrcpy-win64-v${SCRCPY_VERSION}.zip`;
export const HUE_APP_PACKAGE = 'com.philips.lighting.hue2';

/** Parses `adb devices -l` output. */
export function parseAdbDevices(text: string): MirrorDevice[] {
  const out: MirrorDevice[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^List of devices/i.test(line) || line.startsWith('*')) continue;
    const parts = line.split(/\s+/);
    const serial = parts[0];
    const state = parts[1] ?? 'unknown';
    if (!serial || serial === 'daemon') continue;
    const model = parts.find((p) => p.startsWith('model:'))?.slice(6).replace(/_/g, ' ') ?? null;
    const transport: MirrorDevice['transport'] = serial.startsWith('emulator-') ? 'emulator' : /^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(serial) || serial.includes('._adb-tls') ? 'wifi' : 'usb';
    out.push({ serial, state, model, transport });
  }
  return out;
}

/** A short instruction for the most common problems, derived from the device list and scrcpy's output. */
export function hintFor(devices: MirrorDevice[], stderr = '', appMissing = false): string | null {
  if (devices.some((d) => d.state === 'unauthorized')) return 'The phone is asking whether to allow USB debugging from this computer: tap "Allow" on the phone (tick "Always allow").';
  if (devices.some((d) => d.state === 'offline')) return 'The phone shows as offline: unplug and plug the cable again, or re-enable USB debugging.';
  if (appMissing || /Could not start app|not installed|No Activity found/i.test(stderr)) return 'The Philips Hue app is not installed on this phone. Install it from Google Play and sign in, then open it in the mirror window.';
  if (/Device disconnected/i.test(stderr)) return 'The phone was disconnected.';
  if (!devices.some((d) => d.state === 'device')) return 'No phone found. Enable USB debugging (Settings → Developer options) and connect the phone with a USB cable, or use Wireless debugging and enter its address below.';
  return null;
}

export class PhoneMirror extends EventEmitter {
  private child: ChildProcess | null = null;
  private installing = false;
  private progress: number | null = null;
  private error: string | null = null;
  private lastStderr = '';
  private devices: MirrorDevice[] = [];
  private busySerial: string | null = null;
  private appMissing = false;

  /** Where scrcpy is unpacked (the app passes `<userData>/scrcpy`). */
  readonly dir: string;

  constructor(dir: string) {
    super();
    this.dir = dir;
  }

  private get scrcpy() {
    return path.join(this.dir, 'scrcpy.exe');
  }
  private get adb() {
    return path.join(this.dir, 'adb.exe');
  }

  get installed(): boolean {
    return fs.existsSync(this.scrcpy) && fs.existsSync(this.adb);
  }

  status(): MirrorStatus {
    return {
      supported: process.platform === 'win32',
      installed: this.installed,
      installing: this.installing,
      progress: this.progress,
      running: this.child !== null,
      serial: this.busySerial,
      devices: this.devices,
      error: this.error,
      hint: hintFor(this.devices, this.lastStderr, this.appMissing),
      version: SCRCPY_VERSION,
      hueApp: HUE_APP_PACKAGE,
    };
  }

  private emitStatus() {
    this.emit('status', this.status());
  }

  /** Downloads and unpacks scrcpy (11 MB) into the user-data folder. Safe to call when already installed. */
  async install(): Promise<MirrorStatus> {
    if (this.installed) return this.status();
    if (process.platform !== 'win32') throw new Error('Phone mirroring is only available on Windows.');
    if (this.installing) return this.status();
    this.installing = true;
    this.progress = 0;
    this.error = null;
    this.emitStatus();
    const zip = path.join(os.tmpdir(), `scrcpy-${SCRCPY_VERSION}-${process.pid}.zip`);
    try {
      const res = await fetch(SCRCPY_URL);
      if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
      const total = Number(res.headers.get('content-length') ?? 0);
      const chunks: Buffer[] = [];
      let received = 0;
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(Buffer.from(value));
        received += value.byteLength;
        const next = total ? Math.round((received / total) * 100) : null;
        if (next !== this.progress) {
          this.progress = next;
          this.emitStatus();
        }
      }
      const data = Buffer.concat(chunks);
      if (data.length < 1_000_000) throw new Error('Downloaded file is too small to be scrcpy');
      fs.writeFileSync(zip, data);
      fs.rmSync(this.dir, { recursive: true, force: true });
      fs.mkdirSync(this.dir, { recursive: true });
      // bsdtar ships with Windows 10+ and understands zip files; the archive has one top-level folder.
      const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
      await execFileAsync(tar, ['-xf', zip, '-C', this.dir, '--strip-components=1']);
      if (!this.installed) throw new Error('scrcpy.exe was not found after unpacking');
    } catch (err) {
      this.error = `Could not install scrcpy: ${(err as Error).message}`;
      throw new Error(this.error);
    } finally {
      fs.rmSync(zip, { force: true });
      this.installing = false;
      this.progress = null;
      this.emitStatus();
    }
    return this.status();
  }

  async refreshDevices(): Promise<MirrorStatus> {
    if (!this.installed) {
      this.devices = [];
      return this.status();
    }
    try {
      const { stdout } = await execFileAsync(this.adb, ['devices', '-l'], { timeout: 15_000, windowsHide: true });
      this.devices = parseAdbDevices(stdout);
    } catch (err) {
      this.error = `adb failed: ${(err as Error).message}`;
    }
    this.emitStatus();
    return this.status();
  }

  /** `adb connect <ip:port>` for phones on Wireless debugging (pair them once from the phone's dialog). */
  async connect(address: string): Promise<MirrorStatus> {
    await this.install();
    const addr = address.trim();
    if (!/^[\w.-]+:\d{2,5}$/.test(addr)) throw new Error('Enter the address as IP:port, e.g. 192.168.1.50:5555');
    try {
      const { stdout, stderr } = await execFileAsync(this.adb, ['connect', addr], { timeout: 20_000, windowsHide: true });
      const text = `${stdout}${stderr}`.trim();
      this.error = /connected to/i.test(text) ? null : text || 'Could not connect';
    } catch (err) {
      this.error = `Could not connect: ${(err as Error).message}`;
    }
    return this.refreshDevices();
  }

  /** Opens the mirror window and starts the Philips Hue app on the phone. */
  async start(serial?: string): Promise<MirrorStatus> {
    await this.install();
    if (this.child) return this.status();
    await this.refreshDevices();
    const ready = this.devices.filter((d) => d.state === 'device');
    const target = serial ? ready.find((d) => d.serial === serial) : ready.find((d) => d.transport !== 'emulator') ?? ready[0];
    if (!target) {
      this.error = null;
      this.emitStatus();
      throw new Error(hintFor(this.devices) ?? 'No phone connected');
    }
    // Only ask scrcpy to launch the Hue app when it is actually installed; otherwise mirror anyway and explain.
    this.appMissing = !(await this.hasHueApp(target.serial));
    const args = [
      '-s', target.serial,
      '--window-title', 'Hue Secure – phone mirror',
      ...(this.appMissing ? [] : [`--start-app=+${HUE_APP_PACKAGE}`]),
      '--max-size', '1200',
      '--stay-awake', // keep the phone screen on while the window is open (scrcpy wakes the screen on start)
      '--always-on-top',
    ];
    this.lastStderr = '';
    this.error = null;
    this.busySerial = target.serial;
    const child = spawn(this.scrcpy, args, { cwd: this.dir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.child = child;
    const collect = (chunk: Buffer) => {
      this.lastStderr = (this.lastStderr + chunk.toString()).slice(-4000);
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.on('exit', (code) => {
      this.child = null;
      this.busySerial = null;
      if (code && code !== 0) {
        const line = this.lastStderr.split(/\r?\n/).filter((l) => /ERROR|WARN/.test(l)).pop();
        this.error = line ? line.replace(/^\[server\]\s*/, '') : `scrcpy exited with code ${code}`;
      }
      this.emitStatus();
      void this.refreshDevices();
    });
    child.on('error', (err) => {
      this.child = null;
      this.busySerial = null;
      this.error = `Could not start scrcpy: ${err.message}`;
      this.emitStatus();
    });
    this.emitStatus();
    return this.status();
  }

  stop(): MirrorStatus {
    this.child?.kill();
    return this.status();
  }

  private async hasHueApp(serial: string): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync(this.adb, ['-s', serial, 'shell', 'pm', 'path', HUE_APP_PACKAGE], { timeout: 15_000, windowsHide: true });
      return /package:/.test(stdout);
    } catch {
      return false;
    }
  }
}
