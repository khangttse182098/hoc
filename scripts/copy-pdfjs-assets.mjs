// Copies the PDF.js support assets (standard fonts, CMaps, WASM decoders, ICC
// profiles) from node_modules into public/pdfjs so the app can load them from
// its own origin and never needs the network. Runs on `postinstall`.
import { cpSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, 'node_modules/pdfjs-dist');
const dest = resolve(root, 'public/pdfjs');

if (!existsSync(src)) {
  console.error('pdfjs-dist is not installed; run npm install first.');
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
for (const dir of ['standard_fonts', 'cmaps', 'wasm', 'iccs']) {
  cpSync(resolve(src, dir), resolve(dest, dir), { recursive: true });
}
console.log('Copied PDF.js assets to public/pdfjs');
