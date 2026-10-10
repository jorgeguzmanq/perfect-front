// Vigilante minimo (JS plano, sin dependencias): si el proceso padre (la sesion
// `perfect-front`) desaparece sin poder limpiar (kill -9 / taskkill /F), mata el
// arbol del dev server para no dejarlo huerfano. Sale solo cuando el hijo muere.
// Uso: node guard.mjs <parentPid> <childPid>
// Limite: comprueba solo que el PID del padre siga vivo (un PID reciclado lo engana).
import { execFile } from "node:child_process";

const [parent, child] = process.argv.slice(2).map(Number);
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};
if (!Number.isInteger(parent) || !Number.isInteger(child) || parent <= 0 || child <= 0) process.exit(2);

const timer = setInterval(() => {
  if (!alive(child)) return process.exit(0);
  if (alive(parent)) return;
  clearInterval(timer);
  if (process.platform === "win32") {
    execFile("taskkill", ["/PID", String(child), "/T", "/F"], { windowsHide: true }, () => process.exit(0));
  } else {
    try {
      process.kill(-child, "SIGTERM");
    } catch {
      // el grupo de procesos ya terminó
    }
    setTimeout(() => process.exit(0), 500);
  }
}, 1000);
