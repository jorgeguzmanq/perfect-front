import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const VITE_CONFIG_FILES = ["ts", "mts", "js", "mjs", "cts", "cjs"].map((e) => `vite.config.${e}`);

export function findViteConfig(projectDir: string): string | null {
  for (const f of VITE_CONFIG_FILES) {
    const p = path.join(projectDir, f);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** Contenido del `vite.pf.config.mjs` envoltorio: importa la config del usuario (si existe) y le antepone el plugin. */
export function renderWrapperConfig(opts: { baseConfig: string | null; pluginEntry: string; root: string }): string {
  const q = (s: string): string => JSON.stringify(s.replace(/\\/g, "/"));
  return [
    "// Generado por Perfect Front fuera del proyecto. No editar: se reescribe en cada arranque.",
    opts.baseConfig ? `import base from ${q(opts.baseConfig)};` : "const base = {};",
    `import { perfectFrontSource } from ${q(opts.pluginEntry)};`,
    "",
    "export default async (env) => {",
    "  const cfg = typeof base === 'function' ? await base(env) : { ...base };",
    `  cfg.plugins = [perfectFrontSource({ root: ${q(opts.root)} }), ...(cfg.plugins ?? [])];`,
    "  return cfg;",
    "};",
    "",
  ].join("\n");
}

/**
 * Escribe la config envoltorio en `<stateDir>/wrappers/<hash>/vite.pf.config.mjs` (NUNCA dentro del
 * proyecto del usuario) y devuelve su ruta absoluta.
 */
export function writeWrapperConfig(opts: { stateDir: string; projectDir: string }): string {
  const projectDir = path.resolve(opts.projectDir);
  const hash = createHash("sha256").update(projectDir.toLowerCase()).digest("hex").slice(0, 12);
  const dir = path.join(path.resolve(opts.stateDir), "wrappers", hash);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "vite.pf.config.mjs");
  const pluginEntry = fileURLToPath(new URL("./vite.ts", import.meta.url));
  fs.writeFileSync(file, renderWrapperConfig({ baseConfig: findViteConfig(projectDir), pluginEntry, root: projectDir }));
  return file;
}
