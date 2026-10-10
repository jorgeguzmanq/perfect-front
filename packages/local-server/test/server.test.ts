import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { describe, expect, it } from "vitest";
import { PerfectFrontEventSchema } from "@perfect-front/shared";
import { discoveryPath, readDiscovery } from "../src/discovery";
import { startServer, type RunningServer } from "../src/server";
import { CliProcessController } from "../src/process/cli-controller";
import { DEV_ID, DEV_ORIGIN, EXT_ORIGIN, commentInput, onCleanup, tmpDir } from "./helpers";

async function start(stateDir: string, extra: Parameters<typeof startServer>[0] = {}): Promise<RunningServer> {
  const s = await startServer({ stateDir, port: 0, ...extra });
  onCleanup(() => s.close());
  return s;
}

const auth = (t: string) => ({ authorization: `Bearer ${t}` });

/** GET con Host arbitrario (fetch no permite sobrescribirlo). */
function rawGet(port: number, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: "/api/health", headers: { host } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });
}

describe("servidor real", () => {
  it("escucha en loopback, publica descubrimiento y completa un ciclo con SSE", async () => {
    const stateDir = await tmpDir("pf-state-");
    const projectRoot = await tmpDir("pf-proj-");
    const s = await start(stateDir);

    expect(s.host).toBe("127.0.0.1");
    const d = await readDiscovery(stateDir);
    expect(d).toMatchObject({ port: s.port, token: s.token, cliToken: s.cliToken, host: "127.0.0.1" });
    if (process.platform !== "win32") expect((await fs.stat(discoveryPath(stateDir))).mode & 0o077).toBe(0);

    expect((await fetch(`${s.url}/api/health`)).status).toBe(200);
    expect((await fetch(`${s.url}/api/projects`)).status).toBe(401);
    expect(await rawGet(s.port, "evil.example.com")).toBe(403);

    const reg = await fetch(`${s.url}/api/projects/register`, {
      method: "POST",
      headers: { ...auth(s.cliToken), "content-type": "application/json" },
      body: JSON.stringify({ root: projectRoot }),
    });
    expect(reg.status).toBe(201);
    const projectId = ((await reg.json()) as { project: { id: string } }).project.id;

    const ac = new AbortController();
    const sse = await fetch(`${s.url}/api/events`, { headers: auth(s.token), signal: ac.signal });
    expect(sse.status).toBe(200);
    const reader = sse.body!.getReader();
    const dec = new TextDecoder();
    let text = "";
    const pump = async (until: string): Promise<void> => {
      const deadline = Date.now() + 3000;
      while (!text.includes(until)) {
        if (Date.now() > deadline) throw new Error(`timeout SSE: ${text}`);
        const { value, done } = await reader.read();
        if (done) return;
        text += dec.decode(value);
      }
    };
    await pump(": connected");

    const created = await fetch(`${s.url}/api/projects/${projectId}/comments`, {
      method: "POST",
      headers: { ...auth(s.token), "content-type": "application/json" },
      body: JSON.stringify(commentInput()),
    });
    expect(created.status).toBe(201);
    await pump("event: comment.created");
    const data = /data: (.*)/.exec(text)![1]!;
    expect(PerfectFrontEventSchema.parse(JSON.parse(data)).type).toBe("comment.created");
    ac.abort();

    // Cierre limpio: sin listener y sin archivo de descubrimiento.
    await s.close();
    await expect(fs.stat(discoveryPath(stateDir))).rejects.toThrow();
    await expect(fetch(`${s.url}/api/health`)).rejects.toThrow();
  });

  it("cerrar con un stream SSE abierto no se cuelga", async () => {
    const s = await start(await tmpDir("pf-state-"));
    const res = await fetch(`${s.url}/api/events`, { headers: auth(s.token) });
    await res.body!.getReader().read();
    await s.close();
  });

  it("reinicio: nuevo proceso reconstruye proyectos y comentarios", async () => {
    const stateDir = await tmpDir("pf-state-");
    const projectRoot = await tmpDir("pf-proj-");
    const a = await start(stateDir);
    const reg = await fetch(`${a.url}/api/projects/register`, {
      method: "POST",
      headers: { ...auth(a.cliToken), "content-type": "application/json" },
      body: JSON.stringify({ root: projectRoot }),
    });
    const projectId = ((await reg.json()) as { project: { id: string } }).project.id;
    await fetch(`${a.url}/api/projects/${projectId}/comments`, {
      method: "POST",
      headers: { ...auth(a.token), "content-type": "application/json" },
      body: JSON.stringify(commentInput()),
    });
    await a.close();

    const b = await start(stateDir);
    expect(b.token).not.toBe(a.token);
    const list = (await (await fetch(`${b.url}/api/projects/${projectId}/comments`, { headers: auth(b.token) })).json()) as {
      comments: unknown[];
    };
    expect(list.comments).toHaveLength(1);
  });

  it("una segunda instancia con el mismo estado se rechaza", async () => {
    const stateDir = await tmpDir("pf-state-");
    await start(stateDir);
    await expect(startServer({ stateDir, port: 0 })).rejects.toMatchObject({ code: "conflict" });
  });

  it("usa un puerto alternativo si el preferido está ocupado", async () => {
    const blocker = net.createServer();
    await new Promise<void>((r) => blocker.listen(0, "127.0.0.1", r));
    onCleanup(() => new Promise<void>((r) => blocker.close(() => r())));
    const busy = (blocker.address() as net.AddressInfo).port;
    const s = await start(await tmpDir("pf-state-"), { port: busy });
    expect(s.port).not.toBe(busy);
    expect(s.port).toBeGreaterThan(busy);
    expect((await fetch(`${s.url}/api/health`)).status).toBe(200);
  });
});

describe("CliProcessController", () => {
  it("falla con process_error genérico si no puede determinar el plan", async () => {
    const root = await tmpDir("pf-proj-");
    const c = new CliProcessController({
      load: async () => ({ ensureRunning: async () => ({ status: {} }) }) as never,
    });
    await expect(c.start({ root, url: null, command: null })).rejects.toMatchObject({ code: "process_error" });
  });

  it("delega estado, detención y logs en el módulo del CLI", async () => {
    const root = await tmpDir("pf-proj-");
    const c = new CliProcessController({
      load: async () =>
        ({
          getStatus: async () => ({ state: "external", managed: false, url: "http://localhost:1", pid: null }),
          stopManaged: async () => ({ outcome: "none" }),
          readLogs: () => ["a", "b"],
        }) as never,
    });
    expect(await c.status({ root, url: null, command: null })).toMatchObject({ state: "external" });
    expect(await c.stop({ root, url: null, command: null })).toEqual({ outcome: "none" });
    expect(await c.logs({ root, url: null, command: null }, 2)).toEqual(["a", "b"]);
  });

  it("PF_EXTENSION_IDS añade IDs de desarrollo por HTTP real; inválido impide arrancar", async () => {
    const prev = process.env.PF_EXTENSION_IDS;
    onCleanup(() => {
      if (prev === undefined) delete process.env.PF_EXTENSION_IDS;
      else process.env.PF_EXTENSION_IDS = prev;
    });
    process.env.PF_EXTENSION_IDS = DEV_ID;
    const s = await start(await tmpDir("pf-state-"));
    for (const origin of [DEV_ORIGIN, EXT_ORIGIN]) {
      const r = await fetch(`${s.url}/api/projects`, { headers: { origin } });
      expect(r.status).toBe(200);
      expect(r.headers.get("access-control-allow-origin")).toBe(origin);
    }
    process.env.PF_EXTENSION_IDS = "no-valido";
    await expect(startServer({ stateDir: await tmpDir("pf-state-"), port: 0 })).rejects.toThrow(/inválido/);
  });
});
