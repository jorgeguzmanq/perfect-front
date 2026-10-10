import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CommentResponseSchema,
  ErrorResponseSchema,
  HealthResponseSchema,
  ListCollectionsResponseSchema,
  ListCommentsResponseSchema,
  ListProjectsResponseSchema,
  PerfectFrontEventSchema,
  RegisterProjectResponseSchema,
  type PerfectFrontEvent,
} from "@perfect-front/shared";
import { BatchMoveResponseSchema } from "../src/contracts-extra";
import { EXT_ORIGIN, SseClient, commentInput, makeHarness } from "./helpers";

function expectError(r: { status: number; body: unknown }, status: number, code: string): void {
  expect(r.status).toBe(status);
  const parsed = ErrorResponseSchema.parse(r.body);
  expect(parsed.error.code).toBe(code);
  expect(JSON.stringify(r.body)).not.toMatch(/stack|node_modules|[A-Z]:\\\\/);
}

describe("health y proyectos", () => {
  it("health responde sin token y con contrato válido", async () => {
    const h = await makeHarness();
    const r = await h.json("/api/health", { auth: "none" });
    expect(r.status).toBe(200);
    expect(HealthResponseSchema.parse(r.body).features).toContain("proxy-v1");
  });

  it("registra (solo CLI), lista y es idempotente con id estable", async () => {
    const h = await makeHarness();
    const a = await h.json("/api/projects/register", { auth: "cli", body: { root: h.projectRoot, url: "http://localhost:5173" } });
    expect(a.status).toBe(201);
    const proj = RegisterProjectResponseSchema.parse(a.body).project;
    expect(proj.url).toBe("http://localhost:5173");
    const b = await h.json("/api/projects/register", { auth: "cli", body: { root: h.projectRoot } });
    expect(RegisterProjectResponseSchema.parse(b.body).project.id).toBe(proj.id);
    const list = ListProjectsResponseSchema.parse((await h.json("/api/projects")).body);
    expect(list.projects).toHaveLength(1);
    await fs.stat(path.join(h.projectRoot, ".perfect-front", "comments", "inbox"));
  });

  it("registro: token de sesión, Origin o raíz inválida son rechazados", async () => {
    const h = await makeHarness();
    expectError(await h.json("/api/projects/register", { auth: "session", body: { root: h.projectRoot } }), 403, "forbidden_origin");
    expectError(
      await h.json("/api/projects/register", { auth: "cli", body: { root: h.projectRoot }, headers: { origin: "http://localhost:5173" } }),
      403,
      "forbidden_origin",
    );
    expectError(await h.json("/api/projects/register", { auth: "cli", body: { root: "relativa/ruta" } }), 400, "invalid_request");
    expectError(await h.json("/api/projects/register", { auth: "cli", body: { root: path.join(h.projectRoot, "nope") } }), 404, "not_found");
    expectError(await h.json("/api/projects/register", { auth: "cli", body: { root: h.projectRoot, extra: 1 } }), 400, "invalid_request");
    expect((await h.json("/api/projects")).body.projects).toHaveLength(0);
  });

  it("projectId desconocido o malformado se resuelve contra el registro", async () => {
    const h = await makeHarness();
    expectError(await h.json("/api/projects/p_0000000000000000/comments"), 404, "not_found");
    expectError(await h.json("/api/projects/..%2F..%2Fetc/comments"), 400, "invalid_id");
    expectError(await h.json(`/api/projects/${encodeURIComponent(h.projectRoot)}/comments`), 400, "invalid_id");
  });

  it("ningún endpoint de comentarios acepta una raíz", async () => {
    const h = await makeHarness();
    const id = await h.register();
    expectError(await h.json(`/api/projects/${id}/comments`, { body: commentInput({ root: h.projectRoot }) }), 400, "invalid_request");
    expectError(await h.json(`/api/projects/${id}/collections`, { body: { name: "x", root: "C:\\" } }), 400, "invalid_request");
  });
});

describe("ciclo de comentarios", () => {
  it("crear, leer, listar, editar, mover, resolver, reabrir", async () => {
    const h = await makeHarness();
    const id = await h.register();
    const base = `/api/projects/${id}`;

    const created = await h.json(`${base}/comments`, { body: commentInput() });
    expect(created.status).toBe(201);
    const c = CommentResponseSchema.parse(created.body).comment;
    expect(c.collection).toBe("inbox");
    expect(await fs.readdir(path.join(h.projectRoot, ".perfect-front", "comments", "inbox"))).toEqual([`${c.id}.json`]);

    expect((await h.json(`${base}/comments/${c.id}`)).body.comment.id).toBe(c.id);
    const listed = ListCommentsResponseSchema.parse((await h.json(`${base}/comments?status=pending&q=ancho`)).body);
    expect(listed.comments.map((x) => x.id)).toEqual([c.id]);
    expect((await h.json(`${base}/comments?status=resolved`)).body.comments).toHaveLength(0);
    expectError(await h.json(`${base}/comments?status=bogus`), 400, "invalid_request");
    expectError(await h.json(`${base}/comments?extra=1`), 400, "invalid_request");

    const patched = await h.json(`${base}/comments/${c.id}`, { method: "PATCH", body: { comment: "Editado", status: "in_progress" } });
    expect(patched.body.comment).toMatchObject({ comment: "Editado", status: "in_progress" });
    expectError(await h.json(`${base}/comments/${c.id}`, { method: "PATCH", body: {} }), 400, "invalid_request");

    expectError(await h.json(`${base}/collections`, { body: { name: "inbox" } }), 409, "conflict");
    const col = await h.json(`${base}/collections`, { body: { name: "mobile" } });
    expect(col.status).toBe(201);
    const cols = ListCollectionsResponseSchema.parse((await h.json(`${base}/collections`)).body);
    expect(cols.collections.map((x) => x.name)).toEqual(expect.arrayContaining(["inbox", "resolved", "archived", "mobile"]));

    const moved = await h.json(`${base}/comments/${c.id}/move`, { body: { to: "mobile" } });
    expect(moved.body.comment.collection).toBe("mobile");
    await expect(fs.stat(path.join(h.projectRoot, ".perfect-front", "comments", "inbox", `${c.id}.json`))).rejects.toThrow();
    expectError(await h.json(`${base}/comments/${c.id}/move`, { body: { to: "no-existe" } }), 404, "not_found");

    const resolved = await h.json(`${base}/comments/${c.id}/resolve`, { body: { summary: "Hecho", filesChanged: ["src/a.tsx"] } });
    expect(resolved.body.comment).toMatchObject({ status: "resolved", collection: "resolved" });
    expect(resolved.body.comment.resolution.summary).toBe("Hecho");
    expectError(await h.json(`${base}/comments/${c.id}/resolve`, { body: {} }), 400, "invalid_request");

    const reopened = await h.json(`${base}/comments/${c.id}/reopen`, { method: "POST" });
    expect(reopened.body.comment).toMatchObject({ status: "pending", collection: "inbox", resolution: null });

    expectError(await h.json(`${base}/comments/pf_ZZZZZZZZZZ`), 404, "not_found");
    expectError(await h.json(`${base}/comments/no-es-id`), 400, "invalid_id");
    expect((await h.json("/api/projects")).body.projects[0].pendingCount).toBe(1);
  });

  it("movimiento por lote reporta cada resultado", async () => {
    const h = await makeHarness();
    const id = await h.register();
    const base = `/api/projects/${id}`;
    const a = (await h.json(`${base}/comments`, { body: commentInput() })).body.comment.id;
    const b = (await h.json(`${base}/comments`, { body: commentInput() })).body.comment.id;
    await h.json(`${base}/collections`, { body: { name: "mobile" } });
    const r = await h.json(`${base}/comments/move`, { body: { ids: [a, b, "pf_ZZZZZZZZZZ"], to: "mobile" } });
    expect(r.status).toBe(200);
    const res = BatchMoveResponseSchema.parse(r.body).results;
    expect(res.map((x) => x.ok)).toEqual([true, true, false]);
    expect((await h.json(`${base}/comments?collection=mobile`)).body.comments).toHaveLength(2);
    expectError(await h.json(`${base}/comments/move`, { body: { ids: [], to: "mobile" } }), 400, "invalid_request");
  });

  it("validación de body y límites", async () => {
    const h = await makeHarness();
    const id = await h.register();
    const base = `/api/projects/${id}`;
    expectError(await h.json(`${base}/comments`, { raw: "{no json", headers: { "content-type": "application/json" } }), 400, "invalid_request");
    expectError(await h.json(`${base}/comments`, { raw: "{}", headers: { "content-type": "text/plain" } }), 400, "invalid_request");
    expectError(await h.json(`${base}/comments`, { body: commentInput({ scope: "element", elementRect: null }) }), 400, "invalid_request");
    expectError(await h.json(`${base}/collections`, { body: { name: "a".repeat(80 * 1024) } }), 413, "payload_too_large");
    const unknown = await h.json("/api/no-existe");
    expectError(unknown, 404, "not_found");
  });

  it("procesos: iniciar, detener, logs limitados y redactados; la extensión no puede", async () => {
    const h = await makeHarness();
    const id = await h.register();
    const base = `/api/projects/${id}`;
    const started = await h.json(`${base}/start`, { method: "POST" });
    expect(started.body).toMatchObject({ ok: true, outcome: "started", project: { processState: "running", managed: true } });
    expect(h.controller.calls.some((c) => c.startsWith("start:"))).toBe(true);

    h.controller.logLines = Array.from({ length: 700 }, (_, i) => `linea ${i} token ${h.token} en ${h.projectRoot}`);
    const logs = await h.json(`${base}/logs?lines=5`);
    expect(logs.body.lines).toHaveLength(5);
    expect(JSON.stringify(logs.body)).not.toContain(h.token);
    expect(JSON.stringify(logs.body)).not.toContain(h.projectRoot);
    expect((await h.json(`${base}/logs`)).body.lines.length).toBeLessThanOrEqual(200);
    expectError(await h.json(`${base}/logs?lines=100000`), 400, "invalid_request");

    expectError(await h.json(`${base}/stop`, { method: "POST", headers: { origin: EXT_ORIGIN } }), 403, "forbidden_origin");
    const stopped = await h.json(`${base}/stop`, { method: "POST" });
    expect(stopped.body).toMatchObject({ outcome: "stopped", project: { processState: "stopped" } });

    h.controller.failStart = true;
    const bad = await h.json(`${base}/start`, { method: "POST" });
    expectError(bad, 500, "process_error");
    expect(JSON.stringify(bad.body)).not.toContain("secret");
  });
});

describe("eventos SSE", () => {
  it("emite tras escrituras confirmadas y con esquema válido", async () => {
    const h = await makeHarness();
    const id = await h.register();
    const res = await h.req("/api/events");
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const sse = new SseClient(res);
    await sse.waitFor((t) => t.includes(": connected"));

    const created = (await h.json(`/api/projects/${id}/comments`, { body: commentInput() })).body.comment;
    await h.json(`/api/projects/${id}/collections`, { body: { name: "mobile" } });
    await h.json(`/api/projects/${id}/comments/${created.id}/move`, { body: { to: "mobile" } });
    await h.json(`/api/projects/${id}/comments/${created.id}/resolve`, { body: { summary: "ok" } });
    const text = await sse.waitFor((t) => t.includes("event: comment.resolved"));

    const events: PerfectFrontEvent[] = [...text.matchAll(/^data: (.*)$/gm)].map((m) => PerfectFrontEventSchema.parse(JSON.parse(m[1]!)));
    expect(events.map((e) => e.type)).toEqual(["comment.created", "collection.created", "comment.moved", "comment.resolved"]);
    const resolvedDir = await fs.readdir(path.join(h.projectRoot, ".perfect-front", "comments", "resolved"));
    expect(resolvedDir).toContain(`${created.id}.json`);
  });

  it("el evento de creación se publica con el archivo ya en disco", async () => {
    const h = await makeHarness();
    const id = await h.register();
    const inbox = path.join(h.projectRoot, ".perfect-front", "comments", "inbox");
    let existedAtPublish: boolean | null = null;
    h.core.bus.subscribe((e) => {
      if (e.type === "comment.created") {
        existedAtPublish = existsSync(path.join(inbox, `${e.comment.id}.json`));
      }
    });
    await h.json(`/api/projects/${id}/comments`, { body: commentInput() });
    expect(existedAtPublish).toBe(true);
  });

  it("no emite eventos cuando la escritura falla", async () => {
    const h = await makeHarness();
    const id = await h.register();
    const sse = new SseClient(await h.req("/api/events"));
    await sse.waitFor((t) => t.includes(": connected"));
    await h.json(`/api/projects/${id}/comments`, { body: commentInput({ collection: "no-existe" }) });
    await h.json(`/api/projects/${id}/comments/pf_ZZZZZZZZZZ/move`, { body: { to: "inbox" } });
    await h.json(`/api/projects/${id}/comments`, { body: commentInput() });
    const text = await sse.waitFor((t) => t.includes("comment.created"));
    expect(text.match(/event: /g)).toHaveLength(1);
  });

  it("exige token (cabecera, o access_token solo en /api/events)", async () => {
    const h = await makeHarness();
    expect((await h.req("/api/events", { auth: "none" })).status).toBe(401);
    const viaQuery = await h.req(`/api/events?access_token=${h.token}`, { auth: "none" });
    expect(viaQuery.status).toBe(200);
    await viaQuery.body!.cancel();
    expect((await h.req(`/api/projects?access_token=${h.token}`, { auth: "none" })).status).toBe(401);
  });
});

describe("persistencia entre reinicios", () => {
  it("reconstruye proyectos y comentarios desde disco", async () => {
    const h1 = await makeHarness();
    const id = await h1.register();
    const c = (await h1.json(`/api/projects/${id}/comments`, { body: commentInput() })).body.comment;
    h1.core.close();

    const h2 = await makeHarness({ stateDir: h1.stateDir, projectRoot: h1.projectRoot });
    const projects = (await h2.json("/api/projects")).body.projects;
    expect(projects.map((p: { id: string }) => p.id)).toEqual([id]);
    expect(projects[0].pendingCount).toBe(1);
    expect((await h2.json(`/api/projects/${id}/comments/${c.id}`)).body.comment.comment).toBe(c.comment);
  });
});



describe("proxy: url y targetUrl", () => {
  it("devuelve url (proxy) y targetUrl (original), los persiste y los rehidrata tras reinicio", async () => {
    const h1 = await makeHarness();
    h1.controller.info = { state: "running", managed: true, url: "http://localhost:5173/", pid: 1 };
    const a = await h1.json("/api/projects/register", {
      auth: "cli",
      body: { root: h1.projectRoot, url: "http://127.0.0.1:7788/", targetUrl: "http://localhost:5173/" },
    });
    expect(a.status).toBe(201);
    const proj = RegisterProjectResponseSchema.parse(a.body).project;
    expect(proj.url).toBe("http://127.0.0.1:7788/");
    expect(proj.targetUrl).toBe("http://localhost:5173/");
    // El proceso se consulta por la URL original, no por la del proxy.
    expect(ListProjectsResponseSchema.parse((await h1.json("/api/projects")).body).projects[0]!.url).toBe("http://127.0.0.1:7788/");
    h1.core.close();

    const h2 = await makeHarness({ stateDir: h1.stateDir, projectRoot: h1.projectRoot });
    const p2 = ListProjectsResponseSchema.parse((await h2.json("/api/projects")).body).projects[0]!;
    expect(p2.url).toBe("http://127.0.0.1:7788/");
    expect(p2.targetUrl).toBe("http://localhost:5173/");

    // Re-registro sin proxy (--no-proxy): se limpia targetUrl.
    const b = await h2.json("/api/projects/register", { auth: "cli", body: { root: h2.projectRoot, url: "http://localhost:5173/" } });
    const p3 = RegisterProjectResponseSchema.parse(b.body).project;
    expect(p3.url).toBe("http://localhost:5173/");
    expect(p3.targetUrl ?? null).toBeNull();
  });
});
