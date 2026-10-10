import { execFile } from "node:child_process";

const TOLERANCE_MS = 15_000;

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function run(file: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 8000 }, (err, stdout) => resolve(err ? null : String(stdout).trim()));
  });
}

/** Hora de inicio real del PID (ms epoch) o null si no existe / no se pudo leer. */
export async function processStartTime(pid: number): Promise<number | null> {
  if (process.platform === "win32") {
    const out = await run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `(Get-Process -Id ${Math.trunc(pid)} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`,
    ]);
    const t = out ? Date.parse(out) : NaN;
    return Number.isNaN(t) ? null : t;
  }
  const out = await run("ps", ["-o", "etimes=", "-p", String(Math.trunc(pid))]);
  const secs = out ? Number(out) : NaN;
  return Number.isNaN(secs) ? null : Date.now() - secs * 1000;
}

/**
 * Evita matar un PID reciclado: el proceso vivo debe haber arrancado cerca
 * de `startedAt` registrado. Si no se puede verificar, se considera NO nuestro.
 */
export async function isSameProcess(pid: number, startedAt: string): Promise<boolean> {
  if (!isAlive(pid)) return false;
  const actual = await processStartTime(pid);
  if (actual === null) return false;
  return Math.abs(actual - Date.parse(startedAt)) <= TOLERANCE_MS;
}
