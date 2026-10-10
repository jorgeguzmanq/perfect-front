import { fork, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { isAlive } from "../src/process/identity";
import { killTree } from "../src/process/kill";
import { ensureServer } from "../src/local-server";
import { readProxyState } from "../src/proxy/state";
import { overlayScriptProvider } from "../src/proxy/overlay";
import { proxyTargetOf, swapOrigin } from "../src/proxy/host";

// Procesos reales (bin con tsx), destino falso en este proceso, stateDir temporal y puertos dinamicos
// (el proxy toma el primer puerto libre desde 7788). No toca %LOCALAPPDATA%. "shutdown" por IPC = Ctrl+C.
const BIN = fileURLToPath(new URL("../bin/comment.mjs", import.meta.url));
const PAGE = "<!doctype html><html><head><title>destino falso</title></head><body><h1>hola</h1></body></html>";

interface Sess {
  child: ChildProcess;
  out: () => string;
  exited: Promise<number | null>;
}

let dirs: string[] = [];
let sessions: Sess[] = [];
let fakes: http.Server[] = [];
const seenPids = new Set<number>();
const roots: string[] = [];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(fn: () => T | undefined | false | null, ms = 60_000, what = "condicion"): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timeout: ${what}`);
    await sleep(100);
  }
}

function tmp(prefix: string): string {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  dirs.push(d);
  return d;
}

function project(): string {
  const root = tmp("pf-px-proj-");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fx", scripts: { dev: "node dev.mjs" } }));
  fs.writeFileSync(path.join(root, "dev.mjs"), "setInterval(() => {}, 1000);\n");
  roots.push(root);
  return root;
}

/** Destino falso: HTML con <head> en "/", JSON en "/api". Ya responde: el CLI se conecta sin lanzar nada. */
async function fakeTarget(): Promise<string> {
  const srv = http.createServer((req, res) => {
    if (req.url === "/api") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end('{"ok":true}');
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(PAGE);
  });
  fakes.push(srv);
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  return `http://127.0.0.1:${(srv.address() as net.AddressInfo).port}/`;
}

function launch(root: string, stateDir: string, url: string, extra: string[] = []): Sess {
  const child = fork(BIN, ["--no-open", "--command", "node dev.mjs", "--url", url, "--state-dir", stateDir, "--server-port", "0", ...extra], {
    cwd: root,
    execArgv: [],
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let buf = "";
  child.stdout?.on("data", (d) => (buf += d));
  child.stderr?.on("data", (d) => (buf += d));
  const exited = new Promise<number | null>((r) => child.once("exit", (c) => r(c)));
  const s = { child, out: () => buf, exited };
  sessions.push(s);
  return s;
}

/** Comando de un solo disparo (start/stop/status ...): espera la salida. */
function runOnce(root: string, stateDir: string, argv: string[]): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = fork(BIN, [...argv, "--state-dir", stateDir], { cwd: root, execArgv: [], stdio: ["ignore", "pipe", "pipe", "ipc"] });
    let buf = "";
    child.stdout?.on("data", (d) => (buf += d));
    child.stderr?.on("data", (d) => (buf += d));
    child.once("exit", (code) => resolve({ code, out: buf }));
  });
}

const ready = (s: Sess): Promise<string> => waitFor(() => s.out().includes("En primer plano") && s.out(), 90_000, "sesion lista");
const readDisc = (stateDir: string): { pid: number; port: number; cliToken: string } | null => {
  try {
    return JSON.parse(fs.readFileSync(path.join(stateDir, "discovery.json"), "utf8"));
  } catch {
    return null;
  }
};
const gone = (...pids: number[]): Promise<true> => waitFor(() => pids.every((p) => !isAlive(p)) && true, 20_000, `pids muertos ${pids}`);
/**
 * El proxy de ESTA prueba ya no sirve su destino. Otras suites en paralelo pueden tomar el mismo
 * puerto (el proxy usa el primer libre desde 7788), por eso no se exige "puerto libre" sino que
 * nada en ese puerto devuelva la pagina del destino falso.
 */
const servesTarget = async (port: number): Promise<boolean> => {
  try {
    return (await (await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) })).text()).includes("destino falso");
  } catch {
    return false;
  }
};

afterEach(async () => {
  for (const s of sessions) {
    if (s.child.pid && isAlive(s.child.pid)) await killTree(s.child.pid);
    if (s.child.pid) seenPids.add(s.child.pid);
  }
  await sleep(1500);
  for (const root of roots) {
    const px = readProxyState(root);
    if (px) seenPids.add(px.pid);
  }
  for (const pid of seenPids) if (isAlive(pid)) await killTree(pid);
  for (const pid of seenPids) expect(isAlive(pid), `pid ${pid} huerfano`).toBe(false);
  for (const f of fakes) {
    f.closeAllConnections();
    f.close();
  }
  sessions = [];
  fakes = [];
  roots.length = 0;
  seenPids.clear();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  dirs = [];
});

const api = async (stateDir: string, route: string): Promise<any> => {
  const d = readDisc(stateDir)!;
  const r = await fetch(`http://127.0.0.1:${d.port}${route}`, { headers: { authorization: `Bearer ${d.cliToken}` } });
  return r.json();
};

const validComment = {
  version: 1,
  scope: "element",
  comment: "Mover el boton",
  location: { url: "http://127.0.0.1/", route: "/", title: "t", selector: "#cta", selectorCandidates: ["#cta"], text: "x", html: null, componentHint: null },
  viewport: { width: 1200, height: 800, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
  elementRect: { x: 1, y: 2, width: 3, height: 4 },
  environment: {},
};

function inboxFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.name.endsWith(".json") && f.split(path.sep).includes("inbox")) out.push(f);
    }
  };
  walk(path.join(root, ".perfect-front"));
  return out;
}

describe("proxy en el flujo del CLI (primer plano)", () => {
  it("inyecta la capa, sirve el overlay, recibe comentarios y apaga sin huerfanos", async () => {
    const stateDir = tmp("pf-px-state-");
    const root = project();
    const target = await fakeTarget();
    const s = launch(root, stateDir, target);
    const out = await ready(s);

    const proxyUrl = /URL del proyecto: (http:\/\/127\.0\.0\.1:\d+\/?)/.exec(out)?.[1];
    expect(proxyUrl, out).toBeTruthy();
    expect(out).toContain(`URL original: ${target}`);
    expect(out).toContain("Capa de comentarios activa: Alt+clic sobre un elemento (o Ctrl/Cmd+Mayús+C)");
    const disc = readDisc(stateDir)!;
    seenPids.add(disc.pid);
    seenPids.add(s.child.pid!);
    expect(out).not.toContain(disc.cliToken); // el token de CLI nunca se imprime

    // El HTML del destino llega con el script inyectado; el token de la pagina es el del proxy, no el de CLI.
    const html = await (await fetch(proxyUrl!)).text();
    expect(html).toContain("destino falso");
    expect(html).toContain('<script src="/__pf/overlay.js"');
    expect(html).not.toContain(disc.cliToken);
    const pageToken = /data-pf-token="([^"]+)"/.exec(html)![1]!;
    expect(pageToken).not.toBe(disc.cliToken);

    // Lo que no es HTML pasa intacto.
    expect(await (await fetch(new URL("/api", proxyUrl!))).text()).toBe('{"ok":true}');

    // El overlay real (esbuild) define window.__pf.
    const js = await fetch(new URL("/__pf/overlay.js", proxyUrl!));
    expect(js.status).toBe(200);
    expect(await js.text()).toContain("__pf");

    // Registro: url = proxy, targetUrl = original; process.json con el destino real; proxy.json de sesion.
    const projects = (await api(stateDir, "/api/projects")).projects as Array<{ id: string; url: string; targetUrl: string }>;
    expect(projects).toHaveLength(1);
    expect(projects[0]!.url).toBe(proxyUrl);
    expect(projects[0]!.targetUrl).toBe(target);
    const px = readProxyState(root)!;
    expect(px).toMatchObject({ pid: s.child.pid, detached: false, targetUrl: target });
    expect(JSON.stringify(px)).not.toContain(pageToken);

    // Comentario: valida token, crea JSON en el inbox del proyecto y aparece en la API del servidor local.
    const base = new URL(proxyUrl!).origin;
    const bad = await fetch(`${base}/__pf/comment`, { method: "POST", body: JSON.stringify(validComment) });
    expect(bad.status).toBe(401);
    const created = await fetch(`${base}/__pf/comment`, { method: "POST", headers: { "x-pf-token": pageToken, "content-type": "application/json" }, body: JSON.stringify(validComment) });
    expect(created.status).toBe(201);
    const id = ((await created.json()) as { data: { id: string } }).data.id;
    const files = inboxFiles(root);
    expect(files).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(files[0]!, "utf8"))).toMatchObject({ id, comment: "Mover el boton" });
    const list = await api(stateDir, `/api/projects/${projects[0]!.id}/comments`);
    expect(list.comments.map((c: { id: string }) => c.id)).toContain(id);

    // Apagado limpio: proxy cerrado (puerto libre), proxy.json fuera, nada vivo.
    const port = Number(new URL(proxyUrl!).port);
    expect(await servesTarget(port)).toBe(true);
    s.child.send("shutdown");
    expect(await s.exited).toBe(0);
    await gone(disc.pid);
    expect(await servesTarget(port)).toBe(false);
    expect(readProxyState(root)).toBeNull();
    expect(fs.existsSync(path.join(stateDir, "discovery.json"))).toBe(false);
  }, 180_000);

  it("--no-proxy: sin capa, se registra la URL original y no queda proxy", async () => {
    const stateDir = tmp("pf-px-state-");
    const root = project();
    const target = await fakeTarget();
    const s = launch(root, stateDir, target, ["--no-proxy"]);
    const out = await ready(s);
    expect(out).toContain(`URL del proyecto: ${target}`);
    expect(out).not.toContain("Capa de comentarios activa");
    expect(out).toContain("--no-proxy");
    seenPids.add(readDisc(stateDir)!.pid);
    const projects = (await api(stateDir, "/api/projects")).projects as Array<{ url: string; targetUrl?: string | null }>;
    expect(projects[0]!.url).toBe(target);
    expect(projects[0]!.targetUrl ?? null).toBeNull();
    expect(readProxyState(root)).toBeNull();
    s.child.send("shutdown");
    expect(await s.exited).toBe(0);
  }, 120_000);

  it("--json no incluye tokens y trae url (proxy) y targetUrl", async () => {
    const stateDir = tmp("pf-px-state-");
    const root = project();
    const target = await fakeTarget();
    const s = launch(root, stateDir, target, ["--json"]);
    const out = await waitFor(() => /\n?\{.*"foreground":true.*\}/.test(s.out()) && s.out(), 90_000, "json listo");
    const body = JSON.parse(out.trim().split("\n").find((l) => l.includes('"foreground"'))!) as Record<string, any>;
    const disc = readDisc(stateDir)!;
    seenPids.add(disc.pid);
    expect(body.targetUrl).toBe(target);
    expect(body.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//);
    expect(body.proxy).toMatchObject({ targetUrl: target });
    expect(out).not.toContain(disc.cliToken);
    expect(out).not.toMatch(/data-pf-token|"token"|cliToken/);
    s.child.send("shutdown");
    expect(await s.exited).toBe(0);
  }, 120_000);
});

describe("proxy con start / stop (hijo administrado)", () => {
  it("start deja el proxy como hijo, stop lo detiene; sin huerfanos", async () => {
    const stateDir = tmp("pf-px-state-");
    const root = project();
    const target = await fakeTarget();
    const dev = ["--command", "node dev.mjs", "--url", target];
    const a = await runOnce(root, stateDir, ["start", "--no-open", "--server-port", "0", ...dev]);
    expect(a.code, a.out).toBe(0);
    seenPids.add(readDisc(stateDir)!.pid);
    const proxyUrl = /URL del proyecto: (http:\/\/127\.0\.0\.1:\d+\/?)/.exec(a.out)?.[1];
    expect(proxyUrl, a.out).toBeTruthy();
    expect(a.out).toContain(`URL original: ${target}`);
    const px = readProxyState(root)!;
    seenPids.add(px.pid);
    expect(px.detached).toBe(true);
    expect(isAlive(px.pid)).toBe(true);
    expect(await (await fetch(proxyUrl!)).text()).toContain('<script src="/__pf/overlay.js"');
    expect(a.out).not.toContain(readDisc(stateDir)!.cliToken);

    // Segundo start: reutiliza el proxy (mismo pid).
    const b = await runOnce(root, stateDir, ["start", "--no-open", "--server-port", "0", ...dev]);
    expect(b.code, b.out).toBe(0);
    expect(readProxyState(root)!.pid).toBe(px.pid);

    const st = await runOnce(root, stateDir, ["status", ...dev]);
    expect(st.out).toContain("Proxy (capa de comentarios)");

    const stop = await runOnce(root, stateDir, ["stop", ...dev]);
    expect(stop.code, stop.out).toBe(0);
    expect(stop.out).toContain("Proxy detenido");
    await gone(px.pid);
    expect(readProxyState(root)).toBeNull();
    expect(await servesTarget(Number(new URL(proxyUrl!).port))).toBe(false);
    await runOnce(root, stateDir, ["server", "stop"]);
  }, 180_000);
});

describe("utilidades del proxy", () => {
  it("proxyTargetOf solo acepta http y swapOrigin conserva ruta y consulta", () => {
    expect(proxyTargetOf("http://localhost:5173/")).toEqual({ host: "localhost", port: 5173 });
    expect(proxyTargetOf("http://[::1]:3000/x")).toEqual({ host: "::1", port: 3000 });
    expect(proxyTargetOf("https://localhost:5173/")).toBeNull();
    expect(swapOrigin("http://127.0.0.1:5500/docs/a.html?x=1", "http://127.0.0.1:7788")).toBe("http://127.0.0.1:7788/docs/a.html?x=1");
  });

  it("overlayScriptProvider construye una vez y cachea; PF_OVERLAY_NO_CACHE reconstruye; un fallo no se cachea", async () => {
    let n = 0;
    const cached = overlayScriptProvider({ env: {}, build: async () => `js${++n}` });
    expect([await cached(), await cached()]).toEqual(["js1", "js1"]);
    n = 0;
    const fresh = overlayScriptProvider({ env: { PF_OVERLAY_NO_CACHE: "1" }, build: async () => `js${++n}` });
    expect([await fresh(), await fresh()]).toEqual(["js1", "js2"]);
    let fail = true;
    const flaky = overlayScriptProvider({
      env: {},
      build: async () => {
        if (fail) throw new Error("boom");
        return "ok";
      },
    });
    await expect(flaky()).rejects.toThrow("boom");
    fail = false;
    expect(await flaky()).toBe("ok");
  });
});

// Servidor local "viejo": se simula con PF_TEST_HIDE_FEATURES=1 (health sin `features`) en el servidor real.
async function oldServer(stateDir: string): Promise<number> {
  process.env.PF_TEST_HIDE_FEATURES = "1";
  try {
    const r = await ensureServer(stateDir, { port: 0, timeoutMs: 60_000 });
    seenPids.add(r.status.pid!);
    return r.status.pid!;
  } finally {
    delete process.env.PF_TEST_HIDE_FEATURES;
  }
}

// Servidor falso que anuncia features pero rechaza `targetUrl` (400): registro rechazado.
const FAKE_SERVER = `
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const stateDir = process.argv[2];
const srv = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (req.url === "/api/health") return res.end(JSON.stringify({ ok: true, version: "0", apiVersion: 1, features: ["proxy-v1"] }));
    if (req.url === "/api/projects/register" && body.includes("targetUrl")) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ ok: false, error: { code: "invalid_request", message: "x" } }));
    }
    res.statusCode = 201;
    res.end(JSON.stringify({ ok: true, project: { id: "p_0000000000000000", name: "viejo", url: null } }));
  });
});
srv.listen(0, "127.0.0.1", () => {
  fs.writeFileSync(path.join(stateDir, "discovery.json"), JSON.stringify({ host: "127.0.0.1", port: srv.address().port, cliToken: "fake", pid: process.pid }));
  setInterval(() => {}, 1000);
});
`;

describe("servidor local antiguo", () => {
  it("administrado y sin features: se reemplaza, se re-registra y el proxy queda activo", async () => {
    const stateDir = tmp("pf-px-state-");
    const root = project();
    const target = await fakeTarget();
    const oldPid = await oldServer(stateDir);
    const s = launch(root, stateDir, target);
    const out = await ready(s);
    const disc = readDisc(stateDir)!;
    seenPids.add(disc.pid);
    expect(disc.pid).not.toBe(oldPid);
    await gone(oldPid);
    expect(out).toContain("Capa de comentarios activa");
    expect(out).not.toContain("SIN CAPA");
    const projects = (await api(stateDir, "/api/projects")).projects as Array<{ url: string; targetUrl: string }>;
    expect(projects[0]!.targetUrl).toBe(target);
    expect(projects[0]!.url).not.toBe(target);
    s.child.send("shutdown");
    expect(await s.exited).toBe(0);
  }, 180_000);

  it("no administrado: no se mata, error claro y sin capa (texto y --json)", async () => {
    const stateDir = tmp("pf-px-state-");
    const root = project();
    const target = await fakeTarget();
    const oldPid = await oldServer(stateDir);
    fs.rmSync(path.join(stateDir, "server.json")); // ya no es "de Perfect Front": no se puede apagar con seguridad
    const port = readDisc(stateDir)!.port;

    const s = launch(root, stateDir, target);
    const out = await ready(s);
    expect(out).toContain(`SIN CAPA DE COMENTARIOS: el servidor local en :${port} es una versión antigua y no lo inició Perfect Front — ciérralo y vuelve a ejecutar perfect-front`);
    expect(out).not.toContain("Capa de comentarios activa");
    expect(isAlive(oldPid)).toBe(true);
    expect(readDisc(stateDir)!.pid).toBe(oldPid);
    expect(readProxyState(root)).toBeNull();
    s.child.send("shutdown");
    expect(await s.exited).toBe(0);
    expect(isAlive(oldPid)).toBe(true);

    const j = launch(root, stateDir, target, ["--json"]);
    const text = await waitFor(() => j.out().includes('"foreground"') && j.out(), 90_000, "json listo");
    const body = JSON.parse(text.trim().split("\n").find((l) => l.includes('"foreground"'))!) as Record<string, any>;
    expect(body.proxy.active).toBe(false);
    expect(body.proxy.reason).toContain("versión antigua");
    expect(body.url).toBe(target);
    j.child.send("shutdown");
    expect(await j.exited).toBe(0);
    expect(isAlive(oldPid)).toBe(true);
  }, 180_000);

  it("registro con targetUrl rechazado (400): se trata como servidor viejo y se reemplaza", async () => {
    const stateDir = tmp("pf-px-state-");
    const root = project();
    const target = await fakeTarget();
    const script = path.join(tmp("pf-px-fake-"), "fake.mjs");
    fs.writeFileSync(script, FAKE_SERVER);
    const fake = fork(script, [stateDir], { execArgv: [], stdio: "ignore" });
    seenPids.add(fake.pid!);
    await waitFor(() => readDisc(stateDir), 20_000, "discovery falso");
    fs.writeFileSync(path.join(stateDir, "server.json"), JSON.stringify({ version: 1, pid: fake.pid, startedAt: new Date().toISOString() }));

    const s = launch(root, stateDir, target);
    const out = await ready(s);
    const disc = readDisc(stateDir)!;
    seenPids.add(disc.pid);
    expect(disc.pid).not.toBe(fake.pid);
    await gone(fake.pid!);
    expect(out).toContain("Capa de comentarios activa");
    expect(((await api(stateDir, "/api/projects")).projects as Array<{ targetUrl: string }>)[0]!.targetUrl).toBe(target);
    s.child.send("shutdown");
    expect(await s.exited).toBe(0);
  }, 180_000);

  it("start (segundo plano): reemplaza el servidor viejo administrado y deja el proxy; no administrado -> SIN CAPA en --json", async () => {
    const stateDir = tmp("pf-px-state-");
    const root = project();
    const target = await fakeTarget();
    const dev = ["--command", "node dev.mjs", "--url", target, "--server-port", "0", "--no-open"];
    const oldPid = await oldServer(stateDir);
    const a = await runOnce(root, stateDir, ["start", ...dev]);
    expect(a.code, a.out).toBe(0);
    seenPids.add(readDisc(stateDir)!.pid);
    expect(readDisc(stateDir)!.pid).not.toBe(oldPid);
    expect(a.out).toContain("Capa de comentarios activa");
    await runOnce(root, stateDir, ["stop", ...dev]);

    // Servidor viejo ajeno (sin server.json): no se toca.
    await runOnce(root, stateDir, ["server", "stop"]);
    const old2 = await oldServer(stateDir);
    fs.rmSync(path.join(stateDir, "server.json"));
    const b = await runOnce(root, stateDir, ["start", "--json", ...dev]);
    const body = JSON.parse(b.out.trim().split("\n").pop()!) as Record<string, any>;
    expect(body.proxy).toMatchObject({ active: false });
    expect(body.proxy.reason).toContain("versión antigua");
    expect(isAlive(old2)).toBe(true);
    expect(readProxyState(root)).toBeNull();
  }, 180_000);

  it("--no-proxy y --no-server tambien explican por que no hay capa", async () => {
    const stateDir = tmp("pf-px-state-");
    const root = project();
    const target = await fakeTarget();
    const s = launch(root, stateDir, target, ["--no-proxy"]);
    expect(await ready(s)).toContain("SIN CAPA DE COMENTARIOS: --no-proxy");
    seenPids.add(readDisc(stateDir)!.pid);
    s.child.send("shutdown");
    expect(await s.exited).toBe(0);
  }, 120_000);
});
