import { describe, expect, it } from "vitest";
import { CreateCommentRequestSchema, ExtraTargetSchema, LIMITS, VisualCommentSchema } from "../src/index";
import { specCommentV2 } from "./fixtures";

function extra(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    selector: "main button.secondary",
    selectorCandidates: ["main button.secondary"],
    text: "Cancelar",
    html: '<button class="secondary">Cancelar</button>',
    componentHint: null,
    source: null,
    elementRect: { x: 10, y: 20, width: 100, height: 40 },
    ...over,
  };
}

function viewComment() {
  const c = specCommentV2();
  c.scope = "view";
  c.location.selector = null;
  c.location.html = null;
  c.elementRect = null;
  return c;
}

function createBody(over: Record<string, unknown> = {}) {
  const c = specCommentV2();
  return {
    version: 2,
    scope: c.scope,
    comment: c.comment,
    location: c.location,
    viewport: c.viewport,
    elementRect: c.elementRect,
    environment: c.environment,
    ...over,
  };
}

describe("ExtraTargetSchema", () => {
  it("acepta un elemento adicional válido", () => {
    expect(ExtraTargetSchema.safeParse(extra("t1")).success).toBe(true);
  });

  it("acepta source con línea y columna nulas, o source ausente", () => {
    expect(ExtraTargetSchema.safeParse(extra("t1", { source: { file: "src/Cancel.tsx", line: null } })).success).toBe(true);
    const { source: _s, ...noSource } = extra("t1");
    expect(ExtraTargetSchema.safeParse(noSource).success).toBe(true);
  });

  it("html admite hasta LIMITS.extraTargetHtml y rechaza uno más", () => {
    expect(ExtraTargetSchema.safeParse(extra("t1", { html: "h".repeat(LIMITS.extraTargetHtml) })).success).toBe(true);
    expect(ExtraTargetSchema.safeParse(extra("t1", { html: "h".repeat(LIMITS.extraTargetHtml + 1) })).success).toBe(false);
  });

  it("html y text pueden ser null", () => {
    expect(ExtraTargetSchema.safeParse(extra("t1", { html: null, text: null })).success).toBe(true);
  });

  it("rechaza un id local inválido", () => {
    expect(ExtraTargetSchema.safeParse(extra("../t1")).success).toBe(false);
    expect(ExtraTargetSchema.safeParse(extra("")).success).toBe(false);
  });

  it("rechaza más de LIMITS.selectorCandidates candidatos", () => {
    const candidates = Array.from({ length: LIMITS.selectorCandidates + 1 }, (_, i) => `button.b${i}`);
    expect(ExtraTargetSchema.safeParse(extra("t1", { selectorCandidates: candidates })).success).toBe(false);
  });

  it("elementRect no admite ancho o alto negativos", () => {
    expect(ExtraTargetSchema.safeParse(extra("t1", { elementRect: { x: 0, y: 0, width: -1, height: 1 } })).success).toBe(false);
    expect(ExtraTargetSchema.safeParse(extra("t1", { elementRect: { x: 0, y: 0, width: 1, height: -1 } })).success).toBe(false);
  });

  it("rechaza propiedades extra", () => {
    expect(ExtraTargetSchema.safeParse(extra("t1", { extra: 1 })).success).toBe(false);
  });
});

describe("extraTargets en VisualComment", () => {
  it("LIMITS.extraTargets es 19 (20 elementos con el principal)", () => {
    expect(LIMITS.extraTargets).toBe(19);
  });

  it("acepta 19 elementos adicionales", () => {
    const c = specCommentV2();
    c.extraTargets = Array.from({ length: 19 }, (_, i) => extra(`t${i}`));
    expect(VisualCommentSchema.safeParse(c).success).toBe(true);
  });

  it("rechaza 20 elementos adicionales", () => {
    const c = specCommentV2();
    c.extraTargets = Array.from({ length: 20 }, (_, i) => extra(`t${i}`));
    expect(VisualCommentSchema.safeParse(c).success).toBe(false);
  });

  it("rechaza ids de elemento duplicados", () => {
    const c = specCommentV2();
    c.extraTargets = [extra("t1"), extra("t1", { selector: "main a" })];
    expect(VisualCommentSchema.safeParse(c).success).toBe(false);
  });

  it("scope view no admite elementos adicionales", () => {
    const c = viewComment();
    c.extraTargets = [extra("t1")];
    expect(VisualCommentSchema.safeParse(c).success).toBe(false);
  });

  it("scope view sin elementos adicionales es válido", () => {
    expect(VisualCommentSchema.safeParse(viewComment()).success).toBe(true);
  });

  it("scope element admite elementos adicionales junto al principal", () => {
    const c = specCommentV2();
    c.extraTargets = [extra("t1")];
    expect(VisualCommentSchema.parse(c).extraTargets).toHaveLength(1);
  });
});

describe("extraTargets en la creación", () => {
  it("acepta 19 elementos adicionales y rechaza 20", () => {
    const ok = Array.from({ length: 19 }, (_, i) => extra(`t${i}`));
    const ko = Array.from({ length: 20 }, (_, i) => extra(`t${i}`));
    expect(CreateCommentRequestSchema.safeParse(createBody({ extraTargets: ok })).success).toBe(true);
    expect(CreateCommentRequestSchema.safeParse(createBody({ extraTargets: ko })).success).toBe(false);
  });

  it("la creación con scope view rechaza elementos adicionales", () => {
    const body = createBody({ scope: "view", location: viewComment().location, elementRect: null, extraTargets: [extra("t1")] });
    expect(CreateCommentRequestSchema.safeParse(body).success).toBe(false);
  });

  it("sin extraTargets, la creación usa lista vacía", () => {
    expect(CreateCommentRequestSchema.parse(createBody()).extraTargets).toEqual([]);
  });
});
