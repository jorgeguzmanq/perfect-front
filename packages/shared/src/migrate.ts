import { VisualCommentSchema, type VisualComment } from "./comment";
import { ProjectConfigSchema, type ProjectConfig } from "./config";
import { PerfectFrontError, zodDetails } from "./errors";

/** Versión más reciente que este paquete entiende, por tipo de documento. */
export const LATEST_COMMENT_VERSION = 1;
export const LATEST_CONFIG_VERSION = 1;

function readVersion(input: unknown, label: string): number {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new PerfectFrontError("invalid_data", `${label}: se esperaba un objeto JSON`);
  }
  const v = (input as Record<string, unknown>)["version"];
  if (v === undefined) {
    throw new PerfectFrontError("invalid_data", `${label}: falta el campo "version"`);
  }
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
    throw new PerfectFrontError("invalid_data", `${label}: "version" debe ser un entero positivo`);
  }
  return v;
}

function unsupported(label: string, v: number, latest: number): PerfectFrontError {
  return new PerfectFrontError(
    "unsupported_version",
    v > latest
      ? `${label}: la versión ${v} es más nueva que la soportada (${latest}). Actualiza Perfect Front.`
      : `${label}: la versión ${v} ya no es soportada (mínima 1).`,
  );
}

/** Migra un comentario desconocido a la versión actual y lo valida. v1 es identidad. */
export function migrateComment(input: unknown): VisualComment {
  const v = readVersion(input, "Comentario");
  if (v !== 1) throw unsupported("Comentario", v, LATEST_COMMENT_VERSION);
  const r = VisualCommentSchema.safeParse(input);
  if (!r.success) throw new PerfectFrontError("invalid_data", "Comentario inválido", zodDetails(r.error));
  return r.data;
}

/** Migra la configuración de proyecto a la versión actual y la valida. v1 es identidad. */
export function migrateProjectConfig(input: unknown): ProjectConfig {
  const v = readVersion(input, "Configuración");
  if (v !== 1) throw unsupported("Configuración", v, LATEST_CONFIG_VERSION);
  const r = ProjectConfigSchema.safeParse(input);
  if (!r.success) throw new PerfectFrontError("invalid_data", "Configuración inválida", zodDetails(r.error));
  return r.data;
}
