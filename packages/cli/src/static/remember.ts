import fs from "node:fs";
import path from "node:path";
import { CONFIG_VERSION, ProjectConfigSchema, isSafeHtmlEntry, zodDetails } from "@perfect-front/shared";
import { PerfectFrontError } from "@perfect-front/shared";
import { writeFileAtomic } from "../process/state";

/**
 * Guarda `entry` en `<raiz>/.perfect-front/project.json` (unica escritura permitida fuera
 * de run/). Crea la config minima valida si no existe y conserva el resto de campos.
 * Nunca pisa un archivo ilegible o invalido: lanza y deja el archivo intacto.
 */
export function rememberEntry(root: string, entry: string): { file: string; created: boolean } {
  if (!isSafeHtmlEntry(entry)) throw new PerfectFrontError("invalid_request", "Pagina no valida para guardar");
  const file = path.join(root, ".perfect-front", "project.json");
  let current: Record<string, unknown> = { version: CONFIG_VERSION };
  let created = true;
  if (fs.existsSync(file)) {
    created = false;
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, ""));
    } catch {
      throw new PerfectFrontError("invalid_data", ".perfect-front/project.json no es JSON valido: no se modifica");
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new PerfectFrontError("invalid_data", ".perfect-front/project.json invalido: no se modifica");
    }
    current = raw as Record<string, unknown>;
  }
  const next = { ...current, entry };
  const parsed = ProjectConfigSchema.safeParse(next);
  if (!parsed.success) {
    throw new PerfectFrontError("invalid_data", ".perfect-front/project.json invalido: no se modifica", zodDetails(parsed.error));
  }
  writeFileAtomic(file, JSON.stringify(next, null, 2) + "\n");
  return { file, created };
}
