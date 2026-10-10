import { execFile } from "node:child_process";
import { isAlive } from "./identity";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Termina el arbol de procesos de un PID ya verificado como propio.
 * Windows: taskkill /T /F por PID (sin shell). POSIX: grupo de procesos (hijo lanzado detached).
 */
export async function killTree(pid: number, graceMs = 3000): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => resolve());
    });
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      /* ya termino */
    }
    const end = Date.now() + graceMs;
    while (isAlive(pid) && Date.now() < end) await sleep(100);
    if (isAlive(pid)) {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        /* ya termino */
      }
    }
  }
  const end = Date.now() + 5000;
  while (isAlive(pid) && Date.now() < end) await sleep(100);
}
