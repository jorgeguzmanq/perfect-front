import { fork, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { isAlive } from "../src/process/identity";
import { killTree } from "../src/process/kill";
import { readState } from "../src/process/state";

// Procesos reales (bin con tsx), carpeta HTML sin package.json, stateDir temporal y puertos dinamicos.
// "shutdown" por IPC equivale a Ctrl+C (en Windows kill("SIGINT") termina sin handlers).
const BIN = fileURLToPath(new URL("../bin/comment.mjs", import.meta.url));

interface Sess {
  child: ChildProcess;
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

function site(files: Record<string, string>): string {
  const root = tmp("pf-fg-static-");
  for (const [rel, body] of Object.entries(files)) {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
  }
  return root;
}

function launch(root: string, stateDir: string, extra: string[] = []): Sess {
  const child = fork(BIN, ["--no-open", "--state-dir", stateDir, "--server-port", "0", ...extra], {
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

const ready = (s: Sess): Promise<string> => waitFor(() => s.out().includes("En primer plano") && s.out(), 90_000, "sesion lista");
const readDisc = (stateDir: string): { pid: number; port: number; cliToken: string } | null => {
  try {
    return JSON.parse(fs.readFileSync(path.join(stateDir, "discovery.json"), "utf8"));
  } catch {
    return null;
  }
};
const gone = (...pids: number[]): Promise<true> => waitFor(() => pids.every((p) => !isAlive(p)) && true, 20_000, `pids muertos ${pids}`);

afterEach(async () => {
  for (const s of sessions) {
    if (s.child.pid && isAlive(s.child.pid)) await killTree(s.child.pid);
    if (s.child.pid) seenPids.add(s.child.pid);
  }
  await sleep(1500);
  for (const pid of seenPids) if (isAlive(pid)) await killTree(pid);
  for (const pid of seenPids) expect(isAlive(pid), `pid ${pid} huerfano`).toBe(false);
  sessions = [];
  seenPids.clear();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  dirs = [];
});

const projectsOf = async (stateDir: string): Promise<Array<{ id: string; name: string; url?: string | null }>> => {
  const d = readDisc(stateDir)!;
  const r = await fetch(`http://127.0.0.1:${d.port}/api/projects`, { headers: { authorization: `Bearer ${d.cliToken}` } });
  return ((await r.json()) as { projects: Array<{ id: string; name: string; url?: string | null }> }).projects;
};

describe("HTML estatico en primer plano", () => {
  it("arranca, anuncia la URL de la pagina, la registra y apaga sin procesos huerfanos", async () => {
    const stateDir = tmp("pf-fg-state-");
    const root = site({ "index.html": "<title>inicio</title>", "about.html": "<title>acerca</title>", ".env": "SECRET=1" });
    const s = launch(root, stateDir);
    const out = await ready(s);
    const m = /URL del proyecto: (http:\/\/127\.0\.0\.1:(\d+)\/index\.html)/.exec(out);
    expect(m, out).not.toBeNull();
    const url = m![1]!;
    expect(out).toContain("Servidor local: iniciado");

    const st = readState(root)!;
    const server = readDisc(stateDir)!.pid;
    seenPids.add(st.pid);
    seenPids.add(server);
    expect(isAlive(st.pid) && isAlive(server)).toBe(true);
    expect(st.url).toBe(/URL original: (\S+)/.exec(out)![1]); // process.json: el servidor estatico real, no el proxy
    expect(url).not.toBe(st.url);

    // Sirve la pagina; no el dotfile; metodo POST rechazado.
    expect(await (await fetch(url)).text()).toContain("inicio");
    expect((await fetch(`http://127.0.0.1:${m![2]}/.env`)).status).toBe(404);
    expect((await fetch(url, { method: "POST" })).status).toBe(405);

    // Registrado en el servidor local con la URL de la pagina.
    const projects = await projectsOf(stateDir);
    expect(projects).toHaveLength(1);
    expect(projects[0]!.url).toBe(url);

    // Nada escrito en la carpeta del usuario salvo .perfect-front/run (sin project.json).
    expect(fs.readdirSync(root).sort()).toEqual([".env", ".perfect-front", "about.html", "index.html"]);
    // (El servidor local puede crear project.json por defecto al registrar; el CLI nunca escribe `entry` sin confirmacion.)
    const cfgFile = path.join(root, ".perfect-front", "project.json");
    if (fs.existsSync(cfgFile)) expect(JSON.parse(fs.readFileSync(cfgFile, "utf8"))).not.toHaveProperty("entry");

    s.child.send("shutdown");
    expect(await s.exited).toBe(0);
    await gone(st.pid, server);
    expect(readState(root)).toBeNull();
    expect(fs.existsSync(path.join(stateDir, "discovery.json"))).toBe(false);
    expect(fs.readdirSync(path.join(stateDir, "sessions"))).toHaveLength(0);
  }, 120_000);

  it("--page elige otra pagina y la registra con esa URL", async () => {
    const stateDir = tmp("pf-fg-state-");
    const root = site({ "index.html": "x", "about.html": "<title>acerca</title>" });
    const s = launch(root, stateDir, ["--page", "about.html"]);
    const out = await ready(s);
    const url = /URL del proyecto: (\S+)/.exec(out)![1]!;
    expect(url.endsWith("/about.html")).toBe(true);
    seenPids.add(readState(root)!.pid);
    seenPids.add(readDisc(stateDir)!.pid);
    expect((await projectsOf(stateDir))[0]!.url).toBe(url);
    s.child.send("shutdown");
    expect(await s.exited).toBe(0);
  }, 120_000);

  it("muerte sucia de la sesion: el servidor estatico se cierra solo (vigilante del padre)", async () => {
    const stateDir = tmp("pf-fg-state-");
    const root = site({ "index.html": "x" });
    const s = launch(root, stateDir);
    await ready(s);
    const st = readState(root)!;
    seenPids.add(st.pid);
    seenPids.add(readDisc(stateDir)!.pid);
    s.child.kill("SIGKILL");
    await s.exited;
    await gone(st.pid, readDisc(stateDir)?.pid ?? st.pid);
  }, 120_000);

  it("sin index.html y sin TTY: sale con codigo 2 y la lista; no deja procesos", async () => {
    const stateDir = tmp("pf-fg-state-");
    const root = site({ "about.html": "x", "pricing.html": "x" });
    const s = launch(root, stateDir);
    expect(await s.exited).toBe(2);
    expect(s.out()).toContain("about.html");
    expect(s.out()).toContain("--page");
    expect(readState(root)).toBeNull();
    expect(fs.existsSync(path.join(root, ".perfect-front"))).toBe(false);
  }, 60_000);
});
