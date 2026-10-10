import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Error de "servidor no activo" (discovery ausente o sin respuesta): el CLI lo traduce a EXIT.NOT_RUNNING. */
export class ServerNotRunningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServerNotRunningError";
  }
}

/** Mismo directorio de estado que usa el servidor local (local-server/config). */
export function defaultStateDir(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") return path.join(env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "perfect-front");
  if (platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "perfect-front");
  return path.join(env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"), "perfect-front");
}

export interface DiscoveryInfo {
  host: string;
  port: number;
  cliToken: string;
}

export function readDiscovery(stateDir: string): DiscoveryInfo {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(stateDir, "discovery.json"), "utf8"));
  } catch {
    throw new ServerNotRunningError("El servidor local no esta activo (no hay discovery.json)");
  }
  const d = raw as Partial<Record<keyof DiscoveryInfo, unknown>> | null;
  if (!d || typeof d.host !== "string" || typeof d.port !== "number" || typeof d.cliToken !== "string") {
    throw new ServerNotRunningError("discovery.json invalido: el servidor local no esta activo");
  }
  return { host: d.host, port: d.port, cliToken: d.cliToken };
}
