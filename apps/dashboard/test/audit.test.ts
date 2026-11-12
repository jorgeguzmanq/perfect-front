import { describe, expect, it } from "vitest";
import type { ReadingGroup } from "@perfect-front/shared";
import { NO_GROUP, buildAuditRows, collectSources, distinctRoutes, elementsLabel, filterAudit, sourceLabel, stepLabel, DEFAULT_AUDIT_FILTERS } from "../src/lib/audit";
import { parseRoute, routePath } from "../src/hooks/useRoute";
import { makeComment as base } from "./fixtures";

const makeComment = (over: Record<string, unknown> = {}, loc: Record<string, unknown> = {}) => base({ attachmentInfo: [], sections: [], extraTargets: [], proposals: [], group: null, ...over }, loc);

const groups = [{ id: "grp_1", name: "Hero", note: "", readFirst: true }] as unknown as ReadingGroup[];
const src = { file: "src/Hero.tsx", line: 12, column: 3 };

const a = makeComment({ id: "pf_A", group: { id: "grp_1", position: 2 }, extraTargets: [{ id: "t1", source: src }, { id: "t2" }], createdAt: "2026-10-03T10:00:00.000Z" });
const b = makeComment({ id: "pf_B", group: { id: "grp_1", position: 1 }, createdAt: "2026-10-03T11:00:00.000Z" });
const c = makeComment({ id: "pf_C", group: null, status: "resolved", comment: "Título del héroe", createdAt: "2026-10-03T09:00:00.000Z" }, { route: "/inicio" });
const withProposals = makeComment({
  id: "pf_D",
  group: null,
  proposals: [
    { id: "p1", kind: "text_fixed", before: "a", after: "b", source: src },
    { id: "p2", kind: "style", changes: [{ property: "color", before: "red", after: "blue", origin: "editable", source: { file: "a.css", line: null } }] },
    { id: "p3", kind: "reorder", from: 1, to: 2, siblingCount: 3 },
  ],
});

describe("auditoria", () => {
  it("calcula paso/total, grupo y numero de elementos", () => {
    const rows = buildAuditRows([a, b, c], groups);
    const ra = rows[0]!;
    expect(stepLabel(ra)).toBe("paso 2/2 · grupo Hero");
    expect(elementsLabel(ra)).toBe("3 elementos");
    expect(stepLabel(rows[2]!)).toBeNull();
    expect(elementsLabel(rows[2]!)).toBeNull();
  });

  it("usa el id del grupo si no hay nombre y ordena por cola; sueltos al final", () => {
    const rows = buildAuditRows([c, a, b], []);
    expect(filterAudit(rows, DEFAULT_AUDIT_FILTERS).map((r) => r.comment.id)).toEqual(["pf_B", "pf_A", "pf_C"]);
    expect(rows[1]!.groupName).toBe("grp_1");
  });

  it("filtra por estado, grupo, ruta y busqueda sin acentos", () => {
    const rows = buildAuditRows([a, b, c], groups);
    const ids = (f: Partial<typeof DEFAULT_AUDIT_FILTERS>) => filterAudit(rows, { ...DEFAULT_AUDIT_FILTERS, ...f }).map((r) => r.comment.id);
    expect(ids({ statuses: ["resolved"] })).toEqual(["pf_C"]);
    expect(ids({ group: "grp_1" })).toEqual(["pf_B", "pf_A"]);
    expect(ids({ group: NO_GROUP })).toEqual(["pf_C"]);
    expect(ids({ route: "/inicio" })).toEqual(["pf_C"]);
    expect(ids({ query: "TITULO heroe" })).toEqual([]);
    expect(ids({ query: "titulo del heroe" })).toEqual(["pf_C"]);
    expect(ids({ query: "hero" })).toEqual(["pf_B", "pf_A", "pf_C"]);
    expect(ids({ query: "src/hero.tsx" })).toEqual(["pf_A"]);
  });

  it("recoge fuentes de propuestas y elementos extra sin repetir", () => {
    expect(collectSources(withProposals).map(sourceLabel)).toEqual(["src/Hero.tsx:12", "a.css"]);
    expect(collectSources(a).map(sourceLabel)).toEqual(["src/Hero.tsx:12"]);
    expect(collectSources(b)).toEqual([]);
  });

  it("rutas distintas ordenadas y ruta /audit", () => {
    expect(distinctRoutes([a, c])).toEqual(["/inicio", "/pricing"]);
    expect(parseRoute("/projects/p_1/audit")).toEqual({ projectId: "p_1", commentId: null, audit: true });
    expect(routePath({ projectId: "p_1", commentId: null, audit: true })).toBe("/projects/p_1/audit");
  });
});
