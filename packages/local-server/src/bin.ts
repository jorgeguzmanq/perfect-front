import { CliProcessController } from "./process/cli-controller";
import { startServer, type RunningServer } from "./server";

/**
 * Entry ejecutable del servidor local (lo lanza `comment server start` como proceso
 * hijo administrado, o se corre a mano: `node --import tsx packages/local-server/src/bin.ts`).
 * Escribe discovery.json al arrancar y lo borra al cerrar con SIGINT/SIGTERM.
 */
const MAX_LOG_BYTES = 256 * 1024;

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const stateDir = argValue("--state-dir");
  const portArg = argValue("--port");
  const ownerArg = argValue("--owner-pid");
  const ownerPid = ownerArg === undefined ? undefined : Number(ownerArg);
  const port = portArg === undefined ? undefined : Number(portArg);
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) {
    process.stderr.write("--port invalido\n");
    process.exit(2);
  }

  // Log acotado: pasado el tope se deja de escribir (el archivo lo trunca el CLI en cada inicio).
  let written = 0;
  const logger = (line: string): void => {
    if (written >= MAX_LOG_BYTES) return;
    const text = `${new Date().toISOString()} ${line}\n`;
    written += text.length;
    process.stdout.write(text);
  };

  let server: RunningServer;
  try {
    server = await startServer({
      ...(stateDir ? { stateDir } : {}),
      ...(port !== undefined ? { port } : {}),
      logger,
      processController: new CliProcessController(),
    });
  } catch (e) {
    process.stderr.write(`No se pudo iniciar el servidor local: ${(e as Error).message}\n`);
    process.exit(1);
  }
  logger(`perfect-front local server listening on ${server.url}`);

  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    const force = setTimeout(() => process.exit(0), 5000);
    force.unref();
    server.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  if (process.platform === "win32") process.on("SIGBREAK", shutdown);

  // Vigilancia del dueno: si el proceso que lo lanzo desaparece sin poder limpiar
  // (kill -9 / taskkill /F), el servidor se cierra solo y borra discovery.json.
  // Limite: solo comprueba que el PID siga vivo (un PID reciclado lo mantendria vivo).
  if (ownerPid !== undefined) {
    const timer = setInterval(() => {
      if (!pidAlive(ownerPid)) {
        logger("owner process gone: shutting down");
        shutdown();
      }
    }, 1000);
    timer.unref();
  }
}

void main();
