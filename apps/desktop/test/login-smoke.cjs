// Manual smoke check: opens the Hue sign-in page inside an Electron window the way the app does,
// logs every main-frame request and saves screenshots. Usage (from apps/desktop, Git Bash):
//   LOGIN_URL="<authorize url>" LOGIN_OUT="C:\path\login.png" env -u ELECTRON_RUN_AS_NODE <electron.exe> ./test/login-smoke.cjs
const { app, BrowserWindow, session } = require('electron');
const fs = require('node:fs');

const url = process.env.LOGIN_URL;
const out = process.env.LOGIN_OUT;
const partition = process.env.LOGIN_PARTITION || 'hue-login-smoke';
process.on('unhandledRejection', (e) => {
  console.error('unhandled', e);
  app.exit(3);
});
setTimeout(() => {
  console.error('timeout');
  app.exit(4);
}, 40_000);

app.whenReady().then(async () => {
  try {
    const ses = session.fromPartition(partition);
    const seen = [];
    ses.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, cb) => {
      if (details.resourceType === 'mainFrame') seen.push(`${details.method} ${details.url.slice(0, 400)}${details.uploadData ? ' [body ' + details.uploadData.map((u) => (u.bytes ? u.bytes.toString().slice(0, 200) : '')).join('|') + ']' : ''}`);
      cb({});
    });
    const win = new BrowserWindow({ width: 480, height: 760, show: true, webPreferences: { sandbox: true, contextIsolation: true, partition } });
    const ua0 = win.webContents.getUserAgent();
    const ua = ua0.replace(/\s?[\w.-]+\/[\d.]+\s?(?=Chrome\/)/, ' ').replace(/\sElectron\/[\d.]+/, '').replace(/\s{2,}/g, ' ');
    win.webContents.setUserAgent(ua);
    win.webContents.on('will-redirect', (_e, u) => seen.push('REDIRECT ' + u.slice(0, 400)));
    await win.loadURL(url).catch((e) => seen.push('load error ' + e.message));
    await new Promise((r) => setTimeout(r, 1200));
    fs.writeFileSync(out.replace(/\.png$/, '-early.png'), (await win.webContents.capturePage()).toPNG());
    await new Promise((r) => setTimeout(r, 6000));
    fs.writeFileSync(out, (await win.webContents.capturePage()).toPNG());
    const text = await win.webContents.executeJavaScript('document.body ? document.body.innerText.slice(0, 300) : ""').catch((e) => 'js error ' + e.message);
    console.log(JSON.stringify({ title: win.getTitle(), final: win.webContents.getURL().slice(0, 300), seen, text }, null, 1));
  } catch (e) {
    console.error('failed', e);
  }
  app.exit(0);
});
