import { describe, expect, it } from "vitest";
import { PerfectFrontError, VisualCommentSchema, migrateComment } from "../src/index";
import { specComment, specCommentV2, specResolution } from "./fixtures";

function catchError(fn: () => unknown): PerfectFrontError {
  try {
    fn();
  } catch (e) {
    return e as PerfectFrontError;
  }
  throw new Error("no lanzó");
}

describe("migración v1 → v2", () => {
  it("añade sections, attachmentInfo, extraTargets, proposals vacíos y group null", () => {
    const out = migrateComment(specComment());
    expect(out.version).toBe(2);
    expect(out.sections).toEqual([]);
    expect(out.attachmentInfo).toEqual([]);
    expect(out.extraTargets).toEqual([]);
    expect(out.proposals).toEqual([]);
    expect(out.group).toBeNull();
  });

  it("conserva los campos v1 tal cual (id, texto, ubicación, adjuntos, fechas)", () => {
    const v1 = specComment();
    const out = migrateComment(v1);
    expect(out.id).toBe(v1.id);
    expect(out.comment).toBe(v1.comment);
    expect(out.location).toEqual(v1.location);
    expect(out.viewport).toEqual(v1.viewport);
    expect(out.elementRect).toEqual(v1.elementRect);
    expect(out.attachments).toEqual(v1.attachments);
    expect(out.createdAt).toBe(v1.createdAt);
    expect(out.updatedAt).toBe(v1.updatedAt);
  });

  it("los adjuntos v1 quedan sueltos: sin sección y sin metadatos", () => {
    const out = migrateComment(specComment());
    expect(out.attachments).toHaveLength(1);
    expect(out.sections.some((s) => s.attachments.length > 0)).toBe(false);
    expect(out.attachmentInfo).toHaveLength(0);
  });

  it("el resultado pasa el esquema v2 y sobrevive a JSON", () => {
    const out = migrateComment(specComment());
    expect(VisualCommentSchema.safeParse(out).success).toBe(true);
    expect(JSON.parse(JSON.stringify(out))).toEqual(out);
  });

  it("conserva una resolución v1 de un comentario resuelto", () => {
    const v1 = { ...specComment(), status: "resolved", collection: "resolved", resolution: specResolution };
    const out = migrateComment(v1);
    expect(out.status).toBe("resolved");
    expect(out.resolution).toEqual(specResolution);
  });

  it("no muta el documento de entrada", () => {
    const v1 = specComment();
    const before = JSON.stringify(v1);
    migrateComment(v1);
    expect(JSON.stringify(v1)).toBe(before);
  });

  it("un v1 con campos de v2 se rechaza (la forma v1 es estricta)", () => {
    const e = catchError(() => migrateComment({ ...specComment(), sections: [] }));
    expect(e.code).toBe("invalid_data");
  });

  it("un v1 con propiedad desconocida se rechaza", () => {
    const e = catchError(() => migrateComment({ ...specComment(), extra: true }));
    expect(e.code).toBe("invalid_data");
  });

  it("v2 no se vuelve a migrar: la identidad conserva los campos nuevos", () => {
    const v2 = specCommentV2();
    v2.sections = [{ id: "antes", title: "Antes", text: "x", attachments: ["attachments/pf_01K7A.png"] }];
    v2.group = { id: "checkout", position: 1 };
    expect(migrateComment(v2)).toEqual(v2);
  });

  it("versión 3 da unsupported_version con mensaje comprensible", () => {
    const e = catchError(() => migrateComment({ ...specCommentV2(), version: 3 }));
    expect(e.code).toBe("unsupported_version");
    expect(e.message).toMatch(/más nueva/);
  });
});
