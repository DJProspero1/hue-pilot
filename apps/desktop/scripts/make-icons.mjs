// Generates the app icon (PNG) and tray icon from an inline SVG using sharp.
import sharp from 'sharp';
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';

const svg = (size) => `
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffb347"/>
      <stop offset="0.55" stop-color="#ff6b6b"/>
      <stop offset="1" stop-color="#a855f7"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.42" r="0.5">
      <stop offset="0" stop-color="#fff7d6" stop-opacity="0.95"/>
      <stop offset="1" stop-color="#fff7d6" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect x="24" y="24" width="464" height="464" rx="112" fill="url(#bg)"/>
  <circle cx="256" cy="230" r="150" fill="url(#glow)"/>
  <path d="M256 118c-64 0-108 46-108 104 0 38 20 62 40 82 14 14 20 26 22 44h92c2-18 8-30 22-44 20-20 40-44 40-82 0-58-44-104-108-104z" fill="#ffffff" fill-opacity="0.96"/>
  <rect x="212" y="362" width="88" height="22" rx="11" fill="#ffffff" fill-opacity="0.9"/>
  <rect x="222" y="392" width="68" height="20" rx="10" fill="#ffffff" fill-opacity="0.8"/>
  <path d="M232 214c8-22 26-34 48-34" stroke="#ffb347" stroke-width="16" stroke-linecap="round" fill="none" opacity="0.9"/>
</svg>`;

const tray = `
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <path d="M32 6c-12 0-20 9-20 19.5 0 7 3.6 11.6 7.4 15.4 2.6 2.6 3.8 4.8 4.1 8.1h17c.3-3.3 1.5-5.5 4.1-8.1C48.4 37.1 52 32.5 52 25.5 52 15 44 6 32 6z" fill="#ffffff"/>
  <rect x="24" y="52" width="16" height="4" rx="2" fill="#ffffff"/>
  <rect x="26" y="58" width="12" height="3.5" rx="1.75" fill="#ffffff" opacity="0.8"/>
</svg>`;

mkdirSync('build', { recursive: true });
mkdirSync('resources', { recursive: true });
await sharp(Buffer.from(svg(512))).png().toFile('build/icon.png');
copyFileSync('build/icon.png', 'resources/icon.png');
await sharp(Buffer.from(tray)).resize(32, 32).png().toFile('resources/tray.png');
await sharp(Buffer.from(svg(256))).resize(256, 256).png().toFile('resources/icon-256.png');
writeFileSync('resources/logo.svg', svg(512).trim());
console.log('icons written');
