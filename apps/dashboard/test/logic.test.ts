import { describe, expect, it } from "vitest";
import { validateCollectionName } from "../src/lib/collections";
import { hasEditConflict, upsertComment } from "../src/lib/conflict";
import { applyCommentEvent, backoffDelay, parseEvent } from "../src/lib/events";
import { DEFAULT_FILTERS, countByStatus, filterComments, matchesQuery, planBatchMove, toggleStatus } from "../src/lib/filters";
import { escapeHtml, safeHttpUrl } from "../src/lib/html";
import { buildAgentPrompt } from "../src/lib/prompt";
import { parseResolveForm } from "../src/lib/resolve";
import { parseRoute, routePath } from "../src/hooks/useRoute";
import { makeComment } from "./fixtures";

const a = makeComment({ id: "pf_AAAAA", createdAt: "2026-10-01T10:00:00.000Z", comment: "Reducir espacio del héroe" });
const b = makeComment({ id: "pf_BBBBB", status: "resolved", collection: "resolved", createdAt: "2026-10-02T10:00:00.000Z", comment: "Botón de compra" }, { route: "/planes", url: "http://localhost:5173/planes" });
const c = makeComment({ id: "pf_CCCCC", status: "ignored", createdAt: "2026-10-03T10:00:00.000Z", comment: "Logo borroso" }, { route: "/login", title: "Iniciar sesión" });

describe("filtros y busqueda", () => {
  it("busca por id, texto y ruta sin distinguir acentos ni mayusculas", () => {
    expect(matchesQuery(a, "pf_aaaaa")).toBe(true);
    expect(matchesQuery(a, "HEROE")).toBe(true);
    expect(matchesQuery(b, "/planes")).toBe(true);
    expect(matchesQuery(c, "sesion")).toBe(true);
    expect(matchesQuery(a, "inexistente")).toBe(false);
    expect(matchesQuery(a, "   ")).toBe(true);
  });

  it("filtra por estado y coleccion y ordena por fecha", () => {
    const all = [a, b, c];
    expect(filterComments(all, DEFAULT_FILTERS).map((x) => x.id)).toEqual(["pf_CCCCC", "pf_BBBBB", "pf_AAAAA"]);
    expect(filterComments(all, { ...DEFAULT_FILTERS, sort: "oldest" }).map((x) => x.id)).toEqual(["pf_AAAAA", "pf_BBBBB", "pf_CCCCC"]);
    expect(filterComments(all, { ...DEFAULT_FILTERS, statuses: ["resolved", "ignored"] }).map((x) => x.id)).toEqual(["pf_CCCCC", "pf_BBBBB"]);
    expect(filterComments(all, { ...DEFAULT_FILTERS, collection: "resolved" }).map((x) => x.id)).toEqual(["pf_BBBBB"]);
    expect(filterComments(all, { ...DEFAULT_FILTERS, collection: "inbox", statuses: ["resolved"] })).toEqual([]);
    expect(filterComments(all, { ...DEFAULT_FILTERS, query: "login" }).map((x) => x.id)).toEqual(["pf_CCCCC"]);
  });

  it("no muta la entrada y cuenta por estado", () => {
    const all = [b, a];
    filterComments(all, DEFAULT_FILTERS);
    expect(all.map((x) => x.id)).toEqual(["pf_BBBBB", "pf_AAAAA"]);
    expect(countByStatus([a, b, c])).toEqual({ pending: 1, in_progress: 0, resolved: 1, ignored: 1, archived: 0 });
    expect(toggleStatus([], "pending")).toEqual(["pending"]);
    expect(toggleStatus(["pending"], "pending")).toEqual([]);
  });

  it("plan de movimiento por lote: sin duplicados, sin desconocidos, sin los ya en destino", () => {
    const plan = planBatchMove(["pf_AAAAA", "pf_AAAAA", "pf_BBBBB", "pf_ZZZZZ"], [a, b, c], "resolved");
    expect(plan.ids).toEqual(["pf_AAAAA"]);
    expect(plan.skipped).toEqual(["pf_BBBBB", "pf_ZZZZZ"]);
  });
});

describe("conflictos de edicion", () => {
  it("detecta cambio de updatedAt", () => {
    expect(hasEditConflict({ updatedAt: "t1" }, { updatedAt: "t1" })).toBe(false);
    expect(hasEditConflict({ updatedAt: "t1" }, { updatedAt: "t2" })).toBe(true);
    expect(hasEditConflict({ updatedAt: "t1" }, null)).toBe(false);
  });

  it("upsert reemplaza o agrega sin mutar", () => {
    const list = [a, b];
    const updated = makeComment({ id: "pf_AAAAA", comment: "nuevo" });
    const next = upsertComment(list, updated);
    expect(next.map((x) => x.comment)).toContain("nuevo");
    expect(list[0]!.comment).not.toBe("nuevo");
    expect(upsertComment(list, c)).toHaveLength(3);
  });
});

describe("HTML y URLs", () => {
  it("escapa HTML", () => {
    expect(escapeHtml('<img src=x onerror="alert(1)">&\'')).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;&#39;");
  });

  it("solo permite navegar a http(s)", () => {
    expect(safeHttpUrl("http://localhost:5173/a")).toBe("http://localhost:5173/a");
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("data:text/html,<script>")).toBeNull();
    expect(safeHttpUrl("file:///etc/passwd")).toBeNull();
    expect(safeHttpUrl("no es url")).toBeNull();
  });
});

describe("prompt para el agente", () => {
  it("incluye id, ruta, selectores y comandos show/resolve", () => {
    const p = buildAgentPrompt(a, "ContentOEP");
    expect(p).toContain("pf_AAAAA");
    expect(p).toContain("/pricing");
    expect(p).toContain("main button.buy");
    expect(p).toContain('[data-testid="buy-button"]');
    expect(p).toContain("perfect-front show pf_AAAAA --json");
    expect(p).toContain("perfect-front resolve pf_AAAAA");
    expect(p).toContain("ContentOEP");
    expect(p).not.toContain("<button");
  });

  it("el bloque del comentario no se rompe con comillas invertidas", () => {
    const p = buildAgentPrompt(makeComment({ comment: "usa ```código``` aquí" }));
    expect(p).toContain("````\nusa ```código``` aquí\n````");
  });
});

describe("colecciones y resolucion", () => {
  it("valida nombres con el esquema compartido y rechaza duplicados", () => {
    expect(validateCollectionName("  Diseno ", ["inbox"])).toEqual({ ok: true, name: "diseno" });
    expect(validateCollectionName("", [])).toMatchObject({ ok: false });
    expect(validateCollectionName("con espacio", [])).toMatchObject({ ok: false });
    expect(validateCollectionName("../x", [])).toMatchObject({ ok: false });
    expect(validateCollectionName("nul", [])).toMatchObject({ ok: false });
    expect(validateCollectionName("inbox", ["inbox"])).toMatchObject({ ok: false });
    expect(validateCollectionName("a".repeat(65), [])).toMatchObject({ ok: false });
  });

  it("parsea el formulario de resolucion", () => {
    expect(parseResolveForm({ summary: " ", files: "", verification: "", commit: "" })).toMatchObject({ ok: false, errors: { summary: expect.any(String) } });
    const r = parseResolveForm({ summary: "Hecho", files: "a.ts\n\n b.ts ", verification: "pnpm test", commit: "" });
    expect(r).toEqual({ ok: true, request: { resolvedBy: "dashboard", summary: "Hecho", filesChanged: ["a.ts", "b.ts"], verification: ["pnpm test"] } });
  });
});

describe("eventos y rutas", () => {
  const at = "2026-10-03T10:00:00.000Z";
  it("parsea eventos y descarta basura", () => {
    expect(parseEvent("no json")).toBeNull();
    expect(parseEvent('{"type":1}')).toBeNull();
    expect(parseEvent(JSON.stringify({ type: "comment.deleted", projectId: "p", at, commentId: "x", collection: "inbox" }))).toMatchObject({ type: "comment.deleted" });
  });

  it("aplica eventos de comentario", () => {
    const moved = makeComment({ id: "pf_AAAAA", collection: "resolved" });
    const base = [a, b];
    const afterMove = applyCommentEvent(base, { type: "comment.moved", at, projectId: "p", commentId: "pf_AAAAA", from: "inbox", to: "resolved", comment: moved } as never);
    expect(afterMove.find((x) => x.id === "pf_AAAAA")!.collection).toBe("resolved");
    expect(afterMove).toHaveLength(2);
    expect(applyCommentEvent(base, { type: "comment.deleted", at, projectId: "p", commentId: "pf_AAAAA", collection: "inbox" } as never)).toHaveLength(1);
    expect(applyCommentEvent(base, { type: "collection.created", at, projectId: "p", collection: "x" } as never)).toBe(base);
  });

  it("backoff exponencial acotado y rutas recargables", () => {
    expect([0, 1, 2, 10].map((n) => backoffDelay(n))).toEqual([1000, 2000, 4000, 15000]);
    expect(parseRoute("/projects/p_1/comments/pf_A")).toEqual({ projectId: "p_1", commentId: "pf_A" });
    expect(parseRoute("/projects/p_1")).toEqual({ projectId: "p_1", commentId: null });
    expect(parseRoute("/otra")).toEqual({ projectId: null, commentId: null });
    expect(parseRoute("/projects/%E0%A4%A")).toEqual({ projectId: null, commentId: null });
    expect(routePath({ projectId: "p 1", commentId: "pf_A" })).toBe("/projects/p%201/comments/pf_A");
  });
});
