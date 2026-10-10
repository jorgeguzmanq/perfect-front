import path from "node:path";
import {
  CollectionNameSchema,
  CommentIdSchema,
  PerfectFrontError,
  isWindowsReservedName,
  type CollectionName,
  type CommentId,
} from "@perfect-front/shared";

export const PF_DIR = ".perfect-front";

/** Límites de tamaño de lectura/escritura (bytes). */
export const STORAGE_LIMITS = {
  commentFile: 512 * 1024,
  configFile: 64 * 1024,
  attachment: 7_000_000,
  gitignore: 1024 * 1024,
  export: 16 * 1024 * 1024,
} as const;

/** `target` está dentro de `base` (o es igual). Respeta mayúsculas según el SO. */
export function isInside(base: string, target: string): boolean {
  const rel = path.relative(base, target);
  if (rel === "") return true;
  if (path.isAbsolute(rel)) return false;
  return rel !== ".." && !rel.startsWith(".." + path.sep);
}

export function parseCommentId(value: unknown): CommentId {
  const r = CommentIdSchema.safeParse(value);
  if (!r.success) throw new PerfectFrontError("invalid_id", "ID de comentario inválido");
  return r.data;
}

export function parseCollectionName(value: unknown): CollectionName {
  const r = CollectionNameSchema.safeParse(value);
  if (!r.success) throw new PerfectFrontError("invalid_collection", "Nombre de colección inválido");
  return r.data;
}

// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[\u0000-\u001F\u007F<>:"/\\|?*]/;

/** Nombre de archivo plano (sin separadores, `..`, control ni reservados de Windows). */
export function assertPlainFileName(name: string): string {
  if (
    typeof name !== "string" ||
    name.length === 0 ||
    name.length > 200 ||
    name === "." ||
    name.includes("..") ||
    BAD_CHARS.test(name) ||
    name.endsWith(".") ||
    name.endsWith(" ") ||
    isWindowsReservedName(name)
  ) {
    throw new PerfectFrontError("invalid_request", "Nombre de archivo inválido");
  }
  return name;
}
