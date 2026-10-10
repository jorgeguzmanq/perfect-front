import fs from "node:fs";
import path from "node:path";

/**
 * Metadata minima del proceso administrado. Vive en `<root>/.perfect-front/run/`:
 * es por proyecto (varios proyectos a la vez sin colision), la SPEC limita las
 * escrituras a `.perfect-front/` y no depende de un directorio global del usuario.
 */
export interface ManagedState {
  version: 1;
  pid: number;
  startedAt: string;
  command: string;
  args: string[];
  cwd: string;
  url: string | null;
  port: number | null;
  logFile: string;
  /** Sesion en primer plano que lo inicio (para detectar huerfanos si murio sin limpiar). */
  ownerPid?: number;
  ownerStartedAt?: string;
}

export const runDir = (root: string): string => path.join(root, ".perfect-front", "run");
export const statePath = (root: string): string => path.join(runDir(root), "process.json");
export const logPath = (root: string): string => path.join(runDir(root), "process.log");

/** Escritura atomica: archivo temporal en el mismo directorio y rename. */
export function writeFileAtomic(file: string, data: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, data, "utf8");
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

export function writeState(root: string, state: ManagedState): void {
  writeFileAtomic(statePath(root), JSON.stringify(state, null, 2) + "\n");
}

export function clearState(root: string): void {
  fs.rmSync(statePath(root), { force: true });
}

const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/** Lee y valida a mano; un archivo corrupto o ajeno se trata como ausente. */
export function readState(root: string): ManagedState | null {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(statePath(root), "utf8"));
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const s = raw as Record<string, unknown>;
  if (
    s.version !== 1 ||
    typeof s.pid !== "number" ||
    !Number.isInteger(s.pid) ||
    s.pid <= 0 ||
    typeof s.startedAt !== "string" ||
    Number.isNaN(Date.parse(s.startedAt)) ||
    typeof s.command !== "string" ||
    !isStrArr(s.args) ||
    typeof s.cwd !== "string" ||
    !(s.url === null || typeof s.url === "string") ||
    !(s.port === null || typeof s.port === "number") ||
    typeof s.logFile !== "string"
  ) {
    return null;
  }
  return s as unknown as ManagedState;
}
