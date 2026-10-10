import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { readJsonIfExists, writeFileAtomic } from "./fs-util";

/**
 * Archivo de descubrimiento: `<stateDir>/discovery.json`. Lo leen el CLI (y el
 * proceso nativo que corresponda); contiene los tokens, por eso se escribe con
 * modo 0o600 (en Windows rige la ACL privada de %LOCALAPPDATA%).
 */
export const DiscoverySchema = z
  .object({
    version: z.literal(1),
    apiVersion: z.literal(1),
    serverVersion: z.string(),
    pid: z.number().int().positive(),
    host: z.string(),
    port: z.number().int().min(1).max(65535),
    url: z.string(),
    token: z.string().min(16),
    cliToken: z.string().min(16),
    startedAt: z.string(),
  })
  .strict();
export type Discovery = z.infer<typeof DiscoverySchema>;

export const discoveryPath = (stateDir: string): string => path.join(stateDir, "discovery.json");

export async function writeDiscovery(stateDir: string, d: Discovery): Promise<void> {
  await writeFileAtomic(discoveryPath(stateDir), JSON.stringify(d, null, 2) + "\n", 0o600);
}

export async function readDiscovery(stateDir: string): Promise<Discovery | null> {
  const parsed = DiscoverySchema.safeParse(await readJsonIfExists(discoveryPath(stateDir)));
  return parsed.success ? parsed.data : null;
}

/** Borra el archivo solo si sigue siendo el de esta instancia (mismo token). */
export async function removeDiscovery(stateDir: string, token: string): Promise<void> {
  const current = await readDiscovery(stateDir);
  if (current && current.token !== token) return;
  await fs.rm(discoveryPath(stateDir), { force: true });
}
