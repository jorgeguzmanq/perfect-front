import type { ResolveCommentRequest } from "@perfect-front/shared";

export interface ResolveFormValues {
  summary: string;
  files: string;
  verification: string;
  commit: string;
}

export type ResolveParse = { ok: true; request: ResolveCommentRequest } | { ok: false; errors: Partial<Record<keyof ResolveFormValues, string>> };

const lines = (s: string): string[] =>
  s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");

/** Valida el formulario con los mismos limites que ResolutionSchema (shared) y arma la request. */
export function parseResolveForm(v: ResolveFormValues): ResolveParse {
  const errors: Partial<Record<keyof ResolveFormValues, string>> = {};
  const summary = v.summary.trim();
  if (summary === "") errors.summary = "Escribe un resumen de lo que se hizo.";
  else if (summary.length > 5000) errors.summary = "Máximo 5000 caracteres.";
  const files = lines(v.files);
  if (files.length > 500) errors.files = "Máximo 500 archivos.";
  else if (files.some((f) => f.length > 500)) errors.files = "Cada ruta admite hasta 500 caracteres.";
  const verification = lines(v.verification);
  if (verification.length > 100) errors.verification = "Máximo 100 líneas.";
  else if (verification.some((f) => f.length > 1000)) errors.verification = "Cada línea admite hasta 1000 caracteres.";
  const commit = v.commit.trim();
  if (commit.length > 80) errors.commit = "Máximo 80 caracteres.";
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  const request = { resolvedBy: "dashboard", summary, filesChanged: files, verification, ...(commit ? { commit } : {}) } as ResolveCommentRequest;
  return { ok: true, request };
}
