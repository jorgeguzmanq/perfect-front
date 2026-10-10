import path from "node:path";
import { isFile, readTextSafe, type PackageJson } from "./fs";
import type { FrameworkInfo, PackageManagerName } from "./types";

export const VITE_CONFIGS = ["ts", "mts", "js", "mjs", "cts", "cjs"].map((e) => `vite.config.${e}`);
export const NEXT_CONFIGS = ["js", "mjs", "cjs", "ts", "mts"].map((e) => `next.config.${e}`);
export const DEFAULT_VITE_PORT = 5173;
export const DEFAULT_NEXT_PORT = 3000;
export const DEFAULT_ANGULAR_PORT = 4200;

const UI_MARKERS = [
  ["react", ["react", "@vitejs/plugin-react", "@vitejs/plugin-react-swc"]],
  ["vue", ["vue", "@vitejs/plugin-vue"]],
  ["svelte", ["svelte", "@sveltejs/vite-plugin-svelte"]],
] as const;

export type FrameworkKind = "vite" | "next" | "angular";

export interface FrameworkHit {
  kind: FrameworkKind;
  evidence: string[];
  info: FrameworkInfo;
  /** Solo hay la dependencia (sin config ni script): evidencia débil que no debe ganar a otro framework. */
  weak: boolean;
}

const scriptMatching = (pkg: PackageJson | null, re: RegExp): [string, string] | undefined =>
  pkg ? Object.entries(pkg.scripts).find(([, v]) => re.test(v)) : undefined;

export function detectVite(dir: string, pkg: PackageJson | null): FrameworkHit | null {
  const evidence: string[] = [];
  if (pkg?.deps.has("vite")) evidence.push("dependencia `vite`");
  const cfg = VITE_CONFIGS.find((f) => isFile(path.join(dir, f)));
  if (cfg) evidence.push(`archivo ${cfg}`);
  const viteScript = scriptMatching(pkg, /(^|[\s;&|])vite(\s|$)/);
  if (viteScript) evidence.push(`script \`${viteScript[0]}\` invoca vite`);
  if (evidence.length === 0) return null;
  const ui = UI_MARKERS.find(([, names]) => names.some((n) => pkg?.deps.has(n)))?.[0] ?? null;
  return { kind: "vite", evidence, info: { bundler: "vite", ui }, weak: !cfg && !viteScript };
}

export function detectNext(dir: string, pkg: PackageJson | null): FrameworkHit | null {
  const evidence: string[] = [];
  if (pkg?.deps.has("next")) evidence.push("dependencia `next`");
  const cfg = NEXT_CONFIGS.find((f) => isFile(path.join(dir, f)));
  if (cfg) evidence.push(`archivo ${cfg}`);
  const s = scriptMatching(pkg, /(^|[\s;&|=])next\s+dev(\s|$)/);
  if (s) evidence.push(`script \`${s[0]}\` invoca next dev`);
  if (evidence.length === 0) return null;
  return { kind: "next", evidence, info: { runtime: "next", ui: "react" }, weak: !cfg && !s && !pkg?.deps.has("next") };
}

export function detectAngular(dir: string, pkg: PackageJson | null): FrameworkHit | null {
  const evidence: string[] = [];
  if (isFile(path.join(dir, "angular.json"))) evidence.push("archivo angular.json");
  if (pkg?.deps.has("@angular/cli")) evidence.push("dependencia `@angular/cli`");
  const s = scriptMatching(pkg, /(^|[\s;&|=])ng\s+(serve|s)(\s|$)/);
  if (s) evidence.push(`script \`${s[0]}\` invoca ng serve`);
  if (evidence.length === 0) return null;
  return { kind: "angular", evidence, info: { runtime: "angular", ui: "angular" }, weak: false };
}

/** Prioridad fija: Vite > Next > Angular. Una dependencia `vite` suelta no gana a Next/Angular con evidencia propia. */
export function detectFramework(dir: string, pkg: PackageJson | null): FrameworkHit | null {
  const vite = detectVite(dir, pkg);
  const next = detectNext(dir, pkg);
  const ng = detectAngular(dir, pkg);
  if (vite && !(vite.weak && (next || ng))) return vite;
  return next ?? ng;
}

/** `[command, args]` para ejecutar un binario local del proyecto con el gestor de paquetes (sin shell). */
export function execPlan(pm: PackageManagerName, bin: string, args: string[]): { command: string; args: string[] } {
  switch (pm) {
    case "pnpm":
      return { command: "pnpm", args: ["exec", bin, ...args] };
    case "yarn":
      return { command: "yarn", args: [bin, ...args] };
    case "bun":
      return { command: "bunx", args: [bin, ...args] };
    default:
      return { command: "npx", args: [bin, ...args] };
  }
}

/** Elige el script que ejecuta `re`, probando primero los nombres dados; ambiguo -> lista de candidatos. */
export function pickScript(pkg: PackageJson | null, names: string[], re: RegExp): { name: string | null; ambiguous: string[] } {
  if (!pkg) return { name: null, ambiguous: [] };
  const ok = (n: string): boolean => {
    const s = pkg.scripts[n];
    return s !== undefined && re.test(s);
  };
  for (const n of names) if (ok(n)) return { name: n, ambiguous: [] };
  const others = Object.keys(pkg.scripts).filter((n) => !names.includes(n) && ok(n)).sort();
  if (others.length === 1) return { name: others[0] as string, ambiguous: [] };
  return { name: null, ambiguous: others };
}

/** Puerto declarado en el texto de un script: `--port 4000`, `-p 4000`, `PORT=4000 next dev`. */
export function portFromScript(scriptText: string | undefined, acceptEnv: boolean): { port: number; source: string } | null {
  if (!scriptText) return null;
  const flag = /(?:--port[=\s]+|\s-p[=\s]*)(\d{2,5})\b/.exec(scriptText);
  if (flag) return { port: Number(flag[1]), source: "flag --port del script" };
  if (acceptEnv) {
    const env = /(?:^|[\s;&|])(?:cross-env\s+)?PORT=(\d{2,5})\b/.exec(scriptText);
    if (env) return { port: Number(env[1]), source: "PORT=… del script" };
  }
  return null;
}

// --- Angular: angular.json ---------------------------------------------------------------------------------------

export interface AngularProject {
  name: string;
  /** Puerto de `serve.options.port`, si lo fija. */
  port: number | null;
}

export interface AngularWorkspace {
  /** Proyectos con target `serve` (aplicaciones), orden alfabético. */
  apps: AngularProject[];
  /** `defaultProject` legado (angular.json antiguos), si existe y es una app. */
  defaultProject: string | null;
}

export function readAngularWorkspace(dir: string): AngularWorkspace | null {
  const text = readTextSafe(path.join(dir, "angular.json"));
  if (text === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { projects?: unknown; defaultProject?: unknown };
  const projects = o.projects && typeof o.projects === "object" ? (o.projects as Record<string, unknown>) : {};
  const apps: AngularProject[] = [];
  for (const name of Object.keys(projects).sort()) {
    const p = projects[name] as { architect?: Record<string, unknown>; targets?: Record<string, unknown> } | null;
    const targets = p?.architect ?? p?.targets;
    const serve = targets?.serve as { options?: { port?: unknown } } | undefined;
    if (!serve) continue;
    const port = serve.options?.port;
    apps.push({ name, port: typeof port === "number" && Number.isInteger(port) ? port : null });
  }
  const def = typeof o.defaultProject === "string" && apps.some((a) => a.name === o.defaultProject) ? o.defaultProject : null;
  return { apps, defaultProject: def };
}

/** ¿El texto del script ya nombra el proyecto (`ng serve web`, `--project web`)? */
export function scriptNamesAngularProject(scriptText: string | undefined, apps: AngularProject[]): string | null {
  if (!scriptText) return null;
  const tokens = scriptText.split(/\s+/);
  const i = tokens.findIndex((t, idx) => (t === "serve" || t === "s") && tokens[idx - 1]?.endsWith("ng"));
  const after = i >= 0 ? tokens.slice(i + 1) : tokens;
  const named = /--project[=\s]+([^\s]+)/.exec(scriptText)?.[1];
  if (named && apps.some((a) => a.name === named)) return named;
  const pos = after.find((t) => !t.startsWith("-"));
  return pos && apps.some((a) => a.name === pos) ? pos : null;
}
