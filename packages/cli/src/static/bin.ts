import { parseArgs } from "node:util";
import { isSafeHtmlEntry } from "@perfect-front/shared";
import { DEFAULT_STATIC_PORT, startStaticServer } from "./server";

/**
 * Proceso del servidor estatico administrado. Lo lanza el CLI como el dev server
 * (stdout/stderr a process.log); anuncia la URL con el formato `Local: http://...`
 * que ya entiende `detectAnnouncedUrl`. Se apaga con SIGINT/SIGTERM/SIGHUP/SIGBREAK
 * (y `bin/guard.mjs` mata su arbol si la sesion padre desaparece).
 * Uso: static/bin.ts --root <dir> [--port <n>] [--fallback <ruta.html>] [--page <ruta.html>]
 * `--page` solo cambia la URL anunciada (la de la pagina elegida): se sirve toda la carpeta.
 */
const MAX_DENIED_LOGS = 200;

async function run(): Promise<number> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    options: { root: { type: "string" }, port: { type: "string" }, fallback: { type: "string" }, page: { type: "string" } },
  });
  if (!values.root) {
    console.error("falta --root");
    return 2;
  }
  const port = values.port === undefined ? DEFAULT_STATIC_PORT : Number(values.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error("--port invalido");
    return 2;
  }
  if (values.page !== undefined && !isSafeHtmlEntry(values.page)) {
    console.error("--page invalido");
    return 2;
  }
  let denied = 0;
  const srv = await startStaticServer({
    root: values.root,
    preferredPort: port,
    fallback: values.fallback ?? null,
    onDenied: (line) => {
      if (++denied <= MAX_DENIED_LOGS) console.log(`denegado: ${line}`);
    },
  });
  console.log(`Servidor estatico: ${values.root}`);
  const pagePath = values.page === undefined ? "" : values.page.split("/").map(encodeURIComponent).join("/");
  console.log(`  Local:   http://127.0.0.1:${srv.port}/${pagePath}`);

  await new Promise<void>((resolve) => {
    const signals: NodeJS.Signals[] = process.platform === "win32" ? ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] : ["SIGINT", "SIGTERM", "SIGHUP"];
    for (const s of signals) process.once(s, () => resolve());
  });
  await srv.close();
  return 0;
}

run().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`error: ${(err as Error).message}`);
    process.exit(1);
  },
);
