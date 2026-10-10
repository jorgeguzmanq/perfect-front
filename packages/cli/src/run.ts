import path from "node:path";
import { parseArgs } from "node:util";
import { DetectionError, detectProject, findRoot, normalizePagePath, type DetectionResult } from "@perfect-front/project-detector";
import { PerfectFrontError, toErrorData } from "@perfect-front/shared";
import { openBrowser as defaultOpenBrowser, ensureRunning, getStatus, readLogs, StartError, stopManaged } from "./process";
import type { ProcessStatus, StartOptions, Target } from "./process";
import { runForeground, spawnGuard, type ProxyReady } from "./foreground";
import { proxyTargetOf, swapOrigin } from "./proxy/host";
import { ensureManagedProxy } from "./proxy/managed";
import { overlayScriptProvider } from "./proxy/overlay";
import { liveProxyState, stopProxy } from "./proxy/state";
import { confirmKey, pickPage, type PickerInput, type PickerOutput } from "./static/picker";
import { pageUrl, staticTarget } from "./static/launch";
import { rememberEntry } from "./static/remember";
import { ServerNotRunningError, defaultStateDir } from "./discovery";
import { COMMENT_EXIT, detectCommentCommand, runCommentCommand } from "./comments";
import {
  ServerStartError,
  ensureServer,
  getServerStatus,
  readServerLogs,
  outdatedMessage,
  registerProject,
  setupLocal,
  stopServer,
  type LocalSetup,
  type EnsureServerOptions,
  type ServerStatus,
} from "./local-server";

export const VERSION = "0.0.0";

export const EXIT = {
  OK: 0,
  /** Error inesperado. */
  INTERNAL: 1,
  /** Uso incorrecto: opcion o comando invalido. */
  USAGE: 2,
  /** Proyecto no detectable o configuracion invalida. */
  PROJECT: 3,
  /** El proceso fallo al iniciar o no respondio. */
  PROCESS: 4,
  /** Nada en ejecucion (status/open/logs). */
  NOT_RUNNING: 5,
  /** Comentarios: id (o coleccion destino) no encontrado. */
  NOT_FOUND: COMMENT_EXIT.NOT_FOUND,
  /** Comentarios: conflicto o revision obsoleta. */
  CONFLICT: COMMENT_EXIT.CONFLICT,
  /** Comentarios: datos ilegibles o error de almacenamiento. */
  DATA: COMMENT_EXIT.DATA,
  /** Interrumpido con Ctrl+C. */
  INTERRUPTED: 130,
} as const;

export const HELP = `Perfect Front - comentarios visuales sobre tu app local

Uso:
  perfect-front [comando] [opciones]     (alias: comment)

Comandos:
  (ninguno)   PRIMER PLANO: inicia dev server + servidor local, registra el proyecto,
              abre el navegador y queda vivo. Ctrl+C (o cerrar la terminal) apaga todo
              lo que inicio; no hace falta ningun comando de stop
  start       Segundo plano: inicia (o conecta) y regresa, sin abrir el navegador
              (con --detach el comando sin subcomando hace lo mismo y abre el navegador)
  status      Muestra el estado del servidor
  stop        Detiene solo el proceso iniciado por Perfect Front
  restart     Detiene el proceso administrado y lo inicia de nuevo
  logs        Muestra las ultimas lineas de salida (-n, --lines)
  open        Abre en el navegador un servidor ya activo
  server <start|stop|status|logs>
              Administra el servidor local de Perfect Front (segundo plano);
              \`stop\` solo detiene el que inicio Perfect Front

Comentarios (directo sobre .perfect-front, sin servidor ni navegador; ver AGENTS.md):
  list, show <id>, claim <id>, resolve <id> --summary "...", edit <id> --comment "...",
  move <id...> --to <coleccion>, status <id> <estado>, ignore <id>, reopen <id>,
  export --format md [--out archivo.md]. Detalle: perfect-front list --help

Opciones:
  --url <url>        Usa un servidor que ya corre en esa URL (no inicia nada; vale para cualquier framework)
  --command <cmd>    Comando de desarrollo (sin operadores de shell; vale para cualquier framework)
  --start-timeout <s> Segundos de espera a que el dev server responda (por defecto 120; Next/Angular tardan al primer arranque)
  --port <n>         Puerto esperado (HTML estatico: puerto preferido, por defecto 5500)
  --page <ruta>      HTML estatico: pagina a abrir (ruta relativa de la lista de candidatas)
  --choose           HTML estatico: elegir de nuevo aunque haya index.html o pagina recordada
  --fallback <ruta>  HTML estatico: sirve esta pagina para rutas sin extension inexistentes (SPA)
  --cwd <dir>        Directorio de trabajo (por defecto el actual)
  --detach           Segundo plano en vez de primer plano
  --no-open          No abre el navegador
  --no-server        No inicia ni registra el servidor local (solo el dev server; sin servidor local tampoco hay proxy)
  --no-proxy         No pone el proxy delante: sin capa de comentarios (la extension ya no la inyecta)
  --server-port <n>  Puerto preferido del servidor local (por defecto 45800)
  --state-dir <dir>  Directorio de estado del servidor local (discovery.json)
  --json             Salida JSON en stdout
  -h, --help         Ayuda
  -v, --version      Version

Codigos de salida: 0 ok, 1 interno, 2 uso, 3 proyecto, 4 proceso, 5 no activo, 130 Ctrl+C,
                  comentarios: 6 id no encontrado, 7 conflicto/revision obsoleta, 8 datos/almacenamiento
`;

export interface Io {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  cwd: string;
  openBrowser?: (url: string) => void;
  signal?: AbortSignal;
  startTimeoutMs?: number;
  /** Directorio de estado del servidor local (por defecto el del usuario). */
  stateDir?: string;
  /** false = no iniciar/registrar el servidor local (pruebas del dev server). */
  localServer?: boolean;
  /** Puerto preferido del servidor local (0 = efimero). */
  serverPort?: number;
  /** Puerto preferido del proxy (por defecto 7788; ocupado = el siguiente libre). */
  proxyPort?: number;
  /** Timeout de arranque del servidor local. */
  serverTimeoutMs?: number;
  /** Intervalo del monitor del modo primer plano (por defecto 1000 ms). */
  monitorIntervalMs?: number;
  /** Terminal interactivo (TTY) para el selector de paginas; sin el, el modo es no interactivo. */
  tty?: { input: PickerInput; output: PickerOutput };
}

interface Parsed {
  sub: string | null;
  noServer: boolean;
  noProxy: boolean;
  overlayNoCache: boolean;
  detach: boolean;
  serverPort: number | undefined;
  command: string;
  json: boolean;
  noOpen: boolean;
  startTimeoutSec: number | undefined;
  lines: number;
  cwd: string;
  stateDir: string | undefined;
  overrides: { url?: string; command?: string; port?: number; page?: string; choose?: boolean };
  fallback: string | undefined;
}

const EXTENSION_HINT = "La extensión Perfect Front es opcional: lista este proyecto y alterna la capa";
const LAYER_HINT = "Capa de comentarios activa: Alt+clic sobre un elemento (o Ctrl/Cmd+Mayús+C)";

const COMMANDS = ["start", "status", "stop", "restart", "logs", "open", "server"];
const SERVER_SUBS = ["start", "stop", "status", "logs"];

function parse(argv: string[], cwd: string): Parsed | "help" | "version" {
  let values;
  let positionals;
  try {
    ({ values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: true,
      options: {
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
        json: { type: "boolean" },
        "no-open": { type: "boolean" },
        "no-server": { type: "boolean" },
        "no-proxy": { type: "boolean" },
        "overlay-no-cache": { type: "boolean" }, // oculto: reconstruye el overlay en cada peticion (desarrollo)
        detach: { type: "boolean" },
        "server-port": { type: "string" },
        url: { type: "string" },
        command: { type: "string" },
        port: { type: "string" },
        page: { type: "string" },
        choose: { type: "boolean" },
        fallback: { type: "string" },
        cwd: { type: "string" },
        "state-dir": { type: "string" },
        lines: { type: "string", short: "n" },
        "start-timeout": { type: "string" },
      },
    }));
  } catch (err) {
    throw new PerfectFrontError("invalid_request", (err as Error).message.split("\n")[0] ?? "Argumentos invalidos");
  }
  if (values.help) return "help";
  if (values.version) return "version";
  const [command = "default", ...rest] = positionals;
  const sub = command === "server" ? (rest.shift() ?? "status") : null;
  if (sub !== null && !SERVER_SUBS.includes(sub)) {
    throw new PerfectFrontError("invalid_request", `Subcomando desconocido: server ${sub}`);
  }
  if (rest.length > 0 || (command !== "default" && !COMMANDS.includes(command))) {
    throw new PerfectFrontError("invalid_request", `Comando desconocido: ${positionals.join(" ")}`);
  }
  const num = (v: string | undefined, name: string, min: number, max: number): number | undefined => {
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new PerfectFrontError("invalid_request", `--${name} invalido`);
    return n;
  };
  const overrides: Parsed["overrides"] = {};
  if (values.url !== undefined) overrides.url = values.url;
  if (values.command !== undefined) overrides.command = values.command;
  const port = num(values.port, "port", 1, 65535);
  if (port !== undefined) overrides.port = port;
  if (values.page !== undefined) overrides.page = values.page;
  if (values.choose === true) overrides.choose = true;
  if (values.fallback !== undefined && normalizePagePath(values.fallback) === null) {
    throw new PerfectFrontError("invalid_request", "--fallback invalido: debe ser una ruta relativa .html sin '..'");
  }
  return {
    command,
    sub,
    noServer: values["no-server"] === true,
    noProxy: values["no-proxy"] === true,
    overlayNoCache: values["overlay-no-cache"] === true,
    detach: values.detach === true,
    serverPort: num(values["server-port"], "server-port", 0, 65535),
    json: values.json === true,
    noOpen: values["no-open"] === true,
    startTimeoutSec: num(values["start-timeout"], "start-timeout", 1, 3600),
    lines: num(values.lines, "lines", 1, 1000) ?? 50,
    cwd: values.cwd ? path.resolve(cwd, values.cwd) : cwd,
    stateDir: values["state-dir"] ? path.resolve(cwd, values["state-dir"]) : undefined,
    overrides,
    fallback: values.fallback !== undefined ? (normalizePagePath(values.fallback) ?? undefined) : undefined,
  };
}

function toTarget(d: DetectionResult, p: Parsed): Target {
  // HTML estatico: el proceso administrado es el servidor estatico del propio CLI.
  if (d.kind === "static") return staticTarget(d.root, d.projectDir, d.port ?? 5500, { fallback: p.fallback, page: d.static?.entry });
  // --url: sin proceso (comando vacio); el CLI solo conecta con lo que ya corre en esa URL.
  if (d.kind === "external") return { root: d.root, plan: { command: "", args: [], cwd: d.plan.cwd }, url: d.url };
  return { root: d.root, plan: { command: d.plan.command, args: d.plan.args, cwd: d.plan.cwd }, url: d.url };
}

/** Para status/stop/logs basta la raiz: si el proyecto no es detectable se usa solo `findRoot`. */
function loadTarget(p: Parsed, needsPlan: boolean): { target: Target; detection: DetectionResult | null } {
  try {
    const detection = detectProject({ cwd: p.cwd, overrides: p.overrides, env: { PORT: process.env.PORT } });
    return { target: toTarget(detection, p), detection };
  } catch (err) {
    if (needsPlan || !(err instanceof DetectionError) || err.reason === "root_not_found") throw err;
    const { root } = findRoot(p.cwd);
    return { target: { root, plan: { command: "", args: [], cwd: root }, url: p.overrides.url ?? null }, detection: null };
  }
}

export function exitCodeFor(err: unknown): number {
  if (err instanceof DetectionError) return err.reason === "invalid_command" ? EXIT.USAGE : EXIT.PROJECT;
  if (err instanceof ServerNotRunningError) return EXIT.NOT_RUNNING;
  if (err instanceof PerfectFrontError) {
    if (err.code === "invalid_request") return EXIT.USAGE;
    if (err.code === "process_error") return EXIT.PROCESS;
  }
  return EXIT.INTERNAL;
}

const describe = (s: ProcessStatus): string => {
  if (s.state === "stopped") return "Detenido";
  if (s.managed) return `Administrado por Perfect Front (pid ${s.pid}) en ${s.url ?? "?"}${s.ready ? "" : " - sin respuesta HTTP"}`;
  return `Servidor externo en ${s.url ?? "?"} (Perfect Front no lo detendra)`;
};

const describeServer = (s: ServerStatus): string =>
  s.state === "stopped"
    ? "Detenido"
    : s.managed
      ? `Administrado por Perfect Front (pid ${s.pid}) en ${s.url}`
      : `Servidor local externo en ${s.url} (Perfect Front no lo detendra)`;

export async function runCli(argv: string[], io: Io): Promise<number> {
  const commentCmd = detectCommentCommand(argv);
  if (commentCmd) return runCommentCommand(commentCmd, argv, { stdout: io.stdout, stderr: io.stderr, cwd: io.cwd });
  let json = argv.includes("--json");
  const out = (s: string): void => io.stdout(s.endsWith("\n") ? s : s + "\n");
  const emit = (data: Record<string, unknown>, human: string): void => {
    if (json) out(JSON.stringify({ ok: true, ...data }));
    else out(human);
  };

  try {
    const parsed = parse(argv, io.cwd);
    if (parsed === "help") return out(HELP), EXIT.OK;
    if (parsed === "version") return out(json ? JSON.stringify({ ok: true, version: VERSION }) : VERSION), EXIT.OK;
    json = parsed.json;
    const open = io.openBrowser ?? defaultOpenBrowser;
    const startOpts: StartOptions = {};
    if (io.signal) startOpts.signal = io.signal;
    if (io.startTimeoutMs) startOpts.startTimeoutMs = io.startTimeoutMs;
    else if (parsed.startTimeoutSec !== undefined) startOpts.startTimeoutMs = parsed.startTimeoutSec * 1000;
    startOpts.onProgress = (m) => {
      if (!json) out(m);
    };

    const stateDir = io.stateDir ?? parsed.stateDir ?? defaultStateDir();
    const serverOpts: EnsureServerOptions = {};
    const serverPort = io.serverPort ?? parsed.serverPort;
    if (serverPort !== undefined) serverOpts.port = serverPort;
    if (io.signal) serverOpts.signal = io.signal;
    if (io.serverTimeoutMs) serverOpts.timeoutMs = io.serverTimeoutMs;

    switch (parsed.command) {
      case "server": {
        if (parsed.sub === "start") {
          const r = await ensureServer(stateDir, serverOpts);
          emit(
            { command: "server", sub: "start", action: r.action, ...r.status },
            `${r.action === "started" ? "Servidor local iniciado" : "Conectado al servidor local"}\n${describeServer(r.status)}`,
          );
          return EXIT.OK;
        }
        if (parsed.sub === "stop") {
          const r = await stopServer(stateDir);
          const human =
            r.outcome === "stopped"
              ? `Servidor local detenido (pid ${r.pid})`
              : r.outcome === "external"
                ? `El servidor local en ${r.url} no lo inicio Perfect Front: no se toca`
                : "No hay servidor local administrado";
          emit({ command: "server", sub: "stop", ...r }, human);
          return EXIT.OK;
        }
        if (parsed.sub === "logs") {
          const lines = readServerLogs(stateDir, parsed.lines);
          if (lines === null) {
            emit({ command: "server", sub: "logs", lines: [] }, "Sin logs: no se ha iniciado el servidor local");
            return EXIT.NOT_RUNNING;
          }
          emit({ command: "server", sub: "logs", lines }, lines.join("\n"));
          return EXIT.OK;
        }
        const { discovery: _d, ...s } = await getServerStatus(stateDir);
        void _d;
        emit({ command: "server", sub: "status", ...s }, describeServer(s));
        return s.state === "stopped" ? EXIT.NOT_RUNNING : EXIT.OK;
      }
      case "status": {
        const { target } = loadTarget(parsed, false);
        const s = await getStatus(target);
        const px = await liveProxyState(target.root);
        emit(
          { command: "status", ...s, ...(px ? { proxy: { url: px.baseUrl, port: px.port, targetUrl: px.targetUrl } } : {}) },
          describe(s) + (px ? `\nProxy (capa de comentarios): ${px.baseUrl} -> ${px.targetUrl}` : ""),
        );
        return s.state === "stopped" ? EXIT.NOT_RUNNING : EXIT.OK;
      }
      case "stop": {
        const { target } = loadTarget(parsed, false);
        const r = await stopManaged(target);
        const px = await stopProxy(target.root);
        const human =
          (r.outcome === "stopped"
            ? `Detenido el proceso administrado (pid ${r.pid})`
            : r.outcome === "external"
              ? `El servidor en ${r.url} es externo: no se toca`
              : "No hay proceso administrado") + (px.outcome === "stopped" ? `\nProxy detenido (pid ${px.pid})` : "");
        emit({ command: "stop", ...r, ...(px.outcome === "stopped" ? { proxy: { outcome: "stopped", pid: px.pid } } : {}) }, human);
        return EXIT.OK;
      }
      case "logs": {
        const { target } = loadTarget(parsed, false);
        const lines = readLogs(target.root, parsed.lines);
        if (lines === null) {
          emit({ command: "logs", lines: [] }, "Sin logs: no se ha iniciado ningun proceso");
          return EXIT.NOT_RUNNING;
        }
        emit({ command: "logs", lines }, lines.join("\n"));
        return EXIT.OK;
      }
      case "open": {
        const { target, detection } = loadTarget(parsed, false);
        const s = await getStatus(target);
        if (s.state === "stopped" || !s.url) {
          emit({ command: "open", opened: false, ...s }, "No hay servidor activo. Usa `comment start`.");
          return EXIT.NOT_RUNNING;
        }
        const openUrl = pageUrl(s.url, detection?.static?.entry ?? null) ?? s.url;
        if (!parsed.noOpen) open(openUrl);
        emit({ command: "open", opened: !parsed.noOpen, ...s, url: openUrl }, `Abriendo ${openUrl}`);
        return EXIT.OK;
      }
      default: {
        // default | start | restart
        const loaded = loadTarget(parsed, true);
        const detection = loaded.detection;
        let target = loaded.target;

        // HTML estatico: pagina elegida (override > recordada > index.html > unica) o seleccion interactiva.
        const st = detection?.static ?? null;
        let entry: string | null = st?.entry ?? null;
        if (st && st.status === "needs_choice") {
          const tty = io.tty;
          if (!tty || json) {
            const hint = "Indica la pagina con --page <ruta> (por ejemplo --page " + (st.pages[0] ?? "index.html") + ")";
            const message = `Hay ${st.pages.length} paginas HTML y ninguna es index.html: no se elige sola${st.truncated ? " (lista truncada)" : ""}`;
            if (json) out(JSON.stringify({ ok: false, error: { code: "invalid_request", message }, pages: st.pages, truncated: st.truncated, hint }));
            else io.stderr(`Error: ${message}\nPaginas candidatas:\n${st.pages.map((p) => "  " + p).join("\n")}\n${hint}\n`);
            return EXIT.USAGE;
          }
          const picked = await pickPage(st.pages, { ...tty, signal: io.signal });
          if (picked === null) return EXIT.INTERRUPTED;
          entry = picked;
          const ok = await confirmKey(`Recordar "${picked}" en .perfect-front/project.json para no volver a preguntar?`, { ...tty, signal: io.signal });
          if (ok === null) return EXIT.INTERRUPTED;
          if (ok && detection) {
            try {
              const r = rememberEntry(detection.root, picked);
              out(`Pagina guardada en ${r.file}${r.created ? " (archivo creado)" : ""}. Usa --choose para elegir de nuevo.`);
            } catch (e) {
              out(`No se pudo guardar la pagina: ${(e as Error).message}`);
            }
          }
        }
        if (st && detection && entry !== st.entry) {
          target = staticTarget(detection.root, detection.projectDir, detection.port ?? 5500, { fallback: parsed.fallback, page: entry });
        }
        const mapUrl = (u: string | null): string | null => (st ? pageUrl(u, entry) : u);

        if (parsed.command === "restart") {
          const r = await stopManaged(target);
          if (!json && r.outcome === "stopped") out(`Detenido pid ${r.pid}`);
          await stopProxy(target.root);
        }
        const withLocal = io.localServer !== false && !parsed.noServer;
        const useProxy = withLocal && !parsed.noProxy;
        const noProxyReason = (): string =>
          parsed.noProxy ? "--no-proxy — quítalo para activar la capa" : "--no-server (sin servidor local no hay adónde enviar comentarios) — quítalo para activar la capa";
        const report = (
          action: "started" | "connected",
          status: ProcessStatus,
          local: LocalSetup | null,
          opened: boolean,
          proxy: ProxyReady | null,
          proxyReason: string | null,
        ): { data: Record<string, unknown>; lines: string[] } => ({
          data: {
            command: parsed.command,
            action,
            opened,
            ...status,
            ...(st ? { url: mapUrl(status.url), page: entry, pages: st.pages } : {}),
            ...(proxy
              ? { url: proxy.url, targetUrl: proxy.targetUrl, proxy: { active: true, baseUrl: proxy.baseUrl, port: proxy.port, url: proxy.url, targetUrl: proxy.targetUrl } }
              : { proxy: { active: false, reason: proxyReason ?? noProxyReason() } }),
            ...(local
              ? {
                  localServer: { action: local.srv.action, ...local.srv.status },
                  registered: local.project,
                }
              : {}),
            ...(detection ? { project: detection.name } : {}),
          },
          lines: [
            action === "started" ? "Servidor iniciado" : "Conectado a servidor activo",
            describe(status),
            ...((proxy?.url ?? mapUrl(status.url)) ? [`URL del proyecto: ${proxy?.url ?? mapUrl(status.url)}`] : []),
            ...(proxy ? [`URL original: ${proxy.targetUrl}`] : []),
            ...(local
              ? [
                  `Servidor local: ${local.srv.action === "started" ? "iniciado" : "activo"} - ${describeServer(local.srv.status)}`,
                  `Proyecto registrado: ${local.project.name} (${local.project.id})`,
                  ...(proxy ? [LAYER_HINT] : [`SIN CAPA DE COMENTARIOS: ${proxyReason ?? noProxyReason()}`]),
                  EXTENSION_HINT,
                ]
              : [`SIN CAPA DE COMENTARIOS: ${proxyReason ?? noProxyReason()}`]),
          ],
        });

        if (parsed.command === "default" && !parsed.detach) {
          // Primer plano: queda vivo y apaga todo al recibir una senal de cierre.
          const stopSignal = io.signal ?? new AbortController().signal;
          return await runForeground({
            target,
            stateDir,
            noServer: !withLocal,
            signal: stopSignal,
            start: startOpts,
            server: serverOpts,
            monitorMs: io.monitorIntervalMs ?? 1000,
            mapUrl,
            ...(useProxy
              ? { proxy: { overlay: overlayScriptProvider({ noCache: parsed.overlayNoCache }), ...(io.proxyPort !== undefined ? { listenPort: io.proxyPort } : {}) } }
              : {}),
            notify: (m) => {
              if (!json) out(m);
            },
            onReady: ({ action, status, local, proxy, proxyReason }) => {
              const shouldOpen = !parsed.noOpen && status.url !== null;
              const pageLink = proxy?.url ?? mapUrl(status.url);
              if (shouldOpen && pageLink) open(pageLink);
              const r = report(action, status, local, shouldOpen, proxy, proxyReason);
              emit(
                { ...r.data, foreground: true },
                [...r.lines, ...(shouldOpen ? [`Abriendo ${pageLink}`] : []), "En primer plano: Ctrl+C (o cerrar esta terminal) apaga todo lo iniciado."].join("\n"),
              );
            },
          });
        }

        const { action, status } = await ensureRunning(target, startOpts);
        // Servidor local + registro (el dev server ya esta listo; si esto falla, sigue corriendo).
        let local = withLocal ? await setupLocal(stateDir, serverOpts, target.root, mapUrl(status.url)) : null;
        let proxy = null as ProxyReady | null;
        let proxyReason = null as string | null;
        const targetPage = mapUrl(status.url);
        const attach = async (retried: boolean): Promise<void> => {
          if (!local || !useProxy) return;
          if (local.srv.outdated) {
            proxyReason = outdatedMessage(local.srv.outdated);
            return;
          }
          if (!targetPage) {
            proxyReason = "el dev server no anuncio ninguna URL — comprueba que arranca y vuelve a ejecutar perfect-front";
            return;
          }
          if (!proxyTargetOf(targetPage)) {
            proxyReason = "el destino no es HTTP (el proxy no soporta HTTPS) — abre el proyecto por su URL http o usa un dev server sin HTTPS";
            return;
          }
          try {
            // Proxy como hijo administrado (sobrevive a este comando; se detiene con `stop`).
            const px = await ensureManagedProxy({
              root: target.root,
              stateDir,
              projectId: local.project.id,
              targetUrl: targetPage,
              ...(io.proxyPort !== undefined ? { listenPort: io.proxyPort } : {}),
              ...(io.signal ? { signal: io.signal } : {}),
              // Si el dev server es administrado, su muerte se lleva al proxy (vigilante).
              onSpawn: (pid) => {
                if (status.managed && status.pid) spawnGuard(status.pid, pid);
              },
            });
            const pageOnProxy = swapOrigin(targetPage, px.state.baseUrl);
            local = { ...local, project: await registerProject(local.srv.discovery, target.root, pageOnProxy, targetPage) };
            proxy = { baseUrl: px.state.baseUrl, port: px.state.port, url: pageOnProxy, targetUrl: targetPage };
          } catch (e) {
            const msg = (e as Error).message;
            await stopProxy(target.root).catch(() => undefined);
            if (!retried && /HTTP 4\d\d/.test(msg)) {
              // Registro con targetUrl rechazado: servidor desactualizado -> reemplazo (si es nuestro) y reintento.
              const r = await ensureServer(stateDir, { ...serverOpts, force: true });
              local = { srv: r, project: await registerProject(r.discovery, target.root, targetPage) };
              return attach(true);
            }
            proxyReason = `no se pudo iniciar el proxy (${msg}) — revisa el motivo y vuelve a ejecutar perfect-front (o usa --no-proxy)`;
            local = { ...local, project: await registerProject(local.srv.discovery, target.root, targetPage).catch(() => local!.project) };
          }
        };
        await attach(false);
        const warnings: string[] = [];
        const shouldOpen = parsed.command === "default" && !parsed.noOpen && status.url !== null;
        const pageLink = proxy?.url ?? targetPage;
        if (shouldOpen && pageLink) open(pageLink);
        const r = report(action, status, local, shouldOpen, proxy, proxyReason);
        emit(
          { ...r.data, ...(warnings.length > 0 ? { warnings } : {}) },
          [...r.lines, ...warnings, ...(shouldOpen ? [`Abriendo ${pageLink}`] : [])].join("\n"),
        );
        return EXIT.OK;
      }
    }
  } catch (err) {
    if (io.signal?.aborted) {
      if (json) out(JSON.stringify({ ok: false, error: { code: "process_error", message: "Interrumpido" } }));
      else io.stderr("Interrumpido\n");
      return EXIT.INTERRUPTED;
    }
    const data = err instanceof ServerNotRunningError ? { code: "process_error" as const, message: err.message } : toErrorData(err);
    const logs = err instanceof StartError || err instanceof ServerStartError ? err.logs : undefined;
    if (json) out(JSON.stringify({ ok: false, error: data, ...(logs ? { logs } : {}) }));
    else {
      io.stderr(`Error: ${data.message}\n`);
      if (logs && logs.length > 0) io.stderr(`Ultimas lineas de salida:\n${logs.map((l) => "  " + l).join("\n")}\n`);
    }
    return exitCodeFor(err);
  }
}
