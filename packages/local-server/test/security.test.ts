import { describe, expect, it } from "vitest";
import { ErrorResponseSchema } from "@perfect-front/shared";
import { classifyOrigin, isAllowedHost, originOf, parseExtensionIds, parseBearer, redact, safeEqual, RateLimiter } from "../src/security";
import { BASE, DEV_ID, DEV_ORIGIN, EXT_ID, EXT_ORIGIN, FOREIGN_ORIGIN, commentInput, makeHarness } from "./helpers";

async function code(res: Response): Promise<string> {
  return ErrorResponseSchema.parse(await res.json()).error.code;
}

describe("autenticación", () => {
  it("token ausente o inválido produce 401 en toda la API salvo health", async () => {
    const h = await makeHarness();
    for (const p of ["/api/projects", "/api/projects/p_x/comments", "/api/events"]) {
      const none = await h.req(p, { auth: "none" });
      expect(none.status).toBe(401);
      expect(await code(none)).toBe("unauthorized");
      expect((await h.req(p, { auth: "token-incorrecto" })).status).toBe(401);
    }
    const wrongScheme = await h.req("/api/projects", { auth: "none", headers: { authorization: `Basic ${h.token}` } });
    expect(wrongScheme.status).toBe(401);
    expect((await h.req("/api/projects", { auth: "session" })).status).toBe(200);
    expect((await h.req("/api/projects", { auth: "cli" })).status).toBe(200);
  });

  it("muchos fallos de autenticación bloquean temporalmente (429)", async () => {
    const h = await makeHarness({ authFailMax: 3 });
    for (let i = 0; i < 4; i++) await h.req("/api/projects", { auth: "malo" });
    const blocked = await h.req("/api/projects", { auth: "session" });
    expect(blocked.status).toBe(429);
  });

  it("limita la frecuencia global", async () => {
    const h = await makeHarness({ rateMax: 5 });
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) statuses.push((await h.req("/api/health", { auth: "none" })).status);
    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(5).every((s) => s === 429)).toBe(true);
  });
});

describe("Host y Origin", () => {
  it("Host no local o con puerto ajeno produce 403", async () => {
    const h = await makeHarness();
    for (const url of ["http://evil.example.com:45800/api/health", "http://127.0.0.1:9999/api/health", "http://192.168.1.5:45800/api/health"]) {
      const r = await h.req(url, { auth: "none" });
      expect(r.status).toBe(403);
      expect(await code(r)).toBe("forbidden_origin");
    }
    const spoof = await h.req("/api/health", { auth: "none", headers: { host: "evil.example.com" } });
    expect(spoof.status).toBe(403);
    expect((await h.req("http://localhost:45800/api/health", { auth: "none" })).status).toBe(200);
    expect((await h.req("http://[::1]:45800/api/health", { auth: "none" })).status).toBe(200);
  });

  it("origen oficial sin token: health, projects, comentarios, colecciones y events", async () => {
    const h = await makeHarness();
    const id = await h.register();
    const o = { origin: EXT_ORIGIN };
    const health = await h.req("/api/health", { auth: "none", headers: o });
    expect(health.status).toBe(200);
    expect(health.headers.get("access-control-allow-origin")).toBe(EXT_ORIGIN);
    const list = await h.json("/api/projects", { auth: "none", headers: o });
    expect(list.status).toBe(200);
    expect(list.body.projects[0]).toMatchObject({ id });
    const base = `/api/projects/${id}`;
    const created = await h.json(`${base}/comments`, { auth: "none", headers: o, body: commentInput() });
    expect(created.status).toBe(201);
    const cid = created.body.comment.id as string;
    expect((await h.json(`${base}/comments`, { auth: "none", headers: o })).status).toBe(200);
    expect((await h.json(`${base}/comments/${cid}`, { auth: "none", headers: o })).status).toBe(200);
    expect((await h.json(`${base}/comments/${cid}`, { auth: "none", headers: o, method: "PATCH", body: { comment: "Editado" } })).status).toBe(200);
    expect((await h.json(`${base}/comments/${cid}/resolve`, { auth: "none", headers: o, body: { summary: "Hecho" } })).status).toBe(200);
    expect((await h.json(`${base}/comments/${cid}/reopen`, { auth: "none", headers: o, method: "POST" })).status).toBe(200);
    expect((await h.json(`${base}/collections`, { auth: "none", headers: o, body: { name: "mobile" } })).status).toBe(201);
    expect((await h.json(`${base}/collections`, { auth: "none", headers: o })).status).toBe(200);
    const ev = await h.req("/api/events", { auth: "none", headers: o });
    expect(ev.status).toBe(200);
    await ev.body?.cancel();
  });

  it("origen oficial no administra: registrar/borrar, procesos y logs dan 403; sin Origin ni token da 401", async () => {
    const h = await makeHarness();
    const id = await h.register();
    const o = { origin: EXT_ORIGIN };
    // 403 forbidden_origin: el Origin es válido pero el rol no tiene permiso, aunque envíe un token de CLI.
    for (const auth of ["none", "cli", "session"]) {
      const reg = await h.req("/api/projects/register", { auth, headers: o, body: { root: h.projectRoot } });
      expect(reg.status).toBe(403);
      expect(await code(reg)).toBe("forbidden_origin");
      expect((await h.req(`/api/projects/${id}`, { method: "DELETE", auth, headers: o })).status).toBe(403);
      expect((await h.req(`/api/projects/${id}/start`, { method: "POST", auth, headers: o })).status).toBe(403);
      expect((await h.req(`/api/projects/${id}/stop`, { method: "POST", auth, headers: o })).status).toBe(403);
      expect((await h.req(`/api/projects/${id}/logs`, { auth, headers: o })).status).toBe(403);
    }
    expect(h.controller.calls.filter((c) => c.startsWith("start") || c.startsWith("stop"))).toEqual([]);
    // Sin Origin y sin token: 401 también en las rutas administrativas.
    for (const [m, p] of [["POST", "/api/projects/register"], ["DELETE", `/api/projects/${id}`], ["POST", `/api/projects/${id}/start`]] as const) {
      const r = await h.req(p, { method: m, auth: "none" });
      expect(r.status).toBe(401);
      expect(await code(r)).toBe("unauthorized");
    }
  });

  it("extensión ajena: 403 en todo, incluido health, sin cabeceras CORS", async () => {
    const h = await makeHarness();
    for (const p of ["/api/health", "/api/projects", "/api/events", "/api/projects/p_x/comments"]) {
      for (const auth of ["none", "session", "cli"]) {
        const r = await h.req(p, { auth, headers: { origin: FOREIGN_ORIGIN } });
        expect(r.status, p).toBe(403);
        expect(await code(r)).toBe("forbidden_origin");
        expect(r.headers.get("access-control-allow-origin")).toBeNull();
      }
    }
    const bad = await h.req("/api/health", { auth: "none", headers: { origin: "chrome-extension://zzzz" } });
    expect(bad.status).toBe(403);
  });

  it("extensionIds añade IDs de desarrollo válidos y rechaza inválidos", async () => {
    const h = await makeHarness({ extensionIds: [DEV_ID] });
    const ok = await h.req("/api/projects", { auth: "none", headers: { origin: DEV_ORIGIN } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("access-control-allow-origin")).toBe(DEV_ORIGIN);
    expect((await h.req("/api/projects", { auth: "none", headers: { origin: EXT_ORIGIN } })).status).toBe(200);
    expect((await h.req("/api/projects", { auth: "none", headers: { origin: FOREIGN_ORIGIN } })).status).toBe(403);
    expect((await h.req("/api/projects/register", { auth: "none", headers: { origin: DEV_ORIGIN }, body: { root: h.projectRoot } })).status).toBe(403);
    for (const bad of ["zzzz", "ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP", `${DEV_ID}a`, `chrome-extension://${DEV_ID}`]) {
      await expect(makeHarness({ extensionIds: [bad] })).rejects.toThrow(/inválido/);
    }
  });

  it("parseExtensionIds (PF_EXTENSION_IDS): comas o espacios; inválido lanza", () => {
    expect(parseExtensionIds(`${DEV_ID}, ${EXT_ID}\n`)).toEqual([DEV_ID, EXT_ID]);
    expect(parseExtensionIds(undefined)).toEqual([]);
    expect(parseExtensionIds("")).toEqual([]);
    expect(() => parseExtensionIds(`${DEV_ID},nope`)).toThrow(/inválido/);
  });

  it("preflight solo para orígenes permitidos", async () => {
    const h = await makeHarness();
    const ok = await h.req("/api/projects", { method: "OPTIONS", auth: "none", headers: { origin: EXT_ORIGIN, "access-control-request-method": "GET" } });
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-headers")).toContain("Authorization");
    expect(ok.headers.get("access-control-allow-origin")).toBe(EXT_ORIGIN);
    for (const origin of ["https://evil.example.com", FOREIGN_ORIGIN]) {
      const bad = await h.req("/api/projects", { method: "OPTIONS", auth: "none", headers: { origin } });
      expect(bad.status).toBe(403);
      expect(bad.headers.get("access-control-allow-origin")).toBeNull();
    }
  });
});

describe("utilidades de seguridad", () => {
  it("safeEqual, parseBearer y originOf", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(parseBearer("Bearer xyz")).toBe("xyz");
    expect(parseBearer("bearer  xyz")).toBe("xyz");
    expect(parseBearer("Bearer")).toBeNull();
    expect(parseBearer(undefined)).toBeNull();
    expect(originOf(EXT_ID)).toBe(EXT_ORIGIN);
  });

  it("isAllowedHost y classifyOrigin", () => {
    expect(isAllowedHost("127.0.0.1:45800", 45800)).toBe(true);
    expect(isAllowedHost("127.0.0.1:45801", 45800)).toBe(false);
    expect(isAllowedHost("user@127.0.0.1:45800", 45800)).toBe(false);
    expect(isAllowedHost(undefined, 45800)).toBe(false);
    expect(isAllowedHost("127.0.0.1.evil.com:45800", 45800)).toBe(false);
    expect(classifyOrigin(undefined, new Set())).toBe("none");
    expect(classifyOrigin("http://127.0.0.1:3000", new Set())).toBe("loopback");
    expect(classifyOrigin(EXT_ORIGIN, new Set())).toBeNull();
    expect(classifyOrigin(EXT_ORIGIN, new Set([EXT_ORIGIN]))).toBe("extension");
    expect(BASE).toContain("127.0.0.1");
  });

  it("redact oculta tokens, Bearer y rutas", () => {
    const out = redact("Authorization: Bearer abc.DEF-123 tok=SECRET123 C:\\Users\\jorge\\proj\\a.ts /home/jorge/x?token=zzz&a=1", ["SECRET123"]);
    expect(out).not.toMatch(/abc\.DEF|SECRET123|jorge|zzz/);
    expect(out).toContain("[redacted]");
    expect(out).toContain("<path>");
  });

  it("RateLimiter reinicia por ventana", () => {
    let t = 0;
    const rl = new RateLimiter(2, 100, () => t);
    expect([rl.hit(), rl.hit(), rl.hit()]).toEqual([true, true, false]);
    t = 150;
    expect(rl.hit()).toBe(true);
  });
});
