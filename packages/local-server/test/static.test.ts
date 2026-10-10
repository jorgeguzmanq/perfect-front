import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OFFICIAL_EXTENSION_ID } from "@perfect-front/shared";
import { canInjectToken, injectToken, safeSegments } from "../src/static";
import { BASE, PORT, commentInput, makeHarness, tmpDir, type Harness } from "./helpers";

const INDEX = '<!doctype html><html><head><meta name="pf-token" content=""><title>PF</title></head><body><div id="root"></div></body></html>';

async function dist(): Promise<string> {
  const dir = await tmpDir("pf-dist-");
  await fs.mkdir(path.join(dir, "assets"), { recursive: true });
  await fs.writeFile(path.join(dir, "index.html"), INDEX);
  await fs.writeFile(path.join(dir, "assets", "app.js"), "console.log(1)");
  await fs.writeFile(path.join(dir, ".secret"), "nope");
  return dir;
}

async function harness(): Promise<Harness> {
  return makeHarness({ dashboardDir: await dist() });
}

const get = async (h: Harness, p: string, headers: Record<string, string> = {}) => {
  const res = await h.req(p, { auth: "none", headers });
  return { res, text: await res.text() };
};

describe("dashboard estático", () => {
  it("sirve index.html con el token de sesión en la meta (nunca el del CLI)", async () => {
    const h = await harness();
    const { res, text } = await get(h, "/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(text).toContain(`<meta name="pf-token" content="${h.token}">`);
    expect(text).not.toContain(h.cliToken);
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("el token entregado autentica la API como rol session (y no registra proyectos)", async () => {
    const h = await harness();
    const { text } = await get(h, "/");
    const token = /<meta name="pf-token" content="([^"]+)"/.exec(text)![1]!;
    const headers = { authorization: `Bearer ${token}`, origin: BASE };
    expect((await h.json("/api/projects", { auth: "none", headers })).status).toBe(200);
    const reg = await h.json("/api/projects/register", { auth: "none", headers, body: { root: h.projectRoot } });
    expect(reg.status).toBe(403);
  });

  it("fallback SPA para rutas del cliente, solo GET/HEAD; recursos con extension no se enmascaran", async () => {
    const h = await harness();
    const spa = await get(h, "/projects/p_1/comments/pf_ABC");
    expect(spa.res.status).toBe(200);
    expect(spa.text).toContain('<div id="root">');
    const js = await get(h, "/assets/app.js");
    expect(js.res.headers.get("content-type")).toContain("javascript");
    expect(js.text).toBe("console.log(1)");
    expect((await get(h, "/assets/missing.js")).res.status).toBe(404);
    const head = await h.req("/", { method: "HEAD", auth: "none" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect((await h.req("/", { method: "POST", auth: "none", raw: "x" })).status).toBe(404);
    expect((await h.req("/anything", { method: "DELETE", auth: "none" })).status).toBe(404);
  });

  it("rechaza traversal, dotfiles y separadores de Windows", async () => {
    const h = await harness();
    // El parser de URL ya normaliza %2e%2e a .. antes de llegar al servidor: queda dentro de dist (SPA), sin fuga.
    for (const p of ["/%2e%2e/%2e%2e/package.json", "/assets/%2e%2e/%2e%2e/x", "/assets/.%2e/index.html"]) {
      const { res, text } = await get(h, p);
      expect(res.status).toBeLessThan(500);
      expect(text).not.toContain("nope");
      expect(text).not.toContain("console.log");
    }
    for (const p of ["/..%5Cx", "/%00", "/.secret", "/%E0%A4%A"]) {
      const { res, text } = await get(h, p);
      expect([p, res.status]).toSatisfy(([, s]) => s === 400 || s === 404);
      expect(text).not.toContain("nope");
      expect(text).not.toContain("PF</title>");
    }
    expect(safeSegments("/a/%2e%2e/b")).toBeNull();
    expect(safeSegments("/a/b.js")).toEqual(["a", "b.js"]);
  });

  it("Host no loopback: sin token ni contenido (403)", async () => {
    const h = await harness();
    const res = await h.core.app.request("http://evil.example.com:45800/", { headers: { host: "evil.example.com:45800" } });
    expect(res.status).toBe(403);
    expect(await res.text()).not.toContain(h.token);
    const wrongPort = await h.core.app.request(`http://127.0.0.1:${PORT + 1}/`);
    expect(wrongPort.status).toBe(403);
  });

  it("no inyecta token con Origin ajeno o Sec-Fetch-Site cross-site", async () => {
    const h = await harness();
    for (const headers of [
      { origin: "http://localhost:3000" },
      { origin: "http://evil.example.com" },
      { origin: `chrome-extension://${OFFICIAL_EXTENSION_ID}` },
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" },
    ]) {
      const { text } = await get(h, "/", headers);
      expect(text).not.toContain(h.token);
    }
    expect((await get(h, "/", { origin: BASE, "sec-fetch-site": "same-origin" })).text).toContain(h.token);
    expect((await get(h, "/", { "sec-fetch-site": "none" })).text).toContain(h.token);
  });

  it("sin build devuelve una pagina de texto clara (503) y la API sigue viva", async () => {
    const h = await makeHarness({ dashboardDir: path.join(await tmpDir("pf-nodist-"), "dist") });
    const { res, text } = await get(h, "/");
    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(text).toContain("pnpm --filter @perfect-front/dashboard build");
    expect((await h.json("/api/health", { auth: "none" })).body.ok).toBe(true);
  });

  it("la API queda intacta: 401 sin token, 404 JSON en /api desconocido", async () => {
    const h = await harness();
    expect((await h.json("/api/projects", { auth: "none" })).status).toBe(401);
    const nf = await h.json("/api/nope");
    expect(nf.status).toBe(404);
    expect(nf.body).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect((await h.json("/api/health", { auth: "none" })).body).toMatchObject({ ok: true });
  });

  it("canInjectToken e injectToken (unidad)", () => {
    const req = (url: string, hdr: Record<string, string> = {}) => ({ url, header: (n: string) => hdr[n.toLowerCase()] });
    expect(canInjectToken(req("http://127.0.0.1:45800/"), 45800)).toBe(true);
    expect(canInjectToken(req("http://127.0.0.1:45800/", { host: "evil.com" }), 45800)).toBe(false);
    expect(canInjectToken(req("http://localhost:45800/", { origin: "http://localhost:45800" }), 45800)).toBe(true);
    expect(injectToken("<head></head>", "abc")).toBe('<head><meta name="pf-token" content="abc"></head>');
    expect(injectToken("<p>x</p>", "abc")).toContain("abc");
  });
});

describe("adjuntos y control de conflictos", () => {
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);

  async function withShot(h: Harness) {
    const id = await h.register();
    const r = await h.json(`/api/projects/${id}/comments`, {
      body: commentInput({ screenshot: { mimeType: "image/png", dataBase64: PNG.toString("base64") } }),
    });
    expect(r.status).toBe(201);
    return { id, comment: r.body.comment as { id: string; attachments: string[]; updatedAt: string } };
  }

  it("sirve la captura con MIME validado, requiere token y rechaza lo no declarado", async () => {
    const h = await harness();
    const { id, comment } = await withShot(h);
    const file = comment.attachments[0]!.split("/")[1]!;
    const url = `/api/projects/${id}/comments/${comment.id}/attachments/${file}`;
    const ok = await h.req(url);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await ok.arrayBuffer()).equals(PNG)).toBe(true);
    expect((await h.json(url, { auth: "none" })).status).toBe(401);
    expect((await h.json(url, { auth: "none", headers: { origin: `chrome-extension://${OFFICIAL_EXTENSION_ID}` } })).status).toBe(403);
    for (const bad of ["..%2F..%2Fproject.json", "other.png", "x.svg", "%2e%2e"]) {
      const r = await h.json(`/api/projects/${id}/comments/${comment.id}/attachments/${bad}`);
      expect([400, 404]).toContain(r.status);
    }
  });

  it("rechaza un adjunto cuyo contenido no coincide con su extension", async () => {
    const h = await harness();
    const { id, comment } = await withShot(h);
    const file = comment.attachments[0]!.split("/")[1]!;
    await fs.writeFile(path.join(h.projectRoot, ".perfect-front", "attachments", file), "<html>no soy png</html>");
    const r = await h.json(`/api/projects/${id}/comments/${comment.id}/attachments/${file}`);
    expect(r.status).toBe(422);
  });

  it("PATCH con X-PF-Expected-Updated-At obsoleto devuelve 409 sin escribir", async () => {
    const h = await harness();
    const { id, comment } = await withShot(h);
    const url = `/api/projects/${id}/comments/${comment.id}`;
    const stale = await h.json(url, { method: "PATCH", body: { comment: "nuevo" }, headers: { "x-pf-expected-updated-at": "2000-01-01T00:00:00.000Z" } });
    expect(stale.status).toBe(409);
    expect((await h.json(url)).body.comment.comment).not.toBe("nuevo");
    const ok = await h.json(url, { method: "PATCH", body: { comment: "nuevo" }, headers: { "x-pf-expected-updated-at": comment.updatedAt } });
    expect(ok.status).toBe(200);
  });

  it("el listado informa de JSON corrupto sin fallar", async () => {
    const h = await harness();
    const { id } = await withShot(h);
    await fs.writeFile(path.join(h.projectRoot, ".perfect-front", "comments", "inbox", "pf_BROKEN12345.json"), "{ no json");
    const plain = await h.json(`/api/projects/${id}/comments`);
    expect(plain.body.corrupt).toBeUndefined();
    const r = await h.json(`/api/projects/${id}/comments`, { headers: { "x-pf-include-corrupt": "1" } });
    expect(r.status).toBe(200);
    expect(r.body.comments).toHaveLength(1);
    expect(r.body.corrupt).toHaveLength(1);
  });
});
