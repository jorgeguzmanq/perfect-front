import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { DetectionError } from "./types";

const MAX_BYTES = 1024 * 1024;

export function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

export function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function readTextSafe(p: string): string | null {
  try {
    const st = statSync(p);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    return readFileSync(p, "utf8").replace(/^\uFEFF/, "");
  } catch {
    return null;
  }
}

export function subdirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    return [];
  }
}

export interface PackageJson {
  name: string | null;
  packageManager: string | null;
  scripts: Record<string, string>;
  deps: Set<string>;
  workspaces: string[];
}

function strMap(v: unknown): Record<string, string> {
  const out: Record<string, string> = Object.create(null) as Record<string, string>;
  if (v && typeof v === "object" && !Array.isArray(v)) {
    for (const [k, val] of Object.entries(v)) if (typeof val === "string") out[k] = val;
  }
  return out;
}

/** Lee package.json sin lanzar por ausencia; lanza `invalid_config` si existe pero es ilegible. */
export function readPackageJson(dir: string): PackageJson | null {
  const file = path.join(dir, "package.json");
  if (!existsSync(file)) return null;
  const text = readTextSafe(file);
  let raw: unknown;
  try {
    raw = text === null ? undefined : JSON.parse(text);
  } catch {
    raw = undefined;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new DetectionError("invalid_config", "package.json inválido o demasiado grande");
  }
  const o = raw as Record<string, unknown>;
  const ws = o.workspaces;
  const wsList = Array.isArray(ws)
    ? ws
    : ws && typeof ws === "object" && Array.isArray((ws as { packages?: unknown }).packages)
      ? (ws as { packages: unknown[] }).packages
      : [];
  return {
    name: typeof o.name === "string" && o.name ? o.name : null,
    packageManager: typeof o.packageManager === "string" ? o.packageManager : null,
    scripts: strMap(o.scripts),
    deps: new Set([
      ...Object.keys(strMap(o.dependencies)),
      ...Object.keys(strMap(o.devDependencies)),
      ...Object.keys(strMap(o.peerDependencies)),
    ]),
    workspaces: wsList.filter((x): x is string => typeof x === "string"),
  };
}

/** Patrones de workspace de pnpm-workspace.yaml (parser mínimo de la lista `packages:`). */
export function readPnpmWorkspacePatterns(dir: string): string[] | null {
  const text = readTextSafe(path.join(dir, "pnpm-workspace.yaml"));
  if (text === null) return null;
  const out: string[] = [];
  let inPackages = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^packages\s*:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const m = /^\s+-\s+(.+?)\s*(#.*)?$/.exec(line);
      if (m) out.push((m[1] as string).replace(/^["']|["']$/g, ""));
      else if (/^\S/.test(line)) inPackages = false;
    }
  }
  return out;
}
