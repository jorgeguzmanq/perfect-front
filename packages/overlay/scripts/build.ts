import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOverlayBundle } from '../src/build';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/overlay.js');
const js = await buildOverlayBundle();
await mkdir(dirname(out), { recursive: true });
await writeFile(out, js, 'utf8');
console.warn(`overlay.js escrito en ${out} (${(js.length / 1024).toFixed(1)} KiB)`);
