import http from "node:http";
import net from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startProxy, type ProxyHandle } from "../src";

const LOCAL_TOKEN = "local-secret-token-xyz";

let target: http.Server;
let local: http.Server;
let handle: ProxyHandle;
let upstreamRes: http.ServerResponse | null;
let upstreamClosed: boolean;
let upstreamStatus: number;
let upstreamAuth: string | undefined;

const listenOn = (s: http.Server): Promise<number> =>
  new Promise((r) => s.listen(0, "127.0.0.1", () => r((s.address() as net.AddressInfo).port)));
const until = async (fn: () => boolean, ms = 2000): Promise<void> => {
  const t = Date.now();
  while (!fn()) {
    if (Date.now() - t > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 10));
  }
};

const frame = (id: number, ev: object): string => `id: ${id}\nevent: ${(ev as { type: string }).type}\ndata: ${JSON.stringify(ev)}\n\n`;

/** Abre el stream y devuelve lo recibido hasta ahora + cierre. */
function open(path: string, headers: http.OutgoingHttpHeaders = {}): Promise<{ status: number; res: http.IncomingMessage; req: http.ClientRequest; text: () => string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: handle.port, path, headers, agent: false }, (res) => {
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (c: string) => (buf += c));
      resolve({ status: res.statusCode ?? 0, res, req, text: () => buf });
    });
    req.on("error", reject);
    req.end();
  });
}

beforeEach(async () => {
  upstreamRes = null;
  upstreamClosed = false;
  upstreamStatus = 200;
  upstreamAuth = undefined;
  target = http.createServer((_q, r) => r.end("ok"));
  local = http.createServer((q, r) => {
    upstreamAuth = q.headers.authorization;
    if (q.url !== "/api/events") return r.writeHead(404).end();
    if (upstreamStatus !== 200) return r.writeHead(upstreamStatus, { "content-type": "application/json" }).end("{}");
    r.writeHead(200, { "content-type": "text/event-stream" });
    r.write(": connected\n\n");
    upstreamRes = r;
    r.on("close", () => (upstreamClosed = true));
  });
  const [tp, lp] = [await listenOn(target), await listenOn(local)];
  handle = await startProxy({
    target: { host: "127.0.0.1", port: tp },
    listenPort: 0,
    projectId: "proj_1",
    localServer: { baseUrl: `http://127.0.0.1:${lp}`, token: LOCAL_TOKEN },
    getOverlayScript: async () => "",
  });
});

afterEach(async () => {
  await handle.close();
  local.closeAllConnections();
  target.closeAllConnections();
  await Promise.all([new Promise((r) => local.close(r)), new Promise((r) => target.close(r))]);
});

describe("/__pf/events", () => {
  it("rechaza sin token o con token inválido (401) y no abre upstream", async () => {
    const a = await open("/__pf/events");
    expect(a.status).toBe(401);
    const b = await open("/__pf/events?pf_token=nope");
    expect(b.status).toBe(401);
    const c = await open("/__pf/events", { "x-pf-token": "nope" });
    expect(c.status).toBe(401);
    expect(upstreamAuth).toBeUndefined();
  });

  it("acepta el token por query solo en esta ruta", async () => {
    const e = await open(`/__pf/comments?pf_token=${handle.token}`);
    expect(e.status).toBe(401);
    const s = await open(`/__pf/events?pf_token=${handle.token}`);
    expect(s.status).toBe(200);
    expect(s.res.headers["content-type"]).toContain("text/event-stream");
    expect(s.res.headers["x-accel-buffering"]).toBe("no");
    expect(s.res.headers["cache-control"]).toContain("no-cache");
    expect(upstreamAuth).toBe(`Bearer ${LOCAL_TOKEN}`);
    s.req.destroy();
  });

  it("filtra por proyecto y manda solo datos mínimos", async () => {
    const s = await open("/__pf/events", { "x-pf-token": handle.token });
    await until(() => upstreamRes !== null);
    const comment = { id: "c1", status: "resolved", updatedAt: "2026-10-17T10:00:00.000Z", comment: "secreto", screenshots: ["BIG"] };
    upstreamRes!.write(frame(1, { type: "comment.resolved", at: "t", projectId: "otro", comment }));
    upstreamRes!.write(frame(2, { type: "process.log", at: "t", projectId: "proj_1", line: "x" }));
    // trama partida en dos chunks
    const f = frame(3, { type: "comment.resolved", at: "t", projectId: "proj_1", comment });
    upstreamRes!.write(f.slice(0, 20));
    await new Promise((r) => setTimeout(r, 20));
    upstreamRes!.write(f.slice(20));
    upstreamRes!.write(frame(4, { type: "comment.deleted", at: "t", projectId: "proj_1", commentId: "c9", collection: "default" }));
    await until(() => s.text().includes("c9"));
    const t = s.text();
    expect(t).not.toContain("otro");
    expect(t).not.toContain("process.log");
    expect(t).not.toContain("secreto");
    expect(t).not.toContain("BIG");
    expect(t).toContain("id: 3\nevent: comment.resolved");
    expect(t).toContain('"commentId":"c1","status":"resolved"');
    expect(t).toContain("event: comment.deleted");
    s.req.destroy();
  });

  it("cierra el upstream cuando el cliente se desconecta", async () => {
    const s = await open("/__pf/events", { "x-pf-token": handle.token });
    await until(() => upstreamRes !== null);
    s.req.destroy();
    await until(() => upstreamClosed);
  });

  it("cierra el stream del cliente si el upstream termina", async () => {
    const s = await open("/__pf/events", { "x-pf-token": handle.token });
    await until(() => upstreamRes !== null);
    const ended = new Promise<void>((r) => s.res.on("end", r));
    upstreamRes!.end();
    await ended;
  });

  it("propaga el límite de clientes del servidor (429)", async () => {
    upstreamStatus = 429;
    const s = await open("/__pf/events", { "x-pf-token": handle.token });
    expect(s.status).toBe(429);
  });

  it("close() del proxy cierra los streams abiertos", async () => {
    const s = await open("/__pf/events", { "x-pf-token": handle.token });
    await until(() => upstreamRes !== null);
    const ended = new Promise<void>((r) => s.res.on("close", r));
    await handle.close();
    await ended;
    await until(() => upstreamClosed);
  });
});
