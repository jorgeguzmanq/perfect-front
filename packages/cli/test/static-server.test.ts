import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mimeFor, startStaticServer, type RunningStaticServer } from "../src/static/server";

let dirs: string[] = [];
let running: RunningStaticServer[] = [];
let blockers: net.Server[] = [];

function site(files: Record<string, string | Buffer>): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pf-static-srv-")));
  dirs.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const f = path.join(root, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
  }
  return root;
}

async function serve(root: string, extra: { fallback?: string } = {}): Promise<RunningStaticServer> {
  const s = await startStaticServer({ root, preferredPort: 0, ...extra });
  running.push(s);
  return s;
}

interface Res {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** Solicitud cruda: `path` se envia tal cual (sin normalizar, a diferencia de fetch). */
function raw(port: number, p: string, opts: { method?: string; host?: string } = {}): Promise<Res> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path: p, method: opts.method ?? "GET", headers: { host: opts.host ?? `127.0.0.1:${port}` } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

beforeEach(() => {
  dirs = [];
  running = [];
  blockers = [];
});
afterEach(async () => {
  for (const s of running) await s.close();
  for (const b of blockers) await new Promise((r) => b.close(r));
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

describe("servidor estatico: lo que sirve", () => {
  it("sirve archivos con MIME correcto y escucha solo en 127.0.0.1", async () => {
    const root = site({ "index.html": "<h1>hola</h1>", "app.js": "1", "s.css": "a{}", "d.json": "{}", "i.svg": "<svg/>", "f.woff2": "x", "raro.zzz": "x" });
    const s = await serve(root);
    expect(s.host).toBe("127.0.0.1");
    expect((s.server.address() as net.AddressInfo).address).toBe("127.0.0.1");
    const html = await raw(s.port, "/index.html");
    expect(html.status).toBe(200);
    expect(html.body).toBe("<h1>hola</h1>");
    expect(html.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(html.headers["x-content-type-options"]).toBe("nosniff");
    expect((await raw(s.port, "/")).body).toBe("<h1>hola</h1>");
    expect((await raw(s.port, "/app.js")).headers["content-type"]).toBe("text/javascript; charset=utf-8");
    expect((await raw(s.port, "/s.css")).headers["content-type"]).toBe("text/css; charset=utf-8");
    expect((await raw(s.port, "/d.json")).headers["content-type"]).toBe("application/json; charset=utf-8");
    expect((await raw(s.port, "/i.svg")).headers["content-type"]).toBe("image/svg+xml");
    expect((await raw(s.port, "/f.woff2")).headers["content-type"]).toBe("font/woff2");
    expect((await raw(s.port, "/raro.zzz")).headers["content-type"]).toBe("application/octet-stream");
    expect(mimeFor("A.PNG")).toBe("image/png");
  });

  it("HEAD devuelve cabeceras sin cuerpo y sirve rutas con espacios/acentos codificados", async () => {
    const root = site({ "mi pagina/ñandú.html": "ok" });
    const s = await serve(root);
    const r = await raw(s.port, "/mi%20pagina/%C3%B1and%C3%BA.html", { method: "HEAD" });
    expect(r.status).toBe(200);
    expect(r.headers["content-length"]).toBe("2");
    expect(r.body).toBe("");
    expect((await raw(s.port, "/mi%20pagina/%C3%B1and%C3%BA.html")).body).toBe("ok");
  });

  it("directorio sin barra redirige; con barra sirve su index.html; sin index no lista", async () => {
    const root = site({ "docs/index.html": "docs", "vacio/x.txt": "x", "otro/a.html": "a" });
    const s = await serve(root);
    const redir = await raw(s.port, "/docs?x=1");
    expect(redir.status).toBe(301);
    expect(redir.headers.location).toBe("/docs/?x=1");
    expect((await raw(s.port, "/docs/")).body).toBe("docs");
    const noIndex = await raw(s.port, "/vacio/");
    expect(noIndex.status).toBe(404);
    expect(noIndex.body).not.toContain("x.txt");
    expect((await raw(s.port, "/otro/")).status).toBe(404);
    expect((await raw(s.port, "/")).status).toBe(404); // raiz sin index.html: nada de listado
  });
});

describe("servidor estatico: seguridad", () => {
  it("rechaza path traversal (literal, codificado y doble barra)", async () => {
    const parent = site({ "secreto.txt": "TOP SECRET" });
    const root = path.join(parent, "web");
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, "index.html"), "ok");
    const s = await serve(root);
    for (const p of [
      "/../secreto.txt",
      "/..%2fsecreto.txt",
      "/..%2Fsecreto.txt",
      "/%2e%2e/secreto.txt",
      "/%2e%2e%2fsecreto.txt",
      "/a/..%2f..%2fsecreto.txt",
      "/..%5csecreto.txt",
      "/..\\secreto.txt",
      "//..//secreto.txt",
      "/%00",
      "/index.html%00.txt",
      "/%",
    ]) {
      const r = await raw(s.port, p);
      expect(r.status, p).toBeGreaterThanOrEqual(400);
      expect(r.status, p).toBeLessThan(500);
      expect(r.body, p).not.toContain("TOP SECRET");
    }
    expect((await raw(s.port, "/..%2fsecreto.txt")).status).toBe(403);
  });

  it("no sirve dotfiles, .perfect-front, .git ni node_modules (ni por mayusculas en Windows)", async () => {
    const root = site({
      "index.html": "ok",
      ".env": "SECRET=1",
      ".perfect-front/project.json": "{}",
      ".perfect-front/run/process.json": "{}",
      ".git/config": "x",
      "node_modules/p/index.js": "x",
      "sub/.hidden.html": "x",
    });
    const s = await serve(root);
    for (const p of ["/.env", "/.perfect-front/project.json", "/.perfect-front/run/process.json", "/.git/config", "/node_modules/p/index.js", "/sub/.hidden.html", "/%2eenv", "/.perfect-front/"]) {
      const r = await raw(s.port, p);
      expect(r.status, p).toBe(404);
      expect(r.body, p).not.toContain("SECRET");
    }
    if (process.platform === "win32") expect((await raw(s.port, "/NODE_MODULES/p/index.js")).status).toBe(404);
  });

  it("solo GET y HEAD: POST, PUT, DELETE y OPTIONS dan 405", async () => {
    const s = await serve(site({ "index.html": "ok" }));
    for (const method of ["POST", "PUT", "DELETE", "OPTIONS", "PATCH"]) {
      const r = await raw(s.port, "/index.html", { method });
      expect(r.status, method).toBe(405);
      expect(r.headers.allow).toBe("GET, HEAD");
    }
  });

  it("rechaza Host no loopback (DNS rebinding) y acepta localhost", async () => {
    const s = await serve(site({ "index.html": "ok" }));
    expect((await raw(s.port, "/", { host: "evil.example.com" })).status).toBe(403);
    expect((await raw(s.port, "/", { host: `evil.example.com:${s.port}` })).status).toBe(403);
    expect((await raw(s.port, "/", { host: `localhost:${s.port}` })).status).toBe(200);
  });

  it("symlink que escapa de la raiz: 403; symlink interno: permitido (si el SO deja crearlo)", async () => {
    const parent = site({ "fuera/secreto.txt": "TOP SECRET" });
    const root = path.join(parent, "web");
    fs.mkdirSync(path.join(root, "real"), { recursive: true });
    fs.writeFileSync(path.join(root, "index.html"), "ok");
    fs.writeFileSync(path.join(root, "real", "pagina.html"), "interna");
    try {
      // "junction" no exige privilegios en Windows; en POSIX es un symlink normal.
      fs.symlinkSync(path.join(parent, "fuera"), path.join(root, "escape"), "junction");
      fs.symlinkSync(path.join(parent, "fuera", "secreto.txt"), path.join(root, "enlace.txt"), "file");
      fs.symlinkSync(path.join(root, "real"), path.join(root, "alias"), "junction");
    } catch {
      return; // sin permisos para crear enlaces: no se puede probar aqui
    }
    const s = await serve(root);
    for (const p of ["/escape/secreto.txt", "/enlace.txt"]) {
      const r = await raw(s.port, p);
      expect(r.status, p).toBe(403);
      expect(r.body, p).not.toContain("TOP SECRET");
    }
    expect((await raw(s.port, "/alias/pagina.html")).body).toBe("interna");
  });

  it("symlink hacia .perfect-front dentro de la raiz tampoco se sirve", async () => {
    const root = site({ ".perfect-front/project.json": "SECRET", "index.html": "ok" });
    try {
      fs.symlinkSync(path.join(root, ".perfect-front"), path.join(root, "pf"), "junction");
    } catch {
      return;
    }
    const s = await serve(root);
    expect((await raw(s.port, "/pf/project.json")).status).toBe(404);
  });
});

describe("servidor estatico: fallback y puerto", () => {
  it("fallback desactivado por defecto: ruta inexistente = 404", async () => {
    const s = await serve(site({ "index.html": "shell" }));
    expect((await raw(s.port, "/ruta/virtual")).status).toBe(404);
  });

  it("fallback configurable: solo rutas sin extension; nunca archivos ni dotfiles", async () => {
    const s = await serve(site({ "index.html": "shell", "app/app.html": "app" }), { fallback: "app/app.html" });
    expect((await raw(s.port, "/ruta/virtual")).body).toBe("app");
    expect((await raw(s.port, "/falta.js")).status).toBe(404);
    expect((await raw(s.port, "/x", { method: "HEAD" })).status).toBe(404); // solo GET
  });

  it("usa el puerto preferido si esta libre y el siguiente libre si esta ocupado", async () => {
    const probe = await serve(site({ "index.html": "x" }));
    const free = probe.port;
    await probe.close();
    running = running.filter((r) => r !== probe);
    const a = await startStaticServer({ root: site({ "index.html": "a" }), preferredPort: free });
    running.push(a);
    expect(a.port).toBe(free);
    const b = await startStaticServer({ root: site({ "index.html": "b" }), preferredPort: free });
    running.push(b);
    expect(b.port).toBeGreaterThan(free);
    expect((await raw(b.port, "/")).body).toBe("b");
    // El puerto ocupado por un tercero tambien se salta.
    const blocker = net.createServer();
    blockers.push(blocker);
    const bp = await new Promise<number>((r) => blocker.listen(0, "127.0.0.1", () => r((blocker.address() as net.AddressInfo).port)));
    const c = await startStaticServer({ root: site({ "index.html": "c" }), preferredPort: bp });
    running.push(c);
    expect(c.port).not.toBe(bp);
  });
});
