import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectAnnouncedUrl, ensureRunning, readLogs, StartError, stopManaged } from "../src/process";
import { isAlive } from "../src/process/identity";
import { readState } from "../src/process/state";
import { EXIT, runCli } from "../src/run";

let dirs: string[] = [];
let servers: http.Server[] = [];
let pids: number[] = [];

const mkdir = (): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "pf-fw-"));
  dirs.push(d);
  return d;
};

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

beforeEach(() => {
  dirs = [];
  servers = [];
  pids = [];
});

afterEach(async () => {
  for (const d of dirs) {
    const st = readState(d);
    if (st) pids.push(st.pid);
    await stopManaged({ root: d, url: null });
  }
  for (const s of servers) s.close();
  await new Promise((r) => setTimeout(r, 200));
  const orphans = pids.filter((p) => isAlive(p));
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  expect(orphans, "procesos huerfanos").toEqual([]);
});

const run = async (argv: string[], cwd: string, extra: Partial<Parameters<typeof runCli>[1]> = {}) => {
  let stdout = "";
  let stderr = "";
  const code = await runCli(argv, { stdout: (s) => void (stdout += s), stderr: (s) => void (stderr += s), cwd, openBrowser: () => undefined, localServer: false, ...extra });
  return { code, stdout, stderr };
};

describe("URL anunciada por Next.js y Angular", () => {
  it("Next.js: 'Local: http://localhost:3000' (con y sin colores)", () => {
    const banner = "   \u001b[1m\u001b[38;2;173;127;168m▲ Next.js 16.0.0\u001b[39m\u001b[22m (Turbopack)\n   - Local:         http://localhost:3000\n   - Network:       http://192.168.1.5:3000\n";
    expect(detectAnnouncedUrl(banner)).toBe("http://localhost:3000/");
    expect(detectAnnouncedUrl("- Local: http://localhost:3217\n")).toBe("http://localhost:3217/");
  });

  it("Angular moderno: '➜  Local:   http://localhost:4200/'", () => {
    expect(detectAnnouncedUrl("\u001b[32m➜\u001b[39m  \u001b[1mLocal\u001b[22m:   \u001b[36mhttp://localhost:\u001b[1m4200\u001b[22m/\u001b[39m\n")).toBe("http://localhost:4200/");
    expect(detectAnnouncedUrl("  ➜  Local:   http://localhost:4200/\n  ➜  press h + enter to show help")).toBe("http://localhost:4200/");
  });

  it("Angular clásico: 'listening on localhost:4200' (con y sin URL)", () => {
    expect(detectAnnouncedUrl("** Angular Live Development Server is listening on localhost:4200, open your browser on http://localhost:4200/ **")).toBe("http://localhost:4200/");
    expect(detectAnnouncedUrl("Angular Live Development Server is listening on localhost:4201")).toBe("http://localhost:4201/");
    expect(detectAnnouncedUrl("Angular Live Development Server is listening on 0.0.0.0:4202")).toBe("http://0.0.0.0:4202/".replace("0.0.0.0", "localhost"));
  });

  it("sin anuncio -> null", () => {
    expect(detectAnnouncedUrl("Compiling app...\n")).toBeNull();
  });
});

describe("arranque con espera larga y progreso", () => {
  it("avisa del inicio, de la URL anunciada y espera a que responda tras un arranque lento", async () => {
    const root = mkdir();
    const port = await freePort();
    // Anuncia la URL de inmediato pero empieza a responder 2 s despues (compilacion inicial).
    fs.writeFileSync(
      path.join(root, "slow.mjs"),
      `import http from "node:http";
console.log("   - Local:         http://localhost:${port}");
setTimeout(() => http.createServer((_, res) => res.end("ok")).listen(${port}), 2000);`,
    );
    const msgs: string[] = [];
    const { status } = await ensureRunning(
      { root, plan: { command: "node", args: ["slow.mjs"], cwd: root }, url: null },
      { startTimeoutMs: 20_000, onProgress: (m) => msgs.push(m) },
    );
    pids.push(status.pid ?? 0);
    expect(status).toMatchObject({ state: "running", managed: true, ready: true });
    expect(status.url).toBe(`http://localhost:${port}/`);
    expect(msgs[0]).toMatch(/Iniciando el dev server/);
    expect(msgs[0]).toMatch(/hasta 20 s/);
    expect(msgs.some((m) => m.includes(`anuncia http://localhost:${port}/`))).toBe(true);
  });

  it("el timeout es configurable y el mensaje indica --start-timeout", async () => {
    const root = mkdir();
    fs.writeFileSync(path.join(root, "silent.mjs"), "setInterval(() => {}, 1000);");
    const err = await ensureRunning({ root, plan: { command: "node", args: ["silent.mjs"], cwd: root }, url: null }, { startTimeoutMs: 700 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StartError);
    expect((err as StartError).message).toMatch(/--start-timeout/);
    expect(readState(root)).toBeNull();
  });

  it("--start-timeout llega al arranque (CLI) y el progreso sale por stdout (no en --json)", async () => {
    const root = mkdir();
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "x" }));
    fs.writeFileSync(path.join(root, "silent.mjs"), "setInterval(() => {}, 1000);");
    const t0 = Date.now();
    const r = await run(["start", "--command", "node silent.mjs", "--start-timeout", "1"], root);
    expect(r.code).toBe(EXIT.PROCESS);
    expect(Date.now() - t0).toBeLessThan(15_000);
    expect(r.stdout).toMatch(/Iniciando el dev server \(node silent\.mjs\)/);
    expect(r.stderr).toMatch(/--start-timeout/);
    const j = await run(["start", "--command", "node silent.mjs", "--start-timeout", "1", "--json"], root);
    expect(j.stdout.trim().split("\n")).toHaveLength(1); // solo el JSON de error
    expect(JSON.parse(j.stdout)).toMatchObject({ ok: false });
    expect((await run(["--start-timeout", "0"], root)).code).toBe(EXIT.USAGE);
  });
});

describe("--url y --command ganan sobre la deteccion (CLI)", () => {
  it("--url con un servidor vivo: se conecta (externo) aunque el proyecto sea Next y no se inicia nada", async () => {
    const root = mkdir();
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "n", scripts: { dev: "next dev" }, dependencies: { next: "^16.0.0" } }));
    const ext = await listen();
    const url = `http://localhost:${ext.port}/`;
    const r = await run(["start", "--url", url, "--json"], root);
    expect(r.code).toBe(EXIT.OK);
    expect(JSON.parse(r.stdout)).toMatchObject({ action: "connected", state: "external", managed: false, pid: null, url });
    expect(readState(root)).toBeNull();
    expect((await fetch(url)).status).toBe(200);
  });

  it("--url sin package.json (carpeta vacía) también funciona", async () => {
    const root = mkdir();
    const ext = await listen();
    const url = `http://localhost:${ext.port}/`;
    const r = await run(["start", "--url", url, "--json"], root);
    expect(r.code).toBe(EXIT.OK);
    expect(JSON.parse(r.stdout)).toMatchObject({ state: "external", url });
  });

  it("--url sin nadie escuchando: error accionable (no intenta arrancar el proyecto)", async () => {
    const root = mkdir();
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "n", scripts: { dev: "next dev" }, dependencies: { next: "^16.0.0" } }));
    const url = `http://localhost:${await freePort()}/`;
    const r = await run(["start", "--url", url], root);
    expect(r.code).toBe(EXIT.PROCESS);
    expect(r.stderr).toMatch(/--url no inicia procesos/);
    expect(r.stderr).toMatch(/--command/);
    expect(readState(root)).toBeNull();
  });

  it("--command en una carpeta sin package.json ni framework conocido", async () => {
    const root = mkdir();
    fs.writeFileSync(
      path.join(root, "srv.mjs"),
      `import http from "node:http";
const s = http.createServer((_, res) => res.end("ok"));
s.listen(0, () => console.log("Local: http://localhost:" + s.address().port + "/"));`,
    );
    const r = await run(["start", "--command", "node srv.mjs", "--json"], root);
    expect(r.code).toBe(EXIT.OK);
    const j = JSON.parse(r.stdout);
    pids.push(j.pid);
    expect(j).toMatchObject({ action: "started", managed: true, state: "running" });
    expect(j.url).toMatch(/^http:\/\/localhost:\d+\/$/);
    expect(readLogs(root, 3)?.join("\n")).toContain("Local:");
  });

  it("framework no compatible: el error dice que hacer", async () => {
    const root = mkdir();
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "x", dependencies: { express: "^5.0.0" } }));
    const r = await run(["start"], root);
    expect(r.code).toBe(EXIT.PROJECT);
    expect(r.stderr).toMatch(/--url http:\/\/localhost:PUERTO/);
    expect(r.stderr).toMatch(/--command "\.\.\."/);
    const j = await run(["start", "--json"], root);
    expect(JSON.parse(j.stdout).error.message).toMatch(/--url http:\/\/localhost:PUERTO/);
  });

  it("el CLI pasa PORT del entorno al detector de Next", async () => {
    const root = mkdir();
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "n", scripts: { dev: "node -e 0" }, dependencies: { next: "^16.0.0" } }));
    const before = process.env.PORT;
    const port = await freePort();
    process.env.PORT = String(port);
    try {
      const ext = http.createServer((_, res) => res.end("ext"));
      servers.push(ext);
      await new Promise<void>((r) => ext.listen(port, r));
      // Next sin anuncio: la URL esperada (PORT) ya responde -> se trata como servidor externo.
      const r = await run(["start", "--json"], root);
      expect(JSON.parse(r.stdout)).toMatchObject({ state: "external", url: `http://localhost:${port}` });
    } finally {
      if (before === undefined) delete process.env.PORT;
      else process.env.PORT = before;
    }
  });
});
