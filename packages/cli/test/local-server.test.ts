import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureServer, getServerStatus, registerProject, serverStatePath, stopServer } from "../src/local-server";
import { isAlive } from "../src/process/identity";
import { killTree } from "../src/process/kill";
import { stopManaged } from "../src/process";
import { stopProxy } from "../src/proxy/state";
import { EXIT, runCli } from "../src/run";

// Todo ocurre en directorios de estado temporales y puertos efimeros: nunca toca %LOCALAPPDATA%.
const DEV_SERVER = `
import http from "node:http";
const srv = http.createServer((_, res) => res.end("ok"));
srv.listen(0, () => console.log("  Local:   http://localhost:" + srv.address().port + "/"));
`;

let dirs: string[] = [];
const serverPids = new Set<number>();
const projectRoots: string[] = [];

function tmp(prefix: string): string {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  dirs.push(d);
  return d;
}

function project(): string {
  const root = tmp("pf-cli-proj-");
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "fx", scripts: { dev: "node dev.mjs" } }));
  fs.writeFileSync(path.join(root, "dev.mjs"), DEV_SERVER);
  projectRoots.push(root);
  return root;
}

afterEach(async () => {
  // Teardown: sin procesos huerfanos (servidores locales ni dev servers).
  for (const root of projectRoots) {
    await stopProxy(root);
    await stopManaged({ root, url: null });
  }
  for (const pid of serverPids) {
    await killTree(pid);
    expect(isAlive(pid)).toBe(false);
  }
  serverPids.clear();
  projectRoots.length = 0;
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  dirs = [];
});

const opts = { port: 0, timeoutMs: 60_000 } as const;

describe("servidor local administrado", () => {
  it("arranca, registra el proyecto y se reutiliza si ya corre", async () => {
    const stateDir = tmp("pf-cli-state-");
    const root = project();

    const first = await ensureServer(stateDir, opts);
    serverPids.add(first.status.pid!);
    expect(first.action).toBe("started");
    expect(first.status).toMatchObject({ state: "running", managed: true });
    expect(fs.existsSync(path.join(stateDir, "discovery.json"))).toBe(true);
    expect(isAlive(first.status.pid!)).toBe(true);
    const health = await fetch(`${first.status.url}/api/health`);
    expect(((await health.json()) as { ok: boolean }).ok).toBe(true);

    const reg = await registerProject(first.discovery, root, "http://localhost:5173/");
    expect(reg).toMatchObject({ name: expect.any(String), id: expect.stringMatching(/^p_/) });
    const list = await fetch(`${first.status.url}/api/projects`, { headers: { authorization: `Bearer ${first.discovery.cliToken}` } });
    expect(((await list.json()) as { projects: Array<{ id: string }> }).projects.map((p) => p.id)).toContain(reg.id);

    const second = await ensureServer(stateDir, opts);
    expect(second.action).toBe("connected");
    expect(second.status.pid).toBe(first.status.pid);
    expect(second.status.managed).toBe(true);
  }, 90_000);

  it("stop detiene el administrado y limpia discovery.json y server.json", async () => {
    const stateDir = tmp("pf-cli-state-");
    const r = await ensureServer(stateDir, opts);
    const pid = r.status.pid!;
    serverPids.add(pid);

    expect(await stopServer(stateDir)).toEqual({ outcome: "stopped", pid });
    expect(isAlive(pid)).toBe(false);
    expect(fs.existsSync(path.join(stateDir, "discovery.json"))).toBe(false);
    expect(fs.existsSync(serverStatePath(stateDir))).toBe(false);
    expect((await getServerStatus(stateDir)).state).toBe("stopped");
    expect(await stopServer(stateDir)).toEqual({ outcome: "none" });
  }, 90_000);

  it("stop no toca un servidor que no inicio Perfect Front", async () => {
    const stateDir = tmp("pf-cli-state-");
    const r = await ensureServer(stateDir, opts);
    const pid = r.status.pid!;
    serverPids.add(pid);

    fs.rmSync(serverStatePath(stateDir)); // ya no es "administrado"
    expect((await getServerStatus(stateDir)).managed).toBe(false);
    expect(await stopServer(stateDir)).toEqual({ outcome: "external", url: r.status.url });
    expect(isAlive(pid)).toBe(true);

    // PID reciclado: server.json apuntando a un proceso ajeno (este test) con otra hora de inicio.
    fs.writeFileSync(serverStatePath(stateDir), JSON.stringify({ version: 1, pid: process.pid, startedAt: "2000-01-01T00:00:00.000Z" }));
    expect((await stopServer(stateDir)).outcome).toBe("external");
    expect(isAlive(process.pid)).toBe(true);
    expect(isAlive(pid)).toBe(true);
  }, 90_000);

  it("un fallo de arranque limpia el estado y reporta el log", async () => {
    const stateDir = tmp("pf-cli-state-");
    const bad = path.join(stateDir, "bad.mjs");
    fs.writeFileSync(bad, 'console.error("boom"); process.exit(1);');
    await expect(
      ensureServer(stateDir, { timeoutMs: 10_000, launch: { file: process.execPath, args: [bad], cwd: stateDir } }),
    ).rejects.toMatchObject({ name: "ServerStartError", logs: expect.arrayContaining(["boom"]) });
    expect(fs.existsSync(serverStatePath(stateDir))).toBe(false);
  }, 30_000);
});

describe("comment (flujo completo)", () => {
  it("inicia dev server + servidor local, registra y muestra la pista de la extension; segunda corrida reutiliza", async () => {
    const stateDir = tmp("pf-cli-state-");
    const root = project();
    const dev = ["--command", "node dev.mjs", "--url", "http://localhost:59999/"];
    const run = async (argv: string[]) => {
      let stdout = "";
      let stderr = "";
      const code = await runCli([...argv, ...dev], {
        stdout: (s) => void (stdout += s),
        stderr: (s) => void (stderr += s),
        cwd: root,
        stateDir,
        serverPort: 0,
        serverTimeoutMs: 60_000,
        openBrowser: () => undefined,
      });
      return { code, stdout, stderr };
    };

    const a = await run(["start", "--no-open"]);
    expect(a.code).toBe(EXIT.OK);
    expect(a.stdout).toMatch(/URL del proyecto: http:\/\/127\.0\.0\.1:\d+/);
    expect(a.stdout).toMatch(/URL original: http:\/\/localhost:\d+/);
    expect(a.stdout).toContain("Capa de comentarios activa: Alt+clic sobre un elemento (o Ctrl/Cmd+Mayús+C)");
    expect(a.stdout).toContain("Servidor local: iniciado");
    expect(a.stdout).toContain("Proyecto registrado:");
    expect(a.stdout).toContain("La extensión Perfect Front es opcional");
    expect(a.stdout).not.toMatch(/emparej|Codigo|pair/i);

    const j = await run(["start", "--json"]);
    expect(j.code).toBe(EXIT.OK);
    const body = JSON.parse(j.stdout) as Record<string, any>;
    serverPids.add(body.localServer.pid);
    expect(body).toMatchObject({ ok: true, action: "connected", localServer: { action: "connected", managed: true } });
    expect(j.stdout).not.toMatch(/pairing|emparej/i);
    expect(body.registered.id).toMatch(/^p_/);
    expect(j.stdout).not.toMatch(/cliToken|"token"/);
    expect(a.stdout).not.toContain(fs.readFileSync(path.join(stateDir, "discovery.json"), "utf8").match(/"cliToken": "([^"]+)"/)![1]!);

    const st = await run(["server", "status", "--json"]);
    expect(JSON.parse(st.stdout)).toMatchObject({ state: "running", managed: true, pid: body.localServer.pid });
    const stop = await run(["server", "stop", "--json"]);
    expect(JSON.parse(stop.stdout)).toMatchObject({ outcome: "stopped", pid: body.localServer.pid });
    expect(isAlive(body.localServer.pid)).toBe(false);
    expect((await run(["server", "status"])).code).toBe(EXIT.NOT_RUNNING);
    expect((await run(["server", "bogus"])).code).toBe(EXIT.USAGE);
  }, 120_000);
});
