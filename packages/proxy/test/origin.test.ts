import http from "node:http";
import net from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startProxy, type ProxyHandle } from "../src";

/**
 * Destino que imita a Next.js / Vite / Angular en desarrollo: rechaza cualquier petición o WebSocket cuyo
 * `Origin` no sea el suyo ("Cross origin request detected" / allowedDevOrigins / allowedHosts).
 */
let target: http.Server;
let targetPort: number;
let proxy: ProxyHandle;
const sockets = new Set<net.Socket>();
const seen: { origin?: string | undefined; referer?: string | undefined; host?: string | undefined; path: string }[] = [];

const ownOrigin = (): string => `http://127.0.0.1:${targetPort}`;

beforeEach(async () => {
  seen.length = 0;
  target = http.createServer((req, res) => {
    seen.push({ origin: req.headers.origin, referer: req.headers.referer, host: req.headers.host, path: req.url ?? "" });
    if (req.headers.origin !== undefined && req.headers.origin !== ownOrigin()) {
      res.writeHead(403, { "content-type": "text/plain" }).end("Cross origin request detected");
      return;
    }
    if (req.url === "/stream") {
      // HTML por streaming con chunked, como el renderer de React/Next.
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "transfer-encoding": "chunked" });
      res.write("<!DOCTYPE html><html><head><title>t</title>");
      setTimeout(() => res.write("<meta charset='utf-8'></head><body><main>parte uno "), 20);
      setTimeout(() => res.write("ñandú y 🎉</main><script>self.__next_f=[]</script>"), 40);
      setTimeout(() => res.end("</body></html>"), 60);
      return;
    }
    res.writeHead(200, { "content-type": "text/plain" }).end(`ok ${req.method}`);
  });
  target.on("upgrade", (req, socket) => {
    sockets.add(socket);
    seen.push({ origin: req.headers.origin, referer: req.headers.referer, host: req.headers.host, path: req.url ?? "" });
    socket.on("error", () => undefined);
    if (req.headers.origin !== undefined && req.headers.origin !== ownOrigin()) {
      socket.end("Unauthorized"); // como Next: ni siquiera una respuesta HTTP válida (ERR_INVALID_HTTP_RESPONSE en Chrome)
      return;
    }
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
    socket.on("data", (d) => socket.write(d));
  });
  await new Promise<void>((r) => target.listen(0, "127.0.0.1", r));
  targetPort = (target.address() as net.AddressInfo).port;
  proxy = await startProxy({
    target: { host: "127.0.0.1", port: targetPort },
    listenPort: 0,
    projectId: "proj_1",
    localServer: { baseUrl: "http://127.0.0.1:1", token: "tok" },
    getOverlayScript: async () => "window.__pf=1;",
  });
});

afterEach(async () => {
  await proxy.close();
  for (const s of sockets) s.destroy();
  sockets.clear();
  target.closeAllConnections();
  await new Promise((r) => target.close(r));
});

function get(path: string, headers: http.OutgoingHttpHeaders = {}, method = "GET"): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: proxy.port, path, method, headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
}

function upgrade(headers: Record<string, string>, path = "/_next/webpack-hmr"): Promise<string> {
  return new Promise((resolve) => {
    const s = net.connect(proxy.port, "127.0.0.1", () => {
      const extra = Object.entries(headers)
        .map(([k, v]) => `${k}: ${v}\r\n`)
        .join("");
      s.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${proxy.port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: abc\r\nSec-WebSocket-Version: 13\r\n${extra}\r\n`);
    });
    let buf = "";
    s.on("data", (d) => {
      buf += d.toString("latin1");
      if (buf.includes("\r\n\r\n") || buf.startsWith("Unauthorized")) s.destroy();
    });
    s.on("close", () => resolve(buf));
    s.on("error", () => resolve(buf));
  });
}

const proxyOrigin = (): string => `http://127.0.0.1:${proxy.port}`;

describe("Origin / Referer hacia el destino (HTTP)", () => {
  it("sin la reescritura el destino rechazaría: con ella, Origin del proxy -> origen del destino", async () => {
    const r = await get("/data", { origin: proxyOrigin() }, "POST");
    expect(r.status).toBe(200);
    expect(seen.at(-1)?.origin).toBe(ownOrigin());
  });

  it("Referer del proxy -> mismo camino y query sobre el destino", async () => {
    await get("/x", { referer: `${proxyOrigin()}/ruta/pagina?x=1#h` });
    expect(seen.at(-1)?.referer).toBe(`${ownOrigin()}/ruta/pagina?x=1#h`);
    await get("/x", { referer: `${proxyOrigin()}/` });
    expect(seen.at(-1)?.referer).toBe(`${ownOrigin()}/`);
  });

  it("no toca nada más: Host se reescribe como siempre; sin Origin/Referer no se añaden", async () => {
    await get("/x");
    const s = seen.at(-1);
    expect(s?.origin).toBeUndefined();
    expect(s?.referer).toBeUndefined();
    expect(s?.host).toBe(`127.0.0.1:${targetPort}`);
  });

  it("un Origin de terceros se deja intacto (y el destino lo rechaza)", async () => {
    const r = await get("/x", { origin: "http://evil.example" });
    expect(seen.at(-1)?.origin).toBe("http://evil.example");
    expect(r.status).toBe(403);
    const n = await get("/x", { origin: "null" });
    expect(seen.at(-1)?.origin).toBe("null");
    expect(n.status).toBe(403);
  });

  it("no confunde prefijos parecidos en Referer", async () => {
    const tricky = `${proxyOrigin()}.evil.example/a`;
    await get("/x", { referer: tricky });
    expect(seen.at(-1)?.referer).toBe(tricky);
    const portPrefix = `http://127.0.0.1:${proxy.port}0/a`;
    await get("/x", { referer: portPrefix });
    expect(seen.at(-1)?.referer).toBe(portPrefix);
  });
});

describe("Origin / Referer en el upgrade de WebSocket (HMR)", () => {
  it("Origin del proxy -> el destino acepta el handshake (101)", async () => {
    const out = await upgrade({ Origin: proxyOrigin(), Referer: `${proxyOrigin()}/` });
    expect(out.startsWith("HTTP/1.1 101")).toBe(true);
    expect(seen.at(-1)?.origin).toBe(ownOrigin());
    expect(seen.at(-1)?.referer).toBe(`${ownOrigin()}/`);
    expect(seen.at(-1)?.host).toBe(`127.0.0.1:${targetPort}`);
  });

  it("Origin de terceros no se reescribe: el destino lo rechaza y el proxy no lo disfraza", async () => {
    const out = await upgrade({ Origin: "http://evil.example" });
    expect(out.startsWith("Unauthorized")).toBe(true);
    expect(seen.at(-1)?.origin).toBe("http://evil.example");
  });

  it("conserva el nombre original de las cabeceras y no añade Origin si no venía", async () => {
    const out = await upgrade({ "Sec-WebSocket-Protocol": "vite-hmr" }, "/ng-cli-ws");
    expect(out.startsWith("HTTP/1.1 101")).toBe(true);
    expect(seen.at(-1)?.origin).toBeUndefined();
  });
});

describe("HTML por streaming (chunked) con inyección", () => {
  it("bufferiza, inyecta una vez antes de </head>, recalcula content-length y quita chunked", async () => {
    const r = await get("/stream", { origin: proxyOrigin() });
    expect(r.status).toBe(200);
    expect(r.headers["transfer-encoding"]).toBeUndefined();
    expect(Number(r.headers["content-length"])).toBe(r.body.length);
    const html = r.body.toString("utf8");
    expect(html.match(/__pf\/overlay\.js/g)).toHaveLength(1);
    expect(html.indexOf("__pf/overlay.js")).toBeLessThan(html.indexOf("</head>"));
    // el resto llega intacto, incluidos multibyte (ñ, emoji) partidos entre chunks
    expect(html).toContain("<main>parte uno ñandú y 🎉</main><script>self.__next_f=[]</script></body></html>");
    expect(r.headers["cache-control"]).toBe("no-store");
  });
});
