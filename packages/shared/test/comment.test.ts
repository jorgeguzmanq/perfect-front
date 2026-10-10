import { describe, expect, it } from "vitest";
import {
  CreateCommentRequestSchema,
  MoveCommentRequestSchema,
  ProjectConfigSchema,
  ResolutionSchema,
  VisualCommentSchema,
  PerfectFrontEventSchema,
} from "../src/index";
import { specComment, specConfig, specResolution } from "./fixtures";

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

describe("VisualComment", () => {
  it("acepta el ejemplo de SPEC", () => {
    expect(VisualCommentSchema.safeParse(specComment()).success).toBe(true);
  });

  it("roundtrip JSON sin pérdida", () => {
    const parsed = VisualCommentSchema.parse(specComment());
    const again = VisualCommentSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(again).toEqual(parsed);
    expect(JSON.parse(JSON.stringify(again))).toEqual(specComment());
  });

  it("acepta scope view con selector/html/rect nulos", () => {
    const c = specComment();
    c.scope = "view";
    c.location.selector = null;
    c.location.html = null;
    c.elementRect = null;
    expect(VisualCommentSchema.safeParse(c).success).toBe(true);
  });

  it("rechaza scope element sin selector", () => {
    const c = specComment();
    c.location.selector = null;
    expect(VisualCommentSchema.safeParse(c).success).toBe(false);
  });

  it("acepta resolución de SPEC", () => {
    expect(ResolutionSchema.safeParse(specResolution).success).toBe(true);
    const c = specComment();
    c.status = "resolved";
    c.collection = "resolved";
    c.resolution = specResolution;
    expect(VisualCommentSchema.safeParse(c).success).toBe(true);
  });

  it("rechaza resolución con estado pending", () => {
    const c = specComment();
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
    ["version", (c: any) => (c.version = 2)],
    ["comentario vacío", (c: any) => (c.comment = "")],
  ])("rechaza %s inválido", (_n, mutate) => {
    const c = specComment();
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
