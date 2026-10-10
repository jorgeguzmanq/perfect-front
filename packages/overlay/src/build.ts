/** Solo Node. Empaqueta `src/boot.ts` como un único script IIFE inyectable por el proxy. */
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));

/** `import css from 'x.css?inline'` -> el CSS como string (equivalente al ?inline de Vite). */
const inlineCss: Plugin = {
  name: 'pf-inline-css',
  setup(b) {
    b.onResolve({ filter: /\.css\?inline$/ }, async (args) => {
      const r = await b.resolve(args.path.replace(/\?inline$/, ''), {
        kind: args.kind,
        resolveDir: args.resolveDir,
      });
      if (r.errors.length) return { errors: r.errors };
      return { path: r.path, namespace: 'pf-css' };
    });
    b.onLoad({ filter: /.*/, namespace: 'pf-css' }, async (args) => ({
      contents: await readFile(args.path, 'utf8'),
      loader: 'text',
    }));
  },
};

/** Devuelve el JS del overlay (IIFE, navegador, sin dependencias externas). */
export async function buildOverlayBundle(): Promise<string> {
  const result = await build({
    entryPoints: [resolve(here, 'boot.ts')],
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
    logLevel: 'silent',
    plugins: [inlineCss],
    define: { 'process.env.NODE_ENV': '"production"' },
  });
  const out = result.outputFiles[0];
  if (!out) throw new Error('esbuild no produjo salida para el overlay');
  return out.text;
}
