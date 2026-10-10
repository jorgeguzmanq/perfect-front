import { fork, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { isAlive } from "../src/process/identity";
import { killTree } from "../src/process/kill";
import { readState } from "../src/process/state";

// Procesos reales (bin con tsx), stateDir temporal y puertos dinamicos: no toca %LOCALAPPDATA%.
// Apagado "limpio" por el canal IPC ("shutdown" = Ctrl+C): en Windows kill("SIGINT") termina sin handlers.
// Apagado "sucio" por SIGKILL (TerminateProcess / taskkill /F).
const BIN = fileURLToPath(new URL("../bin/comment.mjs", import.meta.url));
const DEV = `
import http from "node:http";
const srv = http.createServer((_, res) => res.end("ok"));
srv.listen(0, () => console.log("  Local:   http://localhost:" + srv.address().port + "/"));
`;

interface Sess {
  child: ChildProcess;
  root: string;
  out: () => string;
  exited: Promise<number | null>;
}

let dirs: string[] = [];
let sessions: Sess[] = [];
const seenPids = new Set<number>();

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
  const root = tmp("pf-fg-proj-");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fx", scripts: { dev: "node dev.mjs" } }));
  fs.writeFileSync(path.join(root, "dev.mjs"), DEV);
  return root;
}

function launch(root: string, stateDir: string): Sess {
  const child = fork(BIN, ["--no-open", "--command", "node dev.mjs", "--url", "http://localhost:59999/", "--state-dir", stateDir, "--server-port", "0"], {
    cwd: root,
    execArgv: [],
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let buf = "";
  child.stdout?.on("data", (d) => (buf += d));
  child.stderr?.on("data", (d) => (buf += d));
  const exited = new Promise<number | null>((r) => child.once("exit", (c) => r(c)));
  const s = { child, root, out: () => buf, exited };
  sessions.push(s);
  return s;
}

const ready = (s: Sess): Promise<string> => waitFor(() => s.out().includes("En primer plano") && s.out(), 90_000, "sesion lista");
const readDisc = (stateDir: string): { pid: number; port: number; cliToken: string } | null => {
  try {
    return JSON.parse(fs.readFileSync(path.join(stateDir, "discovery.json"), "utf8"));
  } catch {
    return null;
  }
};
const track = (stateDir: string, root: string): { dev: number; server: number } => {
  const dev = readState(root)!.pid;
  const server = readDisc(stateDir)!.pid;
  seenPids.add(dev);
  seenPids.add(server);
  return { dev, server };
};
const gone = (...pids: number[]): Promise<true> => waitFor(() => pids.every((p) => !isAlive(p)) && true, 20_000, `pids muertos ${pids}`);

afterEach(async () => {
  for (const s of sessions) {
    if (s.child.pid && isAlive(s.child.pid)) await killTree(s.child.pid);
    if (s.child.pid) seenPids.add(s.child.pid);
  }
  await sleep(1500); // el vigilante/servidor se cierran solos si su dueno murio
  for (const pid of seenPids) if (isAlive(pid)) await killTree(pid);
  for (const pid of seenPids) expect(isAlive(pid), `pid ${pid} huerfano`).toBe(false);
  sessions = [];
  seenPids.clear();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  dirs = [];
});

const projectsOf = async (stateDir: string): Promise<Array<{ id: string; name: string }>> => {
  const d = readDisc(stateDir)!;
  const r = await fetch(`http://127.0.0.1:${d.port}/api/projects`, { headers: { authorization: `Bearer ${d.cliToken}` } });
  return ((await r.json()) as { projects: Array<{ id: string; name: string }> }).projects;
};

describe("perfect-front en primer plano", () => {
  it("apagado limpio: sin procesos ni estado propio, proyecto des-registrado", async () => {
    const stateDir = tmp("pf-fg-state-");
    const root = project();
    const s = launch(root, stateDir);
    const out = await ready(s);
    expect(out).toMatch(/URL del proyecto: http:\/\/127\.0\.0\.1:\d+/);
    expect(out).toMatch(/URL original: http:\/\/localhost:\d+/);
    expect(out).toContain("Capa de comentarios activa: Alt+clic sobre un elemento (o Ctrl/Cmd+Mayús+C)");
    expect(out).toContain("Servidor local: iniciado");
    const { dev, server } = track(stateDir, root);
    expect(isAlive(dev) && isAlive(server)).toBe(true);
    expect(fs.readdirSync(path.join(stateDir, "sessions"))).toHaveLength(1);
    expect(await projectsOf(stateDir)).toHaveLength(1);

    s.child.send("shutdown");
    expect(await s.exited).toBe(0);
    await gone(dev, server);
    expect(fs.existsSync(path.join(stateDir, "discovery.json"))).toBe(false);
    expect(fs.existsSync(path.join(stateDir, "server.json"))).toBe(false);
    expect(readState(root)).toBeNull();
    expect(fs.readdirSync(path.join(stateDir, "sessions"))).toHaveLength(0);
    const reg = JSON.parse(fs.readFileSync(path.join(stateDir, "projects.json"), "utf8")) as { projects: unknown[] };
    expect(reg.projects).toHaveLength(0);
  }, 120_000);

  it.runIf(process.platform !== "win32")("SIGTERM (POSIX) apaga igual", async () => {
    const stateDir = tmp("pf-fg-state-");
    const root = project();
    const s = launch(root, stateDir);
    await ready(s);
    const { dev, server } = track(stateDir, root);
    s.child.kill("SIGTERM");
    expect(await s.exited).toBe(0);
    await gone(dev, server);
  }, 120_000);

  it("muerte sucia: los hijos se cierran solos y el siguiente arranque limpia el estado obsoleto", async () => {
    const stateDir = tmp("pf-fg-state-");
    const root = project();
    const s = launch(root, stateDir);
    await ready(s);
    const first = track(stateDir, root);
    s.child.kill("SIGKILL");
    await s.exited;
    // Vigilancia del padre: servidor local (--owner-pid) y dev server (guard.mjs) se cierran solos.
    await gone(first.dev, first.server);
    expect(readState(root)).not.toBeNull(); // process.json obsoleto: nadie pudo limpiarlo
    expect(fs.existsSync(path.join(stateDir, "sessions", `${s.child.pid}.json`))).toBe(true);

    const s2 = launch(root, stateDir);
    const out = await ready(s2);
    expect(out).toContain("Servidor local: iniciado");
    const second = track(stateDir, root);
    expect(second.dev).not.toBe(first.dev);
    expect(second.server).not.toBe(first.server);
    expect(fs.readdirSync(path.join(stateDir, "sessions"))).toEqual([`${s2.child.pid}.json`]); // sesion muerta podada
    s2.child.send("shutdown");
    expect(await s2.exited).toBe(0);
    await gone(second.dev, second.server);
  }, 180_000);

  it("varias terminales: la 2a no es duena; si el dueno cae, la 2a asume el servidor", async () => {
    const stateDir = tmp("pf-fg-state-");
    const rootA = project();
    const rootB = project();
    const a = launch(rootA, stateDir);
    await ready(a);
    const pa = track(stateDir, rootA);
    const b = launch(rootB, stateDir);
    const outB = await ready(b);
    expect(outB).toContain("Servidor local: activo");
    const devB = readState(rootB)!.pid;
    seenPids.add(devB);
    expect(readDisc(stateDir)!.pid).toBe(pa.server);
    expect(await projectsOf(stateDir)).toHaveLength(2);

    // El dueno (A) muere sin limpiar -> el servidor se cierra solo; B lo detecta y lo relanza.
    a.child.kill("SIGKILL");
    await a.exited;
    await gone(pa.server);
    await waitFor(() => b.out().includes("reiniciado desde esta terminal"), 60_000, "B asume el servidor");
    const newServer = (await waitFor(() => readDisc(stateDir), 20_000, "discovery nuevo"))!.pid;
    seenPids.add(newServer);
    expect(newServer).not.toBe(pa.server);
    const names = await projectsOf(stateDir);
    expect(names.length).toBeGreaterThanOrEqual(1); // B sigue registrado (proyecto de A queda hasta que caduque su registro)
    expect(fs.existsSync(path.join(rootB, ".perfect-front"))).toBe(true); // los comentarios viven en el proyecto

    // B es ahora la duena: al salir apaga el servidor.
    b.child.send("shutdown");
    expect(await b.exited).toBe(0);
    await gone(newServer, devB);
  }, 240_000);

  it("una sesion no duena al salir solo des-registra su proyecto", async () => {
    const stateDir = tmp("pf-fg-state-");
    const rootA = project();
    const rootB = project();
    const a = launch(rootA, stateDir);
    await ready(a);
    const pa = track(stateDir, rootA);
    const b = launch(rootB, stateDir);
    await ready(b);
    const pb = track(stateDir, rootB);
    expect(pb.server).toBe(pa.server);

    b.child.send("shutdown");
    expect(await b.exited).toBe(0);
    await gone(pb.dev);
    expect(isAlive(pa.server)).toBe(true);
    expect(isAlive(pa.dev)).toBe(true);
    expect(await projectsOf(stateDir)).toHaveLength(1);

    a.child.send("shutdown");
    expect(await a.exited).toBe(0);
    await gone(pa.dev, pa.server);
  }, 240_000);
});
