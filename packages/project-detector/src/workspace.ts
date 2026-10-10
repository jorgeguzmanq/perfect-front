import path from "node:path";
import { isDir, readPackageJson, readPnpmWorkspacePatterns, subdirs } from "./fs";

const MAX_DEPTH = 4;

export function workspacePatterns(dir: string): string[] | null {
  const pnpm = readPnpmWorkspacePatterns(dir);
  let pkg: string[] = [];
  try {
    pkg = readPackageJson(dir)?.workspaces ?? [];
  } catch {
    /* package.json roto: se reportará al leerlo como proyecto */
  }
  const all = [...(pnpm ?? []), ...pkg];
  return pnpm === null && pkg.length === 0 ? null : all;
}

const segs = (p: string): string[] => p.replace(/\\/g, "/").replace(/^\.\//, "").split("/").filter(Boolean);

function matches(rel: string[], pat: string[]): boolean {
  if (pat.length === 0) return rel.length === 0;
  const [p, ...rest] = pat as [string, ...string[]];
  if (p === "**") {
    for (let i = 0; i <= rel.length; i++) if (matches(rel.slice(i), rest)) return true;
    return false;
  }
  if (rel.length === 0) return false;
  return (p === "*" || p === rel[0]) && matches(rel.slice(1), rest);
}

/** ¿`target` pertenece a los patrones de workspace de `wsRoot`? */
export function isWorkspaceMember(wsRoot: string, patterns: string[], target: string): boolean {
  const rel = segs(path.relative(wsRoot, target));
  if (rel.length === 0 || rel[0] === "..") return false;
  const pos = patterns.filter((p) => !p.startsWith("!")).map(segs);
  const neg = patterns.filter((p) => p.startsWith("!")).map((p) => segs(p.slice(1)));
  return pos.some((p) => matches(rel, p)) && !neg.some((p) => matches(rel, p));
}

/** Expande patrones a carpetas existentes, en orden determinista. */
export function expandWorkspace(wsRoot: string, patterns: string[]): string[] {
  const found = new Set<string>();
  const neg = patterns.filter((p) => p.startsWith("!")).map((p) => segs(p.slice(1)));
  const walk = (dir: string, pat: string[], depth: number): void => {
    if (depth > MAX_DEPTH) return;
    if (pat.length === 0) {
      found.add(dir);
      return;
    }
    const [p, ...rest] = pat as [string, ...string[]];
    if (p === "**") {
      walk(dir, rest, depth);
      for (const d of subdirs(dir)) if (d !== "node_modules" && !d.startsWith(".")) walk(path.join(dir, d), pat, depth + 1);
    } else if (p === "*") {
      for (const d of subdirs(dir)) if (d !== "node_modules" && !d.startsWith(".")) walk(path.join(dir, d), rest, depth + 1);
    } else {
      const next = path.join(dir, p);
      if (isDir(next)) walk(next, rest, depth + 1);
    }
  };
  for (const p of patterns) if (!p.startsWith("!")) walk(wsRoot, segs(p), 0);
  return [...found]
    .filter((d) => d !== wsRoot && !neg.some((n) => matches(segs(path.relative(wsRoot, d)), n)))
    .sort();
}
