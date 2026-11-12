import { describe, expect, it } from "vitest";
import { CommentLocationSchema, CreateCommentRequestSchema, VisualCommentSchema } from "../src/index";
import { specCommentV2 } from "./fixtures";

describe("location.frame y location.source (v2, opcionales)", () => {
  it("un comentario sin frame sigue siendo válido (retrocompatible)", () => {
    expect(VisualCommentSchema.safeParse(specCommentV2()).success).toBe(true);
  });

  it("acepta frame con selector del iframe y ruta anfitriona", () => {
    const c = specCommentV2();
    c.location.frame = { url: "http://localhost:5173/embed", selector: "iframe#preview", hostRoute: "/dashboard?tab=1" };
    c.location.source = { file: "src/App.tsx", line: 12, column: 3 };
    expect(VisualCommentSchema.safeParse(c).success).toBe(true);
  });

  it("acepta frame con selector null (anfitrión ilegible) y frame null", () => {
    const c = specCommentV2();
    c.location.frame = { url: "http://localhost:5173/embed", selector: null };
    expect(VisualCommentSchema.safeParse(c).success).toBe(true);
    c.location.frame = null;
    expect(VisualCommentSchema.safeParse(c).success).toBe(true);
  });

  it("rechaza frame con url no http, campos extra o hostRoute sin barra", () => {
    const base = specCommentV2().location;
    expect(CommentLocationSchema.safeParse({ ...base, frame: { url: "javascript:1", selector: null } }).success).toBe(false);
    expect(CommentLocationSchema.safeParse({ ...base, frame: { url: "http://a.test/x", selector: null, extra: 1 } }).success).toBe(false);
    expect(CommentLocationSchema.safeParse({ ...base, frame: { url: "http://a.test/x", selector: null, hostRoute: "dash" } }).success).toBe(false);
  });

  it("la request de creación conserva frame", () => {
    const c = specCommentV2();
    const frame = { url: "http://localhost:5173/embed", selector: "iframe", hostRoute: "/" };
    const body = {
      version: 2, scope: c.scope, comment: c.comment, location: { ...c.location, frame }, viewport: c.viewport,
      elementRect: c.elementRect, environment: c.environment, sections: [], uploads: [], extraTargets: [], proposals: [], group: null,
    };
    const r = CreateCommentRequestSchema.safeParse(body);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.location.frame).toEqual(frame);
  });
});
