import { readdirSync, type Dirent } from "node:fs";
import path from "node:path";
import { isSafeHtmlEntry } from "@perfect-front/shared";

export const STATIC_IGNORED_DIRS: ReadonlySet<string> = new Set(["node_modules", "dist", "build", ".git", ".perfect-front"]);
export const MAX_STATIC_PAGES = 200;
const MAX_DEPTH = 2;

export interface StaticScan {
  /** Rutas relativas con `/`, ordenadas: profundidad y luego alfabético (`index.html` primero en la raíz). */
  pages: string[];
  truncated: boolean;
}

/**
 * Normaliza una ruta de página pedida por el usuario. Devuelve null si es absoluta,
 * contiene `..`, NUL, unidad de disco o no es un .html (nunca escapa de la raíz).
 */
export function normalizePagePath(input: string): string | null {
  if (typeof input !== "string" || input.length === 0 || input.length > 260 || input.includes("\0")) return null;
  let v = input.replace(/\\/g, "/");
  if (v.startsWith("/") || /^[A-Za-z]:/.test(v)) return null;
  while (v.startsWith("./")) v = v.slice(2);
  const segs = v.split("/").filter((s) => s !== ".");
  if (segs.some((s) => s === "" || s === "..")) return null;
  const out = segs.join("/");
  return isSafeHtmlEntry(out) ? out : null;
}

const isHtml = (name: string): boolean => /\.html$/i.test(name);
const skipDir = (name: string): boolean => name.startsWith(".") || STATIC_IGNORED_DIRS.has(name);

function entries(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  } catch {
    return [];
  }
}

/** ¿Hay .html directamente en `dir`? (sin símbolos ni dotfiles) */
export function hasRootHtml(dir: string): boolean {
  return entries(dir).some((e) => e.isFile() && !e.name.startsWith(".") && isHtml(e.name));
}

/** Páginas candidatas: primero la raíz; si no hay HTML allí, subcarpetas hasta profundidad 2. */
export function scanHtmlPages(dir: string, max = MAX_STATIC_PAGES): StaticScan {
  const pages: string[] = [];
  let truncated = false;
  const collect = (abs: string, rel: string): void => {
    for (const e of entries(abs)) {
      if (e.isFile() && !e.name.startsWith(".") && isHtml(e.name)) {
        if (pages.length >= max) {
          truncated = true;
          return;
        }
        pages.push(rel ? `${rel}/${e.name}` : e.name);
      }
    }
  };
  collect(dir, "");
  if (pages.length === 0 && !truncated) {
    let level: { abs: string; rel: string }[] = [{ abs: dir, rel: "" }];
    for (let depth = 1; depth <= MAX_DEPTH && !truncated; depth++) {
      const next: { abs: string; rel: string }[] = [];
      for (const l of level) {
        for (const e of entries(l.abs)) {
          if (e.isDirectory() && !skipDir(e.name)) next.push({ abs: path.join(l.abs, e.name), rel: l.rel ? `${l.rel}/${e.name}` : e.name });
        }
      }
      for (const n of next) {
        collect(n.abs, n.rel);
        if (truncated) break;
      }
      level = next;
    }
  }
  const depthOf = (p: string): number => p.split("/").length;
  pages.sort((a, b) => {
    const d = depthOf(a) - depthOf(b);
    if (d !== 0) return d;
    if (a === "index.html") return -1;
    if (b === "index.html") return 1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return { pages, truncated };
}

export interface StaticInfo {
  pages: string[];
  /** Página elegida; null si `status` es "needs_choice". */
  entry: string | null;
  status: "chosen" | "needs_choice";
  choice: "override" | "config" | "index" | "single" | null;
  truncated: boolean;
}
