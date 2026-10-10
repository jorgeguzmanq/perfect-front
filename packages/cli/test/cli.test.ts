import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectAnnouncedUrl, ensureRunning, getStatus, readLogs, resolveSpawn, StartError, stopManaged, type Target } from "../src/process";
import { isAlive } from "../src/process/identity";
import { readState, statePath, writeFileAtomic } from "../src/process/state";
import { EXIT, runCli } from "../src/run";

const SERVER = `
import http from "node:http";
const prefer = Number(process.argv[2] || 0);
const srv = http.createServer((_, res) => res.end("ok"));
const announce = () => console.log("  \\x1b[32m➜\\x1b[39m  Local:   http://localhost:" + srv.address().port + "/");
srv.once("error", () => srv.listen(0, announce));
srv.listen(prefer, announce);
`;
const FAILING = `console.error("error: Port 5173 is already in use"); process.exit(1);`;

let dirs: string[] = [];
let servers: http.Server[] = [];
let roots: string[] = [];
let pids: number[] = [];

function fixture(): { root: string; target: (prefer?: number, url?: string | null) => Target } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pf-cli-"));
  dirs.push(root);
  roots.push(root);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fx", scripts: { dev: "node server.mjs" } }));
  fs.writeFileSync(path.join(root, "server.mjs"), SERVER);
  fs.writeFileSync(path.join(root, "fail.mjs"), FAILING);
  return {
    root,
    target: (prefer = 0, url = null) => ({
      root,
      plan: { command: "node", args: ["server.mjs", String(prefer)], cwd: root },
      url,
    }),
  };
}

function listen(): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer((_, res) => res.end("external"));
    servers.push(server);
    server.listen(0, () => resolve({ server, port: (server.address() as net.AddressInfo).port }));
  });
}

async function freePort(): Promise<number> {
  const { server, port } = await listen();
  await new Promise((r) => server.close(r));
  return port;
}

const track = (pid: number | null): void => void (pid && pids.push(pid));

beforeEach(() => {
  dirs = [];
  servers = [];
  roots = [];
  pids = [];
});

afterEach(async () => {
  for (const r of roots) {
    const st = readState(r);
    if (st) pids.push(st.pid);
    await stopManaged({ root: r, url: null });
  }
  for (const s of servers) s.close();
  await new Promise((r) => setTimeout(r, 200));
  const orphans = pids.filter((p) => isAlive(p));
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  expect(orphans, "procesos huerfanos").toEqual([]);
});

describe("proceso administrado", () => {
  it("inicia, detecta la URL anunciada y confirma HTTP", async () => {
    const fx = fixture();
    const { action, status } = await ensureRunning(fx.target());
    track(status.pid);
    expect(action).toBe("started");
    expect(status).toMatchObject({ state: "running", managed: true, ready: true });
    expect(status.url).toMatch(/^http:\/\/localhost:\d+\/$/);
    expect(readState(fx.root)?.pid).toBe(status.pid);
  });

  it("se conecta si ya esta activo y no lanza un segundo proceso sobre la misma URL", async () => {
    const fx = fixture();
    const first = await ensureRunning(fx.target());
    track(first.status.pid);
    const second = await ensureRunning(fx.target(0, first.status.url));
    expect(second.action).toBe("connected");
    expect(second.status.pid).toBe(first.status.pid);
    expect(second.status.managed).toBe(true);
  });

  it("trata un servidor ya activo en la URL como externo y no lo inicia ni lo detiene", async () => {
    const fx = fixture();
    const ext = await listen();
    const url = `http://localhost:${ext.port}/`;
    const res = await ensureRunning(fx.target(0, url));
    expect(res.action).toBe("connected");
    expect(res.status).toMatchObject({ state: "external", managed: false, pid: null });
    expect(readState(fx.root)).toBeNull();
    expect(await stopManaged(fx.target(0, url))).toEqual({ outcome: "external", url });
    expect((await fetch(url)).status).toBe(200); // sigue vivo
  });

  it("se recupera cuando el puerto preferido esta ocupado", async () => {
    const fx = fixture();
    const busy = await listen();
    const { status } = await ensureRunning(fx.target(busy.port));
    track(status.pid);
    expect(status.port).not.toBe(busy.port);
    expect(status.ready).toBe(true);
  });

  it("detiene solo el administrado y deja limpio el estado", async () => {
    const fx = fixture();
    const ext = await listen();
    const { status } = await ensureRunning(fx.target());
    track(status.pid);
    const r = await stopManaged(fx.target(0, status.url));
    expect(r).toEqual({ outcome: "stopped", pid: status.pid });
    expect(isAlive(status.pid as number)).toBe(false);
    expect(readState(fx.root)).toBeNull();
    expect((await fetch(`http://localhost:${ext.port}/`)).status).toBe(200);
    expect((await getStatus({ root: fx.root, url: null })).state).toBe("stopped");
  });

  it("no mata un PID ajeno si la metadata no coincide (PID reciclado)", async () => {
    const fx = fixture();
    writeFileAtomic(
      statePath(fx.root),
      JSON.stringify({
        version: 1,
        pid: process.pid,
        startedAt: "2001-01-01T00:00:00.000Z",
        command: "x",
        args: [],
        cwd: fx.root,
        url: null,
        port: null,
        logFile: "x",
      }),
    );
    expect(await stopManaged({ root: fx.root, url: null })).toEqual({ outcome: "none" });
    expect(isAlive(process.pid)).toBe(true);
    expect(readState(fx.root)).toBeNull();
  });

  it("estado corrupto se ignora", async () => {
    const fx = fixture();
    fs.mkdirSync(path.dirname(statePath(fx.root)), { recursive: true });
    fs.writeFileSync(statePath(fx.root), "{no json");
    expect((await getStatus({ root: fx.root, url: null })).state).toBe("stopped");
  });

  it("entrega logs utiles cuando el proceso falla", async () => {
    const fx = fixture();
    const t: Target = { root: fx.root, plan: { command: "node", args: ["fail.mjs"], cwd: fx.root }, url: null };
    const err = await ensureRunning(t, { startTimeoutMs: 10_000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StartError);
    expect((err as StartError).logs.join("\n")).toContain("already in use");
    expect(readState(fx.root)).toBeNull();
    expect(readLogs(fx.root, 5)?.join("\n")).toContain("already in use");
  });

  it("falla con timeout si no hay URL y mata el proceso", async () => {
    const fx = fixture();
    fs.writeFileSync(path.join(fx.root, "silent.mjs"), "setInterval(() => {}, 1000);");
    const t: Target = { root: fx.root, plan: { command: "node", args: ["silent.mjs"], cwd: fx.root }, url: null };
    await expect(ensureRunning(t, { startTimeoutMs: 800 })).rejects.toBeInstanceOf(StartError);
    expect(readState(fx.root)).toBeNull();
  });
});

describe("CLI y JSON", () => {
  const run = async (argv: string[], cwd: string, extra: Partial<Parameters<typeof runCli>[1]> = {}) => {
    let stdout = "";
    let stderr = "";
    const opened: string[] = [];
    const code = await runCli(argv, {
      stdout: (s) => void (stdout += s),
      stderr: (s) => void (stderr += s),
      cwd,
      openBrowser: (u) => void opened.push(u),
      localServer: false,
      ...extra,
    });
    return { code, stdout, stderr, opened };
  };

  it("--version y --help", async () => {
    const v = await run(["--version", "--json"], os.tmpdir());
    expect(JSON.parse(v.stdout)).toEqual({ ok: true, version: "0.0.0" });
    const h = await run(["--help"], os.tmpdir());
    expect(h.code).toBe(EXIT.OK);
    expect(h.stdout).toContain("comment");
  });

  it("uso incorrecto devuelve 2 y JSON de error", async () => {
    const r = await run(["bogus", "--json"], os.tmpdir());
    expect(r.code).toBe(EXIT.USAGE);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect((await run(["--port", "abc"], os.tmpdir())).code).toBe(EXIT.USAGE);
  });

  it("flujo completo: start --json, status, open, logs, stop", async () => {
    const fx = fixture();
    const base = ["--command", "node server.mjs 0", "--url", `http://localhost:${await freePort()}/`, "--json"];
    const start = await run(["start", ...base], fx.root);
    expect(start.code).toBe(EXIT.OK);
    const s = JSON.parse(start.stdout);
    track(s.pid);
    expect(s).toMatchObject({ ok: true, command: "start", action: "started", managed: true, state: "running", opened: false });
    expect(start.opened).toEqual([]);

    // La URL por defecto detectada puede diferir de la real: status usa la metadata administrada.
    const st = await run(["status", ...base], fx.root);
    expect(st.code).toBe(EXIT.OK);
    expect(JSON.parse(st.stdout)).toMatchObject({ state: "running", managed: true, pid: s.pid, url: s.url });

    const op = await run(["open", ...base], fx.root);
    expect(op.opened).toEqual([s.url]);

    const again = await run(["--detach", ...base], fx.root);
    expect(JSON.parse(again.stdout)).toMatchObject({ action: "connected", opened: true, pid: s.pid });
    expect(again.opened).toEqual([s.url]);
    const noOpen = await run(["--detach", "--no-open", ...base], fx.root);
    expect(noOpen.opened).toEqual([]);

    const logs = await run(["logs", "-n", "5", "--json"], fx.root);
    expect(JSON.parse(logs.stdout).lines.join("\n")).toContain("Local:");

    const stop = await run(["stop", ...base], fx.root);
    expect(JSON.parse(stop.stdout)).toEqual({ ok: true, command: "stop", outcome: "stopped", pid: s.pid });
    expect(isAlive(s.pid)).toBe(false);
    expect((await run(["status", ...base], fx.root)).code).toBe(EXIT.NOT_RUNNING);
  });

  it("falla de arranque: codigo 4 con logs en JSON", async () => {
    const fx = fixture();
    const r = await run(["start", "--command", "node fail.mjs", "--url", `http://localhost:${await freePort()}/`, "--json"], fx.root, { startTimeoutMs: 10_000 });
    expect(r.code).toBe(EXIT.PROCESS);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(false);
    expect(j.logs.join("\n")).toContain("already in use");
  });

  it("directorio sin proyecto devuelve 3", async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "pf-empty-"));
    dirs.push(empty);
    expect((await run(["start"], empty)).code).toBe(EXIT.PROJECT);
  });
});

describe("utilidades", () => {
  it("detecta la URL de Vite con colores ANSI", () => {
    expect(detectAnnouncedUrl("  \u001b[32m➜\u001b[39m  Local:   \u001b[36mhttp://localhost:\u001b[1m5174\u001b[22m/\u001b[39m")).toBe("http://localhost:5174/");
    expect(detectAnnouncedUrl("nada")).toBeNull();
  });

  it("windows: rechaza argumentos con metacaracteres de cmd", () => {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), "pf-bin-"));
    dirs.push(bin);
    fs.writeFileSync(path.join(bin, "pnpm.cmd"), "@echo off");
    const env = { PATH: bin, ComSpec: "C:\\Windows\\System32\\cmd.exe" };
    const ok = resolveSpawn("pnpm", ["dev", "--port=3000"], { platform: "win32", env });
    expect(ok.windowsVerbatimArguments).toBe(true);
    expect(ok.args[3]).toContain("pnpm.cmd");
    expect(() => resolveSpawn("pnpm", ["dev & calc"], { platform: "win32", env })).toThrow();
    expect(() => resolveSpawn("nope", [], { platform: "win32", env })).toThrow();
    expect(resolveSpawn("pnpm", ["a b"], { platform: "linux" })).toEqual({ file: "pnpm", args: ["a b"], windowsVerbatimArguments: false });
  });
});
