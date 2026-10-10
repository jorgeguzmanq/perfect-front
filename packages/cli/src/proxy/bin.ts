import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { readDiscovery, type DiscoveryInfo } from "../discovery";
import { overlayScriptProvider } from "./overlay";
import { proxyTargetOf, startProxyHost } from "./host";

/**
 * Proceso del proxy administrado (solo para `start`/`--detach`; en primer plano el proxy
 * vive dentro de la sesion). Lo lanza el CLI con stdout/stderr a proxy.log y anuncia
 * `Proxy: http://127.0.0.1:<puerto>`. El token del servidor local se lee de discovery.json
 * (nunca por argv ni por log). Si el servidor local se reinicia (otro puerto/token) lo
 * detecta cada 2 s y reinicia el proxy en el mismo puerto. Se apaga con
 * SIGINT/SIGTERM/SIGHUP/SIGBREAK; `bin/guard.mjs` lo mata si el dev server muere.
 * Uso: proxy/bin.ts --state-dir <dir> --project-id <id> --target <url> [--port <n>]
 */
const POLL_MS = 2000;
const sameDiscovery = (a: DiscoveryInfo, b: DiscoveryInfo): boolean => a.host === b.host && a.port === b.port && a.cliToken === b.cliToken;

async function run(): Promise<number> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    strict: true,
    options: { "state-dir": { type: "string" }, "project-id": { type: "string" }, target: { type: "string" }, port: { type: "string" } },
  });
  const target = values.target ? proxyTargetOf(values.target) : null;
  if (!values["state-dir"] || !values["project-id"] || !target) {
    console.error("uso: --state-dir <dir> --project-id <id> --target <url http>");
    return 2;
  }
  const stateDir = values["state-dir"];
  let disc = readDiscovery(stateDir);
  const host = await startProxyHost({
    target,
    projectId: values["project-id"],
    discovery: disc,
    getOverlayScript: overlayScriptProvider(),
    ...(values.port !== undefined ? { listenPort: Number(values.port) } : {}),
    log: (l) => console.log(l),
  });
  console.log(`Proxy: ${host.url}`);

  let busy = false;
  const timer = setInterval(() => {
    if (busy) return;
    busy = true;
    void (async () => {
      try {
        if (!fs.existsSync(path.join(stateDir, "discovery.json"))) return;
        const d = readDiscovery(stateDir);
        if (!sameDiscovery(d, disc)) {
          disc = d;
          await host.rebind(d);
        }
      } catch {
        /* servidor local caido o reiniciandose: se reintenta */
      } finally {
        busy = false;
      }
    })();
  }, POLL_MS);

  await new Promise<void>((resolve) => {
    const signals: NodeJS.Signals[] = process.platform === "win32" ? ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"] : ["SIGINT", "SIGTERM", "SIGHUP"];
    for (const s of signals) process.once(s, () => resolve());
  });
  clearInterval(timer);
  await host.close();
  return 0;
}

run().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`error: ${(err as Error).message}`);
    process.exit(1);
  },
);
