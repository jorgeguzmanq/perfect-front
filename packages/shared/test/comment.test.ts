import { describe, expect, it } from "vitest";
import {
  CreateCommentRequestSchema,
  MoveCommentRequestSchema,
  ProjectConfigSchema,
  ResolutionSchema,
  VisualCommentSchema,
  PerfectFrontEventSchema,
} from "../src/index";
import { specComment, specCommentV2, specConfig, specResolution } from "./fixtures";

describe("ProjectConfig", () => {
  it("acepta el ejemplo de SPEC", () => {
    expect(ProjectConfigSchema.safeParse(specConfig).success).toBe(true);
  });
  it("acepta solo version", () => {
    expect(ProjectConfigSchema.safeParse({ version: 1 }).success).toBe(true);
  });
  it("rechaza propiedades desconocidas, url no http y colección insegura", () => {
    expect(ProjectConfigSchema.safeParse({ version: 1, extra: 1 }).success).toBe(false);
    expect(ProjectConfigSchema.safeParse({ version: 1, url: "file:///etc/passwd" }).success).toBe(false);
    expect(ProjectConfigSchema.safeParse({ version: 1, defaultCollection: "../x" }).success).toBe(false);
  });
});

describe("VisualComment (v2)", () => {
  it("acepta el ejemplo de SPEC en su forma v2", () => {
    expect(VisualCommentSchema.safeParse(specCommentV2()).success).toBe(true);
  });

  it("rechaza la forma v1 directa: el esquema actual solo acepta version 2", () => {
    expect(VisualCommentSchema.safeParse(specComment()).success).toBe(false);
  });

  it("roundtrip JSON sin pérdida", () => {
    const parsed = VisualCommentSchema.parse(specCommentV2());
    const again = VisualCommentSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(again).toEqual(parsed);
    expect(JSON.parse(JSON.stringify(again))).toEqual(specCommentV2());
  });

  it("acepta scope view con selector/html/rect nulos", () => {
    const c = specCommentV2();
    c.scope = "view";
    c.location.selector = null;
    c.location.html = null;
    c.elementRect = null;
    expect(VisualCommentSchema.safeParse(c).success).toBe(true);
  });

  it("rechaza scope element sin selector", () => {
    const c = specCommentV2();
    c.location.selector = null;
    expect(VisualCommentSchema.safeParse(c).success).toBe(false);
  });

  it("acepta resolución de SPEC", () => {
    expect(ResolutionSchema.safeParse(specResolution).success).toBe(true);
    const c = specCommentV2();
    c.status = "resolved";
    c.collection = "resolved";
    c.resolution = specResolution;
    expect(VisualCommentSchema.safeParse(c).success).toBe(true);
  });

  it("rechaza resolución con estado pending", () => {
    const c = specCommentV2();
    c.resolution = specResolution;
    expect(VisualCommentSchema.safeParse(c).success).toBe(false);
  });

  it.each([
    ["status", (c: any) => (c.status = "done")],
    ["scope", (c: any) => (c.scope = "page")],
    ["id", (c: any) => (c.id = "../evil")],
    ["collection", (c: any) => (c.collection = "a/b")],
    ["url", (c: any) => (c.location.url = "javascript:alert(1)")],
    ["route", (c: any) => (c.location.route = "pricing")],
    ["timestamp", (c: any) => (c.createdAt = "mañana")],
    ["adjunto", (c: any) => (c.attachments = ["../../secret.png"])],
    ["propiedad extra", (c: any) => (c.extra = true)],
    ["viewport", (c: any) => (c.viewport.width = -1)],
    ["version futura", (c: any) => (c.version = 3)],
    ["version v1 con campos v2", (c: any) => (c.version = 1)],
    ["comentario vacío", (c: any) => (c.comment = "")],
  ])("rechaza %s inválido", (_n, mutate) => {
    const c = specCommentV2();
    mutate(c);
    expect(VisualCommentSchema.safeParse(c).success).toBe(false);
  });
});

describe("API", () => {
  const req = () => {
    const c = specComment();
    return {
      version: 1,
      scope: c.scope,
      comment: c.comment,
      location: c.location,
      viewport: c.viewport,
      elementRect: c.elementRect,
      environment: c.environment,
    };
  };

  it("acepta CreateCommentRequest válido", () => {
    expect(CreateCommentRequestSchema.safeParse(req()).success).toBe(true);
  });

  it("rechaza rutas de filesystem y campos de servidor en la creación", () => {
    expect(CreateCommentRequestSchema.safeParse({ ...req(), root: "C:\\proyecto" }).success).toBe(false);
    expect(CreateCommentRequestSchema.safeParse({ ...req(), id: "pf_01K7A" }).success).toBe(false);
    expect(CreateCommentRequestSchema.safeParse({ ...req(), collection: "../x" }).success).toBe(false);
  });

  it("valida move", () => {
    expect(MoveCommentRequestSchema.safeParse({ to: "mobile" }).success).toBe(true);
    expect(MoveCommentRequestSchema.safeParse({ to: "..\\mobile" }).success).toBe(false);
    expect(MoveCommentRequestSchema.safeParse({ to: "mobile", extra: 1 }).success).toBe(false);
  });
});

describe("eventos", () => {
  it("acepta y rechaza eventos", () => {
    const ok = {
      type: "collection.created",
      at: "2026-10-03T15:30:00.000Z",
      projectId: "proj1",
      collection: "mobile",
    };
    expect(PerfectFrontEventSchema.safeParse(ok).success).toBe(true);
    expect(PerfectFrontEventSchema.safeParse({ ...ok, collection: "../x" }).success).toBe(false);
    expect(PerfectFrontEventSchema.safeParse({ ...ok, type: "otro" }).success).toBe(false);
  });
});
