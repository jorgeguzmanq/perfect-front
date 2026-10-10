import http from "node:http";
import net from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { injectSnippet, startProxy, type ProxyHandle, type ProxyOptions } from "../src";

const LOCAL_TOKEN = "local-secret-token-xyz";
const SNIP = '<script src="/__pf/overlay.js"></script>';

interface Res {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  text: string;
}

function request(
  port: number,
  path: string,
  opts: { method?: string; headers?: http.OutgoingHttpHeaders; body?: string | Buffer } = {},
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method: opts.method ?? "GET", headers: opts.headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks);
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body, text: body.toString("utf8") });
      });
    });
    req.on("error", reject);
    req.end(opts.body);
  });
}

function listenOn(server: http.Server): Promise<number> {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port)));
}

const validComment = {
  version: 1,
  scope: "element",
  comment: "Mover el botón",
  location: {
    url: "http://localhost:3000/pricing",
    route: "/pricing",
    title: "Pricing",
    selector: "#cta",
    selectorCandidates: ["#cta", ".btn"],
    text: "Comprar",
    html: null,
    componentHint: null,
  },
  viewport: { width: 1200, height: 800, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
  elementRect: { x: 1, y: 2, width: 3, height: 4 },
  environment: {},
};

let targetServer: http.Server;
let targetPort: number;
let localServer: http.Server;
let localPort: number;
let localLog: { method: string; url: string; auth: string | undefined; body: string }[];
let handle: ProxyHandle;
let logs: string[];
let overlay: () => Promise<string>;
const wsSockets = new Set<import("node:stream").Duplex>();

async function start(extra: Partial<ProxyOptions> = {}): Promise<void> {
  handle = await startProxy({
    target: { host: "127.0.0.1", port: targetPort },
    listenPort: 0,
    projectId: "proj_1",
    localServer: { baseUrl: `http://127.0.0.1:${localPort}`, token: LOCAL_TOKEN },
    getOverlayScript: () => overlay(),
    log: (l) => logs.push(l),
    ...extra,
  });
}

beforeEach(async () => {
  logs = [];
  localLog = [];
  overlay = async () => "window.__pf=1;";
  targetServer = http.createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/head") {
      res.writeHead(200, { "content-type": "text/html" }).end("<html><head><title>x</title></head><body>hi</body></html>");
    } else if (url === "/nohead") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end("<body>hi</body>");
    } else if (url === "/bare") {
      res.writeHead(200, { "content-type": "text/html" }).end("<p>hola</p>");
    } else if (url === "/err") {
      res.writeHead(500, { "content-type": "text/html" }).end("<html><head></head><body>boom</body></html>");
    } else if (url === "/json") {
      res.writeHead(200, { "content-type": "application/json" }).end('{"a":"</head>"}');
    } else if (url === "/bin") {
      res.writeHead(200, { "content-type": "application/octet-stream" }).end(Buffer.from([0, 255, 1, 254]));
    } else if (url === "/sse") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write("data: uno\n\n");
      setTimeout(() => res.write("data: dos\n\n"), 30);
    } else if (url === "/redir") {
      res.writeHead(302, { location: `http://127.0.0.1:${targetPort}/dest?x=1` }).end();
    } else if (url === "/redir-ext") {
      res.writeHead(302, { location: "https://example.com/a" }).end();
    } else if (url === "/gz") {
      res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" }).end(Buffer.from([1, 2, 3]));
    } else if (url === "/csp") {
      res.writeHead(200, { "content-type": "text/html", "content-security-policy": "script-src 'none'" }).end("<head></head>");
    } else if (url === "/echo") {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () =>
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ method: req.method, host: req.headers.host, ae: req.headers["accept-encoding"] ?? null, body: Buffer.concat(chunks).toString() })),
      );
    } else if (url === "/__pf/health") {
      res.writeHead(200).end("LEAKED-TO-TARGET");
    } else {
      res.writeHead(404, { "content-type": "text/plain" }).end("nf");
    }
  });
  targetServer.on("upgrade", (req, socket) => {
    wsSockets.add(socket);
    socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nX-Seen-Host: " + req.headers.host + "\r\n\r\n");
    socket.on("data", (d) => socket.write(d));
    socket.on("error", () => undefined);
  });
  targetPort = await listenOn(targetServer);

  localServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      localLog.push({ method: req.method ?? "", url: req.url ?? "", auth: req.headers.authorization, body: Buffer.concat(chunks).toString() });
      if (req.url === "/api/projects/proj_1/comments" && req.method === "GET") {
        res.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({
            ok: true,
            comments: [
              {
                id: "pf_ABCDE",
                status: "open",
                scope: "element",
                comment: "hola",
                collection: "inbox",
                attachments: ["attachments/secret.png"],
                location: { url: "http://x/", route: "/r", selector: "#a", selectorCandidates: ["#a"], html: "<b>big</b>", text: "t" },
                elementRect: { x: 1, y: 2, width: 3, height: 4 },
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          }),
        );
      } else if (req.url === "/api/projects/proj_1/comments" && req.method === "POST") {
        res.writeHead(201, { "content-type": "application/json" }).end(
          JSON.stringify({ ok: true, comment: { id: "pf_ABCDE", collection: "inbox", location: { route: "/pricing" } } }),
        );
      } else {
        res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ ok: false, error: { code: "not_found", message: "no" } }));
      }
    });
  });
  localPort = await listenOn(localServer);
  await start();
});

afterEach(async () => {
  await handle.close();
  for (const s of wsSockets) s.destroy();
  wsSockets.clear();
  targetServer.closeAllConnections();
  localServer.closeAllConnections();
  await Promise.all([new Promise((r) => targetServer.close(r)), new Promise((r) => localServer.close(r))]);
});

const auth = () => ({ "x-pf-token": handle.token, "content-type": "application/json" });

describe("injectSnippet", () => {
  it("antes de </head>, luego </body>, luego al inicio", () => {
    expect(injectSnippet("<head></HEAD><body></body>", SNIP)).toBe(`<head>  ${SNIP}\n</HEAD><body></body>`);
    expect(injectSnippet("<body>x</body>", SNIP)).toBe(`<body>x  ${SNIP}\n</body>`);
    expect(injectSnippet("<p>x</p>", SNIP)).toBe(`${SNIP}<p>x</p>`);
  });
  it("es idempotente", () => {
    const once = injectSnippet("<head></head>", SNIP);
    expect(injectSnippet(once, SNIP)).toBe(once);
  });
  it("no interpreta patrones $ del HTML", () => {
    expect(injectSnippet("<head>$&</head>", SNIP)).toContain("$&");
  });
});

describe("proxy HTTP", () => {
  it("inyecta en HTML con </head> con token, cache-control y content-length correcto", async () => {
    const r = await request(handle.port, "/head", { headers: { host: `127.0.0.1:${handle.port}` } });
    expect(r.status).toBe(200);
    expect(r.text).toContain(`<script src="/__pf/overlay.js" data-pf-token="${handle.token}" data-pf-base="/__pf" defer></script>\n</head>`);
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(Number(r.headers["content-length"])).toBe(r.body.length);
    expect(r.text.match(/__pf\/overlay\.js/g)).toHaveLength(1);
  });
  it("sin </head> usa </body>; sin ninguno, al inicio", async () => {
    expect((await request(handle.port, "/nohead")).text).toMatch(/<script[^>]*defer><\/script>\n<\/body>/);
    expect((await request(handle.port, "/bare")).text.startsWith("<script")).toBe(true);
  });
  it("inyecta también en páginas de error", async () => {
    const r = await request(handle.port, "/err");
    expect(r.status).toBe(500);
    expect(r.text).toContain("/__pf/overlay.js");
  });
  it("pasa JSON y binario sin tocar", async () => {
    const j = await request(handle.port, "/json");
    expect(j.text).toBe('{"a":"</head>"}');
    const b = await request(handle.port, "/bin");
    expect([...b.body]).toEqual([0, 255, 1, 254]);
  });
  it("SSE llega en streaming sin bufferizar", async () => {
    await new Promise<void>((resolve, reject) => {
      const req = http.get({ host: "127.0.0.1", port: handle.port, path: "/sse", agent: false }, (res) => {
        let got = "";
        res.on("data", (c: Buffer) => {
          got += c.toString();
          if (got.includes("uno")) {
            expect(got).not.toContain("dos"); // el primer evento llega antes que el segundo
            res.destroy();
            resolve();
          }
        });
      });
      req.on("error", (e) => (e as NodeJS.ErrnoException).code === "ECONNRESET" ? resolve() : reject(e));
    });
  });
  it("HEAD no devuelve cuerpo", async () => {
    const r = await request(handle.port, "/head", { method: "HEAD" });
    expect(r.status).toBe(200);
    expect(r.body.length).toBe(0);
  });
  it("reescribe Host, quita accept-encoding y reenvía cuerpos de POST", async () => {
    const r = await request(handle.port, "/echo", { method: "POST", headers: { "accept-encoding": "gzip" }, body: "hola" });
    expect(JSON.parse(r.text)).toEqual({ method: "POST", host: `127.0.0.1:${targetPort}`, ae: null, body: "hola" });
  });
  it("reescribe Location al destino hacia el proxy, y deja los externos", async () => {
    const r = await request(handle.port, "/redir", { headers: { host: `localhost:${handle.port}` } });
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe(`http://localhost:${handle.port}/dest?x=1`);
    expect((await request(handle.port, "/redir-ext")).headers.location).toBe("https://example.com/a");
  });
  it("HTML comprimido no se toca y avisa", async () => {
    const r = await request(handle.port, "/gz");
    expect([...r.body]).toEqual([1, 2, 3]);
    expect(logs.some((l) => l.includes("comprimido"))).toBe(true);
  });
  it("CSP restrictiva: no se modifica y se avisa", async () => {
    const r = await request(handle.port, "/csp");
    expect(r.headers["content-security-policy"]).toBe("script-src 'none'");
    expect(logs.some((l) => l.includes("Content-Security-Policy"))).toBe(true);
  });
  it("destino caído: 502 de texto", async () => {
    await handle.close();
    await new Promise((r) => targetServer.close(r));
    const closedPort = targetPort;
    await start({ target: { host: "127.0.0.1", port: closedPort } });
    const r = await request(handle.port, "/");
    expect(r.status).toBe(502);
    expect(r.headers["content-type"]).toContain("text/plain");
    expect(r.text).toContain(String(closedPort));
    targetServer = http.createServer();
    targetPort = await listenOn(targetServer);
  });
  it("/__pf/ nunca llega al destino", async () => {
    const r = await request(handle.port, "/__pf/health");
    expect(r.text).not.toContain("LEAKED");
    expect(JSON.parse(r.text)).toEqual({ ok: true });
  });
});

describe("WebSocket", () => {
  it("reenvía el upgrade y los bytes (eco)", async () => {
    const got = await new Promise<string>((resolve, reject) => {
      const s = net.connect(handle.port, "127.0.0.1", () => {
        s.write(
          `GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${handle.port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: abc\r\n\r\n`,
        );
      });
      let buf = "";
      let sent = false;
      s.on("data", (d) => {
        buf += d.toString("latin1");
        if (!sent && buf.includes("\r\n\r\n")) {
          sent = true;
          buf = "";
          s.write(Buffer.from([0, 1, 2, 255]));
        } else if (sent && buf.length >= 4) {
          s.destroy();
          resolve(Buffer.from(buf, "latin1").toString("hex"));
        }
      });
      s.on("error", reject);
    });
    expect(got).toBe("000102ff");
  });
  it("upgrade con Host ajeno se rechaza", async () => {
    const out = await new Promise<string>((resolve) => {
      const s = net.connect(handle.port, "127.0.0.1", () => s.write("GET /ws HTTP/1.1\r\nHost: evil.com\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n"));
      let b = "";
      s.on("data", (d) => (b += d.toString()));
      s.on("close", () => resolve(b));
    });
    expect(out.startsWith("HTTP/1.1 403")).toBe(true);
  });
});

describe("/__pf/overlay.js", () => {
  it("sirve el script del proveedor en cada petición", async () => {
    const a = await request(handle.port, "/__pf/overlay.js");
    expect(a.headers["content-type"]).toContain("text/javascript");
    expect(a.headers["cache-control"]).toBe("no-store");
    expect(a.text).toBe("window.__pf=1;");
    overlay = async () => "v2";
    expect((await request(handle.port, "/__pf/overlay.js")).text).toBe("v2");
  });
  it("si el proveedor lanza, 500 de texto con el mensaje", async () => {
    overlay = async () => {
      throw new Error("falta dist/overlay.js");
    };
    const r = await request(handle.port, "/__pf/overlay.js");
    expect(r.status).toBe(500);
    expect(r.headers["content-type"]).toContain("text/plain");
    expect(r.text).toContain("falta dist/overlay.js");
  });
});

describe("seguridad", () => {
  it("Host no local o con otro puerto: 403", async () => {
    expect((await request(handle.port, "/head", { headers: { host: "evil.com" } })).status).toBe(403);
    expect((await request(handle.port, "/__pf/health", { headers: { host: `localhost:${handle.port + 1}` } })).status).toBe(403);
    expect((await request(handle.port, "/head", { headers: { host: `evil.com:${handle.port}` } })).status).toBe(403);
  });
  it("escribe/lee sin token o con token inválido: 401", async () => {
    const noTok = await request(handle.port, "/__pf/comment", { method: "POST", body: JSON.stringify(validComment) });
    expect(noTok.status).toBe(401);
    const bad = await request(handle.port, "/__pf/comment", { method: "POST", headers: { "x-pf-token": "nope" }, body: JSON.stringify(validComment) });
    expect(bad.status).toBe(401);
    expect((await request(handle.port, "/__pf/comments")).status).toBe(401);
    expect(localLog).toHaveLength(0);
  });
  it("Origin ajeno: 403; Origin propio: ok", async () => {
    const evil = await request(handle.port, "/__pf/comment", { method: "POST", headers: { ...auth(), origin: "http://evil.com" }, body: JSON.stringify(validComment) });
    expect(evil.status).toBe(403);
    expect(JSON.parse(evil.text).error.code).toBe("forbidden_origin");
    const own = await request(handle.port, "/__pf/comment", {
      method: "POST",
      headers: { ...auth(), origin: `http://127.0.0.1:${handle.port}`, host: `127.0.0.1:${handle.port}` },
      body: JSON.stringify(validComment),
    });
    expect(own.status).toBe(201);
    expect((await request(handle.port, "/__pf/comments", { headers: { ...auth(), origin: "http://evil.com" } })).status).toBe(403);
  });
  it("lista blanca: rutas no permitidas -> 404 y nada llega al servidor local", async () => {
    for (const p of ["/__pf/", "/__pf/api/projects", "/__pf/comments/pf_ABCDE", "/__pf/projects", "/__pf/comment/x", "/__pf/../api/projects", "/__pf/__proto__"]) {
      const r = await request(handle.port, p, { headers: auth() });
      expect(r.status, p).toBe(404);
    }
    const wrongMethod = await request(handle.port, "/__pf/comment", { headers: auth() });
    expect(wrongMethod.status).toBe(405);
    expect(localLog).toHaveLength(0);
  });
  it("POST válido: reenvía con el token del servidor local y devuelve CommentCreatedData", async () => {
    const r = await request(handle.port, "/__pf/comment", { method: "POST", headers: auth(), body: JSON.stringify(validComment) });
    expect(r.status).toBe(201);
    expect(JSON.parse(r.text)).toEqual({ ok: true, data: { id: "pf_ABCDE", collection: "inbox", route: "/pricing" } });
    expect(localLog).toHaveLength(1);
    expect(localLog[0]).toMatchObject({ method: "POST", url: "/api/projects/proj_1/comments", auth: `Bearer ${LOCAL_TOKEN}` });
    expect(JSON.parse(localLog[0]!.body).comment).toBe("Mover el botón");
    expect(r.text).not.toContain(LOCAL_TOKEN);
  });
  it("cuerpo inválido: 400 con detalles y sin tocar el servidor local", async () => {
    const bad = await request(handle.port, "/__pf/comment", { method: "POST", headers: auth(), body: JSON.stringify({ ...validComment, comment: "" }) });
    expect(bad.status).toBe(400);
    expect(JSON.parse(bad.text).error.code).toBe("invalid_request");
    const notJson = await request(handle.port, "/__pf/comment", { method: "POST", headers: auth(), body: "{{{" });
    expect(notJson.status).toBe(400);
    const extra = await request(handle.port, "/__pf/comment", { method: "POST", headers: auth(), body: JSON.stringify({ ...validComment, projectId: "otro" }) });
    expect(extra.status).toBe(400);
    expect(localLog).toHaveLength(0);
  });
  it("cuerpo mayor al límite: 413", async () => {
    const big = JSON.stringify({ x: "a".repeat(15 * 1024 * 1024) });
    const r = await request(handle.port, "/__pf/comment", { method: "POST", headers: auth(), body: big });
    expect(r.status).toBe(413);
    expect(JSON.parse(r.text).error.code).toBe("payload_too_large");
    expect(localLog).toHaveLength(0);
  });
  it("GET /__pf/comments devuelve solo los campos mínimos", async () => {
    const r = await request(handle.port, "/__pf/comments", { headers: auth() });
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text)).toEqual({
      ok: true,
      data: {
        comments: [
          {
            id: "pf_ABCDE",
            status: "open",
            scope: "element",
            comment: "hola",
            location: { route: "/r", selector: "#a", selectorCandidates: ["#a"] },
            elementRect: { x: 1, y: 2, width: 3, height: 4 },
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      },
    });
    expect(localLog[0]).toMatchObject({ method: "GET", url: "/api/projects/proj_1/comments", auth: `Bearer ${LOCAL_TOKEN}` });
    expect(r.text).not.toContain(LOCAL_TOKEN);
  });
  it("servidor local caído: error serializable sin secretos", async () => {
    await new Promise((r) => localServer.close(r));
    const r = await request(handle.port, "/__pf/comments", { headers: auth() });
    expect(r.status).toBe(500);
    expect(JSON.parse(r.text).ok).toBe(false);
    expect(r.text).not.toContain(LOCAL_TOKEN);
    expect(r.text).not.toMatch(/\bat \S+ \(/); // sin stack
    localServer = http.createServer();
    localPort = await listenOn(localServer);
  });
  it("el token del servidor local no aparece en ningún log", async () => {
    await request(handle.port, "/__pf/comment", { method: "POST", headers: auth(), body: JSON.stringify(validComment) });
    overlay = async () => {
      throw new Error(`fallo con ${LOCAL_TOKEN}`);
    };
    const r = await request(handle.port, "/__pf/overlay.js");
    expect(r.text).not.toContain(LOCAL_TOKEN);
    expect(logs.join("\n")).not.toContain(LOCAL_TOKEN);
    expect(logs.join("\n")).not.toContain(handle.token);
  });
});

describe("close()", () => {
  it("cierra conexiones activas (SSE, WS) y libera el puerto", async () => {
    const closed: string[] = [];
    const sse = http.get({ host: "127.0.0.1", port: handle.port, path: "/sse", agent: false }, (res) => {
      res.on("close", () => closed.push("sse"));
      res.on("error", () => undefined);
      res.resume();
    });
    sse.on("error", () => undefined);
    const ws = net.connect(handle.port, "127.0.0.1", () =>
      ws.write(`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${handle.port}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`),
    );
    ws.on("close", () => closed.push("ws"));
    ws.resume();
    ws.on("error", () => undefined);
    await new Promise((r) => setTimeout(r, 150));
    const port = handle.port;
    await handle.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(closed.sort()).toEqual(["sse", "ws"]);
    await expect(
      new Promise((resolve, reject) => {
        const s = net.connect(port, "127.0.0.1", () => resolve("abierto"));
        s.on("error", reject);
      }),
    ).rejects.toMatchObject({ code: "ECONNREFUSED" });
    await handle.close(); // idempotente
    await start();
  });
});
