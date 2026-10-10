import os from "node:os";
import path from "node:path";

export const DEFAULT_PORT = 45800;
/** Puertos consecutivos probados tras el preferido antes de caer a uno efímero. */
export const PORT_FALLBACK_SPAN = 20;
export const LOOPBACK_HOST = "127.0.0.1";
export const SERVER_VERSION = "0.0.0";
/**
 * Capacidades del contrato que el CLI comprueba (GET /api/health -> features) antes de reutilizar un
 * servidor vivo. Añade una (o sube su sufijo) cada vez que cambie lo que el CLI necesita.
 * - proxy-v1: el registro acepta `targetUrl` y ProjectSummary lo devuelve.
 */
export const SERVER_FEATURES: readonly string[] = ["proxy-v1"];

export const LIMITS = {
  /** Body de cualquier ruta salvo creación de comentario (que admite captura). */
  jsonBody: 64 * 1024,
  /** Creación de comentario: la captura base64 admite hasta 10 MB (ver shared). */
  commentBody: 14 * 1024 * 1024,
  maxLogLines: 500,
  defaultLogLines: 200,
  maxBatchIds: 100,
  maxSseClients: 20,
  sseHeartbeatMs: 15_000,
  /** Peticiones por ventana, global (el servidor es loopback y de un solo usuario). */
  rateMax: 600,
  rateWindowMs: 60_000,
  /** Fallos de autenticación tolerados por ventana antes de bloquear. */
  authFailMax: 30,
} as const;

/** Directorio de estado por usuario (registro de proyectos y archivo de descubrimiento). */
export function defaultStateDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") {
    return path.join(env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "perfect-front");
  }
  if (platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "perfect-front");
  return path.join(env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"), "perfect-front");
}
