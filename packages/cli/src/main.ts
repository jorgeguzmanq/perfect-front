import { runCli, EXIT } from "./run";

/**
 * Punto de entrada: cablea stdout/stderr y las senales de cierre (aborta el arranque o,
 * en primer plano, dispara el apagado limpio). Un segundo Ctrl+C fuerza la salida.
 *
 * En Windows `process.kill(pid, "SIGINT")` termina el proceso sin handlers; solo Ctrl+C
 * real en consola, cierre de ventana (SIGHUP) y Ctrl+Break (SIGBREAK) llegan como senal.
 * Para controlarlo desde otro proceso hay un canal IPC: si se lanza con `fork`/stdio "ipc",
 * el mensaje "shutdown" equivale a Ctrl+C.
 */
export async function main(argv: string[]): Promise<number> {
  const ac = new AbortController();
  let hits = 0;
  const onStop = (): void => {
    if (++hits > 1) process.exit(EXIT.INTERRUPTED);
    ac.abort();
  };
  const signals: NodeJS.Signals[] = process.platform === "win32" ? ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] : ["SIGINT", "SIGTERM", "SIGHUP"];
  for (const s of signals) process.on(s, onStop);
  const onMessage = (m: unknown): void => {
    if (m === "shutdown") onStop();
  };
  if (process.send) process.on("message", onMessage);
  try {
    return await runCli(argv, {
      stdout: (s) => void process.stdout.write(s),
      stderr: (s) => void process.stderr.write(s),
      cwd: process.cwd(),
      signal: ac.signal,
      // Selector de paginas solo con terminal real en entrada y salida.
      ...(process.stdin.isTTY && process.stdout.isTTY ? { tty: { input: process.stdin, output: process.stdout } } : {}),
    });
  } catch {
    return EXIT.INTERNAL;
  } finally {
    for (const s of signals) process.off(s, onStop);
    process.off("message", onMessage);
    if (process.send && process.channel) process.disconnect?.();
  }
}
