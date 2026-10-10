import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Escritura atómica: temporal en el mismo directorio y rename. `mode` 0o600 limita
 * el archivo al usuario en POSIX; en Windows lo gobierna la ACL heredada del
 * directorio de estado (por defecto %LOCALAPPDATA%, privado del usuario).
 */
export async function writeFileAtomic(file: string, data: string, mode = 0o600): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    await fs.writeFile(tmp, data, { encoding: "utf8", mode });
    await fs.rename(tmp, file);
  } catch (e) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw e;
  }
}

export async function readJsonIfExists(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}
